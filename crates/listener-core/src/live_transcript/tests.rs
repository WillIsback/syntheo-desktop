use owhisper_interface::stream::{Alternatives, Channel, Metadata, ModelInfo, Word};

use super::*;

fn transcript_response_at(
    transcript: &str,
    words: Vec<Word>,
    is_final: bool,
    channel_idx: i32,
    start: f64,
    duration: f64,
) -> StreamResponse {
    StreamResponse::TranscriptResponse {
        start,
        duration,
        is_final,
        speech_final: is_final,
        from_finalize: false,
        channel: Channel {
            alternatives: vec![Alternatives {
                transcript: transcript.to_string(),
                words,
                confidence: 1.0,
                languages: vec![],
            }],
        },
        metadata: Metadata {
            request_id: "request".to_string(),
            model_info: ModelInfo {
                name: "model".to_string(),
                version: "1".to_string(),
                arch: "test".to_string(),
            },
            model_uuid: "uuid".to_string(),
            extra: None,
        },
        channel_index: vec![channel_idx, 2],
    }
}

fn word(text: &str, start: f64, end: f64) -> Word {
    Word {
        word: text.to_string(),
        start,
        end,
        confidence: 1.0,
        speaker: None,
        punctuated_word: Some(text.to_string()),
        language: None,
    }
}

fn words_from_text(text: &str, start: f64, duration: f64) -> Vec<Word> {
    let parts = text.split_whitespace().collect::<Vec<_>>();
    let count = parts.len();

    parts
        .into_iter()
        .enumerate()
        .map(|(index, part)| {
            let word_start = start + (index as f64 / count as f64) * duration;
            let word_end = start + ((index + 1) as f64 / count as f64) * duration;
            word(part, word_start, word_end)
        })
        .collect()
}

#[test]
fn preserves_provider_speakers_beyond_calendar_attendance() {
    let mut engine = LiveTranscriptEngine::new("openai", &["remote".into()], Some("self"));
    let mut first = word("first", 0.0, 0.5);
    first.speaker = Some(0);
    let mut second = word("second", 0.5, 1.0);
    second.speaker = Some(7);
    let response = transcript_response_at("first second", vec![first, second], true, 1, 0.0, 1.0);
    let update = engine.process(&response).unwrap();
    let flushed = engine.flush().unwrap();
    assert_eq!(
        update
            .transcript_delta
            .new_words
            .iter()
            .chain(&flushed.transcript_delta.new_words)
            .map(|word| word.speaker_index)
            .collect::<Vec<_>>(),
        [Some(0), Some(7)]
    );
    let mut segments = update.segment_delta.unwrap().upserts;
    segments.extend(flushed.segment_delta.unwrap().upserts);
    assert!(
        segments
            .iter()
            .any(|segment| segment.key.speaker_index == Some(0))
    );
    assert!(
        segments
            .iter()
            .any(|segment| segment.key.speaker_index == Some(7))
    );
    assert!(
        segments
            .iter()
            .all(|segment| segment.key.speaker_human_id.is_none())
    );
}

// A listener reconnect keeps the session's engine and replays the last few seconds of audio into
// the new stream, where the provider re-transcribes them with slightly different timing.
#[test]
fn checkpointed_engine_ignores_replayed_words_and_keeps_segments_continuous() {
    let mut engine = LiveTranscriptEngine::new("openai", &[], Some("self"));
    let final_at = |text: &str, start: f64, end: f64| {
        transcript_response_at(
            &format!(" {text}"),
            vec![word(text, start, end)],
            true,
            0,
            start,
            end - start,
        )
    };
    let emitted = |update: Option<LiveTranscriptUpdate>| {
        update
            .map(|update| {
                update
                    .transcript_delta
                    .new_words
                    .iter()
                    .map(|word| word.text.trim().to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };

    let mut words = emitted(engine.process(&final_at("hello", 0.0, 0.4)));
    words.extend(emitted(engine.process(&final_at("there", 0.4, 0.9))));
    let checkpoint = engine.checkpoint().expect("held word is delivered");
    words.extend(emitted(Some(checkpoint.clone())));
    assert_eq!(words, ["hello", "there"]);
    let segment_id = checkpoint.segment_delta.unwrap().upserts[0].id.clone();

    // Replay: "there" again with 30 ms of jitter, then new speech.
    assert!(emitted(engine.process(&final_at("there", 0.43, 0.92))).is_empty());
    words.extend(emitted(engine.process(&final_at("friend", 0.92, 1.3))));
    let flushed = engine.flush().expect("flush delivers the held word");
    words.extend(emitted(Some(flushed.clone())));
    assert_eq!(words, ["hello", "there", "friend"]);

    let segment_delta = flushed.segment_delta.unwrap();
    assert_eq!(
        segment_delta.upserts.len(),
        1,
        "the speaker's turn stays one segment"
    );
    assert_eq!(segment_delta.upserts[0].text, "hello there friend");
    assert_eq!(
        segment_delta.removed_ids,
        [segment_id],
        "the segment grows instead of a second one starting at the reconnect"
    );
}

#[test]
fn updating_attendance_does_not_merge_remote_voices() {
    let mut engine = LiveTranscriptEngine::new("openai", &[], Some("self"));
    engine.update_identities(&["remote".into()], Some("self"), vec![], false, 0);
    let mut spoken = word("hello", 0.0, 0.5);
    spoken.speaker = Some(7);
    let response = transcript_response_at("hello", vec![spoken], true, 1, 0.0, 0.5);
    engine.process(&response);
    let update = engine.flush().unwrap();
    assert_eq!(update.transcript_delta.new_words[0].speaker_index, Some(7));
    assert_eq!(
        update.segment_delta.unwrap().upserts[0].key.speaker_index,
        Some(7)
    );
}

#[test]
fn speaker_assignment_names_later_segments_from_the_same_speaker() {
    let participants = ["self".to_string(), "artem".to_string(), "guest".to_string()];
    let mut engine = LiveTranscriptEngine::new("openai", &participants, Some("self"));
    let spoken = |text: &str, start: f64, speaker: i32| {
        let mut words = words_from_text(text, start, 1.0);
        for word in &mut words {
            word.speaker = Some(speaker);
        }
        transcript_response_at(text, words, true, 1, start, 1.0)
    };

    let first = engine
        .process(&spoken("ah okay it is this week", 0.0, 0))
        .expect("first update");
    let first_segments = first.segment_delta.expect("first segments").upserts;
    assert_eq!(first_segments.len(), 1);
    assert_eq!(first_segments[0].key.speaker_index, Some(0));
    assert_eq!(first_segments[0].key.speaker_human_id, None);

    let relabeled = engine
        .update_identities(
            &participants,
            Some("self"),
            vec![IdentityAssignment {
                human_id: "artem".to_string(),
                scope: anlg_transcript::IdentityScope::ChannelSpeaker {
                    channel: anlg_transcript::ChannelProfile::RemoteParty,
                    speaker_index: 0,
                },
            }],
            false,
            0,
        )
        .expect("assignment relabels the segment already on screen");
    assert_eq!(relabeled.upserts.len(), 1);
    assert_eq!(
        relabeled.upserts[0].key.speaker_human_id.as_deref(),
        Some("artem")
    );
    assert_eq!(relabeled.removed_ids, vec![first_segments[0].id.clone()]);

    let later = engine
        .process(&spoken("yeah let us discuss it", 10.0, 0))
        .expect("later update");
    let later_segments = later.segment_delta.expect("later segments").upserts;
    assert_eq!(later_segments.len(), 1);
    assert_eq!(
        later_segments[0].key.speaker_human_id.as_deref(),
        Some("artem")
    );
    assert!(later_segments[0].text.ends_with("yeah let us discuss it"));

    // The processor holds the newest words as partials until the stream moves
    // on, so flush to settle the other speaker's turn.
    engine
        .process(&spoken("nice", 20.0, 1))
        .expect("other speaker update");
    let settled = engine.flush().expect("flush update");
    let settled_segments = settled.segment_delta.expect("settled segments").upserts;
    let other = settled_segments
        .iter()
        .find(|segment| segment.text == "nice")
        .expect("the other speaker gets a segment of their own");
    assert_eq!(other.key.speaker_index, Some(1));
    assert_eq!(other.key.speaker_human_id, None);
    assert!(
        settled_segments
            .iter()
            .filter(|segment| segment.key.speaker_human_id.as_deref() == Some("artem"))
            .all(|segment| !segment.text.contains("nice"))
    );
}

#[test]
fn isolated_mic_names_indexless_words_as_self() {
    let participants = ["self".to_string()];
    let mut engine = LiveTranscriptEngine::with_speaker_assignments(
        "openai",
        &participants,
        Some("self"),
        vec![],
        true,
        0,
    );

    let update = engine
        .process(&transcript_response_at(
            "hello there",
            words_from_text("hello there", 0.0, 1.0),
            true,
            0,
            0.0,
            1.0,
        ))
        .expect("update");
    let segments = update.segment_delta.expect("segments").upserts;
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].key.speaker_human_id.as_deref(), Some("self"));
}

#[test]
fn shared_mic_keeps_indexless_words_anonymous() {
    let participants = ["self".to_string()];
    let mut engine = LiveTranscriptEngine::with_speaker_assignments(
        "openai",
        &participants,
        Some("self"),
        vec![],
        false,
        0,
    );

    let update = engine
        .process(&transcript_response_at(
            "hello there",
            words_from_text("hello there", 0.0, 1.0),
            true,
            0,
            0.0,
            1.0,
        ))
        .expect("update");
    let segments = update.segment_delta.expect("segments").upserts;
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].key.speaker_human_id, None);
}

#[test]
fn isolation_start_keeps_earlier_words_anonymous() {
    let participants = ["self".to_string()];
    let mut engine = LiveTranscriptEngine::with_speaker_assignments(
        "openai",
        &participants,
        Some("self"),
        vec![],
        false,
        0,
    );

    engine
        .process(&transcript_response_at(
            "guest speaks",
            words_from_text("guest speaks", 0.0, 1.0),
            true,
            0,
            0.0,
            1.0,
        ))
        .expect("shared-era update");

    if let Some(delta) = engine.update_identities(&participants, Some("self"), vec![], true, 2000) {
        assert!(
            delta
                .upserts
                .iter()
                .filter(|segment| segment.text.contains("guest speaks"))
                .all(|segment| segment.key.speaker_human_id.is_none()),
            "shared-era words must not inherit the owner when isolation starts"
        );
    }

    let update = engine
        .process(&transcript_response_at(
            "owner speaks",
            words_from_text("owner speaks", 3.0, 1.0),
            true,
            0,
            3.0,
            1.0,
        ))
        .expect("isolated-era update");
    let segments = update.segment_delta.expect("segments").upserts;
    let owner = segments
        .iter()
        .find(|segment| segment.text.contains("owner speaks"))
        .expect("isolated-era segment");
    assert_eq!(owner.key.speaker_human_id.as_deref(), Some("self"));
}

#[test]
fn isolation_end_keeps_earlier_isolated_words_named() {
    let participants = ["self".to_string()];
    let mut engine = LiveTranscriptEngine::with_speaker_assignments(
        "openai",
        &participants,
        Some("self"),
        vec![],
        true,
        0,
    );

    engine
        .process(&transcript_response_at(
            "owner speaks",
            words_from_text("owner speaks", 0.0, 1.0),
            true,
            0,
            0.0,
            1.0,
        ))
        .expect("isolated-era update");

    if let Some(delta) = engine.update_identities(&participants, Some("self"), vec![], false, 2000)
    {
        assert!(
            delta
                .upserts
                .iter()
                .filter(|segment| segment.text.contains("owner speaks"))
                .all(|segment| segment.key.speaker_human_id.as_deref() == Some("self")),
            "isolated-era words keep the owner after isolation ends"
        );
    }

    let update = engine
        .process(&transcript_response_at(
            "guest speaks",
            words_from_text("guest speaks", 3.0, 1.0),
            true,
            0,
            3.0,
            1.0,
        ))
        .expect("shared-era update");
    let segments = update.segment_delta.expect("segments").upserts;
    let guest = segments
        .iter()
        .find(|segment| segment.text.contains("guest speaks"))
        .expect("shared-era segment");
    assert_eq!(guest.key.speaker_human_id, None);
}

#[test]
fn isolated_mic_self_wins_over_scoped_guest_assignment() {
    let participants = ["self".to_string()];
    let mut engine = LiveTranscriptEngine::with_speaker_assignments(
        "openai",
        &participants,
        Some("self"),
        vec![IdentityAssignment {
            human_id: "guest".to_string(),
            scope: anlg_transcript::IdentityScope::ChannelSpeaker {
                channel: anlg_transcript::ChannelProfile::DirectMic,
                speaker_index: 0,
            },
        }],
        true,
        0,
    );

    let update = engine
        .process(&transcript_response_at(
            "hello there",
            words_from_text("hello there", 0.0, 1.0),
            true,
            0,
            0.0,
            1.0,
        ))
        .expect("update");
    let segments = update.segment_delta.expect("segments").upserts;
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].key.speaker_human_id.as_deref(), Some("self"));
}

#[test]
fn live_transcript_delta_keeps_speaker_index_on_words() {
    let delta = TranscriptDelta {
        new_words: vec![FinalizedWord {
            id: "word-1".to_string(),
            text: "hello".to_string(),
            start_ms: 0,
            end_ms: 100,
            channel: 0,
            state: anlg_transcript::WordState::Final,
            speaker_index: Some(1),
        }],
        replaced_ids: vec!["replaced".to_string()],
        partials: vec![PartialWord {
            text: "world".to_string(),
            start_ms: 100,
            end_ms: 200,
            channel: 1,
            speaker_index: Some(2),
        }],
    };

    let converted: LiveTranscriptDelta = delta.into();
    assert_eq!(converted.new_words[0].speaker_index, Some(1));
    assert_eq!(converted.partials[0].speaker_index, Some(2));
    assert_eq!(converted.replaced_ids, vec!["replaced"]);
}
