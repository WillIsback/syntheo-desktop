//! Stall watchdog fed by the real NVIDIA NIM adapter, as in a live session:
//! continuous speech, provisional hypotheses every half second and a single
//! interim final whose word offsets come in milliseconds (issue #268).

use std::time::{Duration, Instant};

use owhisper_client::{NvidiaAdapter, RealtimeSttAdapter};
use owhisper_interface::stream::StreamResponse;

use super::stream::StreamProgress;
use crate::LiveTranscriptEngine;

/// 100 ms of 16 kHz PCM16, the cadence the source actor sends.
const CHUNK_BYTES: usize = 3200;
const CHUNK_SAMPLES: usize = crate::actors::SAMPLE_RATE as usize / 10;

fn delta(text: &str) -> String {
    serde_json::json!({
        "type": "conversation.item.input_audio_transcription.delta",
        "delta": text,
    })
    .to_string()
}

/// NIM reports `words_info` offsets in milliseconds (NVIDIA's reference
/// realtime client prints them under "Start (ms)" / "End (ms)").
fn completed_ms(text: &str, start_ms: f64, end_ms: f64) -> String {
    serde_json::json!({
        "type": "conversation.item.input_audio_transcription.completed",
        "transcript": text,
        "words_info": {"words": [
            {"word": text, "start_time": start_ms, "end_time": end_ms, "confidence": 0.9}
        ]},
    })
    .to_string()
}

struct Session {
    adapter: NvidiaAdapter,
    engine: LiveTranscriptEngine,
    progress: StreamProgress,
    start: Instant,
    partial_text: String,
}

impl Session {
    fn new() -> Self {
        let start = Instant::now();
        Self {
            adapter: NvidiaAdapter::default(),
            engine: LiveTranscriptEngine::new("nvidia", &[], None),
            progress: StreamProgress::new(start),
            start,
            partial_text: String::new(),
        }
    }

    fn time(&self, tick: u64) -> Instant {
        self.start + Duration::from_millis(tick * 100)
    }

    fn receive(&mut self, raw: &str, tick: u64) {
        let time = self.time(tick);
        for mut response in self.adapter.parse_response(raw) {
            response.set_channel_index(1, 2);
            self.observe(&response, time);
        }
    }

    fn observe(&mut self, response: &StreamResponse, time: Instant) {
        self.progress.observe_response(response, time);
        if let Some(update) = self.engine.process(response) {
            self.partial_text = update
                .transcript_delta
                .partials
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            self.progress.observe_delta(&update.transcript_delta, time);
        }
    }

    /// Sends one chunk of speech; returns whether the watchdog fired.
    fn send_audio(&mut self, tick: u64) -> bool {
        let _ = self
            .adapter
            .audio_to_message(bytes::Bytes::from(vec![0x10; CHUNK_BYTES]));
        let time = self.time(tick);
        self.progress.observe_audio(CHUNK_SAMPLES, time)
    }
}

#[test]
fn nvidia_continuous_speech_with_evolving_partials_is_not_a_stall() {
    let mut session = Session::new();
    let mut hypothesis = String::new();
    for tick in 1..=600 {
        assert!(
            !session.send_audio(tick),
            "watchdog fired at {:.1}s although the hypothesis kept growing: {:?}",
            tick as f64 / 10.0,
            session.progress.diagnostics(session.time(tick)),
        );
        if tick == 50 {
            session.receive(&completed_ms("Bonjour à tous.", 300.0, 4_800.0), tick);
        } else if tick > 50 && tick % 5 == 0 {
            hypothesis.push_str(" et");
            session.receive(&delta(hypothesis.trim()), tick);
            assert!(
                session.partial_text.contains(hypothesis.trim()),
                "the provisional text after the first final was dropped at {:.1}s",
                tick as f64 / 10.0,
            );
        }
    }
}

#[test]
fn nvidia_server_that_answers_without_text_still_stalls() {
    let mut session = Session::new();
    let mut stalled_at = None;
    for tick in 1..=400 {
        if session.send_audio(tick) {
            stalled_at = Some(tick);
            break;
        }
        // Alive but deaf: only empty interim finals while speech is sent.
        if tick % 5 == 0 {
            session.receive(
                r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":""}"#,
                tick,
            );
        }
    }
    assert_eq!(stalled_at, Some(300));
}

fn provisional(text: &str, channel: i32) -> StreamResponse {
    use owhisper_interface::stream::{Alternatives, Channel, Metadata};

    StreamResponse::TranscriptResponse {
        start: 0.0,
        duration: 0.0,
        is_final: false,
        speech_final: false,
        from_finalize: false,
        channel: Channel {
            alternatives: vec![Alternatives {
                transcript: text.to_string(),
                words: vec![],
                confidence: 1.0,
                languages: vec![],
            }],
        },
        metadata: Metadata::default(),
        channel_index: vec![channel, 2],
    }
}

/// Returns the second at which the watchdog fired, feeding one response and
/// one second of speech per second and no transcript-engine delta at all.
fn first_stall(mut next_response: impl FnMut(u64) -> StreamResponse) -> Option<u64> {
    let start = Instant::now();
    let mut progress = StreamProgress::new(start);
    let second_of_speech = crate::actors::SAMPLE_RATE as usize;
    (1..=120).find(|&second| {
        let time = start + Duration::from_secs(second);
        progress.observe_response(&next_response(second), time);
        progress.observe_audio(second_of_speech, time)
    })
}

#[test]
fn evolving_provisional_text_counts_as_progress_on_its_own() {
    // Even when the transcript engine yields nothing usable (deduplicated or
    // mistimed words), a hypothesis that keeps changing proves the server is
    // transcribing. Only the unfinalized-audio cap may still recycle the stream.
    let stall = first_stall(|second| provisional(&"mot ".repeat(second as usize), 1));
    assert_eq!(stall, Some(90));
}

#[test]
fn frozen_or_empty_provisional_text_is_not_progress() {
    assert_eq!(first_stall(|_| provisional("Bonjour", 1)), Some(31));
    assert_eq!(first_stall(|_| provisional("  ", 1)), Some(30));
    // Two channels each repeating their own text must not look like a change.
    assert_eq!(
        first_stall(|second| {
            let channel = (second % 2) as i32;
            provisional(if channel == 0 { "oui" } else { "non" }, channel)
        }),
        Some(32)
    );
}

/// Issue #271 : sur une vidéo en parole continue, le NIM n'a rien finalisé
/// pendant 90 s et l'écoute s'est reconnectée (`UnfinalizedCap`). Le texte
/// provisoire de ces 90 s doit être validé dans la transcription avant la
/// reconnexion, ce que fait l'arrêt du flux (`post_stop` → `checkpoint`).
#[test]
fn nvidia_unfinalized_cap_commits_the_provisional_text_before_reconnecting() {
    let mut session = Session::new();
    let mut hypothesis = Vec::new();
    let mut stalled_at = None;
    for tick in 1..=1_200 {
        if session.send_audio(tick) {
            stalled_at = Some(tick);
            break;
        }
        if tick == 50 {
            session.receive(&completed_ms("Bonjour à tous.", 300.0, 4_800.0), tick);
        } else if tick > 50 && tick % 5 == 0 {
            hypothesis.push(format!("mot{tick}"));
            session.receive(&delta(&hypothesis.join(" ")), tick);
        }
    }
    let stalled_at = stalled_at.expect("the unfinalized cap recycles the stream");
    let diagnostics = session.progress.diagnostics(session.time(stalled_at));
    assert_eq!(
        diagnostics.reason,
        super::stream::StallReason::UnfinalizedCap
    );
    assert!(diagnostics.active_audio_secs < 1.0);

    let checkpoint = session
        .engine
        .checkpoint()
        .expect("the provisional hypothesis is committed");
    // NIM hypotheses carry no word offsets: the committed text is the held
    // final followed by the whole provisional segment.
    let committed = checkpoint
        .transcript_delta
        .new_words
        .iter()
        .map(|word| word.text.trim())
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(
        committed,
        format!("Bonjour à tous. {}", hypothesis.join(" ")),
        "provisional words lost at the reconnect"
    );
    assert!(checkpoint.transcript_delta.partials.is_empty());
    assert!(
        checkpoint
            .transcript_delta
            .new_words
            .windows(2)
            .all(|pair| pair[0].start_ms <= pair[1].start_ms)
    );
}
