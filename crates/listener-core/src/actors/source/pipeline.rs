use std::{
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use ractor::{ActorRef, MessagingErr, rpc::CallResult};

use crate::{
    ListenerRuntime, SessionDataEvent,
    actors::{ChannelMode, ListenerAudioResult, ListenerMsg, SAMPLE_RATE},
};
use syntheo_audio_utils::f32_to_i16_bytes;
use syntheo_vad_masking::VadMask;

use super::{ListenerRefreshReplay, ListenerRouting, SourceFrame};

const AUDIO_AMPLITUDE_THROTTLE: Duration = Duration::from_millis(100);
// In-memory only (never written to disk): 300 chunks of 120 ms hold 36 s of
// audio, enough for a full replay plus the time a reconnection takes.
const MAX_BUFFER_CHUNKS: usize = 300;
// Audio the previous stream accepted but may not have transcribed yet.
const REPLAY_CONTEXT_SECS: usize = 5;
// Upper bound of a replay: the context plus everything the previous listener
// never accepted (sent while it was stopping, or while the session waited to
// reconnect). A stream that stops on the unfinalized cap spends up to 7 s
// finalizing, then the first retry comes ~1 s later.
const MAX_REPLAY_SECS: usize = 15;
const LISTENER_DISPATCH_CAPACITY: usize = 32;
const LISTENER_AUDIO_ACK_TIMEOUT: Duration = Duration::from_secs(1);
const LISTENER_BACKPRESSURE_TIMEOUT: Duration = Duration::from_secs(1);
const LISTENER_BACKPRESSURE_RETRY_DELAY: Duration = Duration::from_millis(10);
const MAX_BACKLOG_DISPATCH_PER_FRAME: usize = 2;
const DROPOUT_WINDOW_SAMPLES: usize = SAMPLE_RATE as usize * 5;
const DROPOUT_RATIO_THRESHOLD: f32 = 0.15;

#[derive(Clone)]
struct BufferedAudio {
    mic: Arc<[f32]>,
    spk: Arc<[f32]>,
    mode: ChannelMode,
    /// Captured samples up to the end of this item, counted from the start of capture.
    end_position: u64,
}

impl BufferedAudio {
    fn new(mic: Arc<[f32]>, spk: Arc<[f32]>, mode: ChannelMode, end_position: u64) -> Self {
        Self {
            mic,
            spk,
            mode,
            end_position,
        }
    }

    fn sample_count(&self) -> usize {
        self.mic.len().max(self.spk.len())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DispatchFrameResult {
    Complete,
}

pub(in crate::actors) struct Pipeline {
    vad_mask: VadMask,
    amplitude: AmplitudeEmitter,
    dropouts: DropoutMonitor,
    audio_buffer: AudioBuffer,
    replay_history: ReplayHistory,
    listener_dispatcher: ListenerDispatcher,
    captured_samples: u64,
}

impl Pipeline {
    pub(super) fn new(runtime: Arc<dyn ListenerRuntime>, session_id: String) -> Self {
        Self {
            amplitude: AmplitudeEmitter::new(runtime.clone(), session_id.clone()),
            dropouts: DropoutMonitor::new(runtime, session_id),
            audio_buffer: AudioBuffer::new(MAX_BUFFER_CHUNKS),
            replay_history: ReplayHistory::new(SAMPLE_RATE as usize * MAX_REPLAY_SECS),
            listener_dispatcher: ListenerDispatcher::new(),
            vad_mask: VadMask::default(),
            captured_samples: 0,
        }
    }

    pub(super) fn reset(&mut self) {
        self.amplitude.reset();
        self.dropouts.reset();
        self.audio_buffer.clear();
        self.replay_history.clear();
        self.listener_dispatcher.reset();
        self.listener_dispatcher.reset_delivery();
        self.vad_mask = VadMask::default();
        self.captured_samples = 0;
    }

    pub(super) async fn dispatch_frame(
        &mut self,
        frame: SourceFrame,
        mode: ChannelMode,
        listener_routing: &ListenerRouting,
    ) -> Result<DispatchFrameResult, String> {
        self.dispatch(frame, mode, listener_routing).await
    }

    pub(super) fn on_listener_routing_changed(&mut self, listener_routing: &ListenerRouting) {
        match listener_routing {
            ListenerRouting::Buffering => {}
            ListenerRouting::Attached(actor) => {
                self.flush_buffer_to_listener(actor, usize::MAX);
            }
            ListenerRouting::Dropped => {
                self.listener_dispatcher.reset();
                self.audio_buffer.clear();
            }
        }
    }

    /// Queues the audio the next listener must hear before live audio: what the
    /// previous listener never accepted, plus a few seconds it accepted but may
    /// not have transcribed. Everything stays in memory and is bounded.
    pub(super) fn prepare_listener_refresh(&mut self) -> ListenerRefreshReplay {
        self.listener_dispatcher.reset();
        self.audio_buffer.clear();

        let undelivered = self
            .captured_samples
            .saturating_sub(self.listener_dispatcher.delivered_through());
        let wanted = usize::try_from(undelivered)
            .unwrap_or(usize::MAX)
            .saturating_add(SAMPLE_RATE as usize * REPLAY_CONTEXT_SECS)
            .min(SAMPLE_RATE as usize * MAX_REPLAY_SECS);
        let mut replayed = 0;
        for item in self.replay_history.tail(wanted) {
            replayed += item.sample_count();
            self.audio_buffer.push_item(item);
        }

        ListenerRefreshReplay {
            duration_secs: replayed as f64 / SAMPLE_RATE as f64,
        }
    }

    async fn dispatch(
        &mut self,
        frame: SourceFrame,
        mode: ChannelMode,
        listener_routing: &ListenerRouting,
    ) -> Result<DispatchFrameResult, String> {
        if mode != ChannelMode::SpeakerOnly {
            self.dropouts.observe(&frame.capture.raw_mic);
        }

        let (mut processed_mic, processed_spk) = Self::select_tracks(frame, mode);
        self.vad_mask.process(&mut processed_mic);
        let processed_mic = Arc::<[f32]>::from(processed_mic);
        let samples = processed_mic.len().max(processed_spk.len()) as u64;
        self.captured_samples = self.captured_samples.saturating_add(samples);
        let item = BufferedAudio::new(processed_mic, processed_spk, mode, self.captured_samples);

        self.complete_item(item, listener_routing);
        Ok(DispatchFrameResult::Complete)
    }

    fn complete_item(&mut self, item: BufferedAudio, listener_routing: &ListenerRouting) {
        self.replay_history.push(item.clone());
        self.amplitude.observe_mic(&item.mic);
        self.amplitude.observe_spk(&item.spk);

        match listener_routing {
            ListenerRouting::Buffering => {
                self.audio_buffer.push_item(item);
                tracing::debug!(
                    buffered = self.audio_buffer.len(),
                    "listener_unavailable_buffering"
                );
            }
            ListenerRouting::Attached(actor) => {
                if self.audio_buffer.is_empty() {
                    if !self.send_to_listener(actor, &item) {
                        self.audio_buffer.push_item(item);
                    }
                } else {
                    self.audio_buffer.push_item(item);
                    self.flush_buffer_to_listener(actor, MAX_BACKLOG_DISPATCH_PER_FRAME);
                }
            }
            ListenerRouting::Dropped => {}
        }
    }

    fn flush_buffer_to_listener(&mut self, actor: &ActorRef<ListenerMsg>, max_items: usize) {
        for _ in 0..max_items {
            let Some(item) = self.audio_buffer.pop() else {
                break;
            };

            if !self.send_to_listener(actor, &item) {
                self.audio_buffer.push_front(item);
                break;
            }
        }
    }

    fn send_to_listener(&self, actor: &ActorRef<ListenerMsg>, item: &BufferedAudio) -> bool {
        self.listener_dispatcher.try_send(actor.clone(), item)
    }

    fn select_tracks(frame: SourceFrame, mode: ChannelMode) -> (Vec<f32>, Arc<[f32]>) {
        let raw_speaker = Arc::clone(&frame.capture.raw_speaker);

        let mic_source = match mode {
            ChannelMode::SpeakerOnly => Arc::<[f32]>::from(vec![0.0; raw_speaker.len()]),
            ChannelMode::MicOnly | ChannelMode::MicAndSpeaker => frame.capture.preferred_mic(),
        };

        let mic = if frame.mic_muted {
            vec![0.0; mic_source.len()]
        } else {
            mic_source.to_vec()
        };

        (mic, raw_speaker)
    }
}

struct ListenerDispatcher {
    tx: tokio::sync::mpsc::Sender<ListenerDispatch>,
    task: tokio::task::JoinHandle<()>,
    generation: Arc<AtomicU64>,
    /// Capture position up to which a listener accepted the audio.
    delivered: Arc<AtomicU64>,
}

struct ListenerDispatch {
    actor: ActorRef<ListenerMsg>,
    audio: ListenerAudio,
    generation: u64,
    end_position: u64,
}

#[derive(Clone)]
enum ListenerAudio {
    Single(bytes::Bytes),
    Dual(bytes::Bytes, bytes::Bytes),
}

impl ListenerDispatcher {
    fn new() -> Self {
        let (tx, mut rx) =
            tokio::sync::mpsc::channel::<ListenerDispatch>(LISTENER_DISPATCH_CAPACITY);
        let generation = Arc::new(AtomicU64::new(0));
        let task_generation = generation.clone();
        let delivered = Arc::new(AtomicU64::new(0));
        let task_delivered = delivered.clone();
        let task = tokio::spawn(async move {
            // A stopping listener rejects messages while it finalizes its stream.
            let mut stopping_listener = None;
            while let Some(dispatch) = rx.recv().await {
                if stopping_listener == Some(dispatch.actor.get_id()) {
                    continue;
                }
                let started_at = Instant::now();
                loop {
                    if dispatch.generation != task_generation.load(Ordering::Acquire) {
                        break;
                    }

                    let actor = dispatch.actor.clone();
                    let result = match &dispatch.audio {
                        ListenerAudio::Single(audio) => {
                            let audio = audio.clone();
                            actor
                                .call(
                                    move |reply| ListenerMsg::AudioSingle(audio, reply),
                                    Some(LISTENER_AUDIO_ACK_TIMEOUT),
                                )
                                .await
                        }
                        ListenerAudio::Dual(mic, spk) => {
                            let mic = mic.clone();
                            let spk = spk.clone();
                            actor
                                .call(
                                    move |reply| ListenerMsg::AudioDual(mic, spk, reply),
                                    Some(LISTENER_AUDIO_ACK_TIMEOUT),
                                )
                                .await
                        }
                    };

                    match result {
                        Ok(CallResult::Success(ListenerAudioResult::Accepted)) => {
                            task_delivered.fetch_max(dispatch.end_position, Ordering::AcqRel);
                            break;
                        }
                        Ok(CallResult::Success(ListenerAudioResult::Backpressured)) => {
                            if started_at.elapsed() >= LISTENER_BACKPRESSURE_TIMEOUT {
                                stop_listener(&actor, "listener_audio_backpressure_timed_out");
                                break;
                            }
                            tokio::time::sleep(LISTENER_BACKPRESSURE_RETRY_DELAY).await;
                        }
                        Ok(CallResult::Success(ListenerAudioResult::Closed)) => {
                            stop_listener(&actor, "listener_audio_channel_closed");
                            break;
                        }
                        Ok(CallResult::Success(ListenerAudioResult::ModeMismatch)) => {
                            stop_listener(&actor, "listener_audio_mode_mismatch");
                            break;
                        }
                        Ok(CallResult::SenderError) => {
                            tracing::warn!("listener_stopped_before_acknowledging_audio");
                            break;
                        }
                        Ok(CallResult::Timeout) => {
                            kill_listener(&actor, "listener_audio_ack_timed_out");
                            break;
                        }
                        // The listener is stopping or stopped. Killing it would abort the
                        // `post_stop` that commits its provisional transcript; the audio it
                        // never accepted is replayed to the next listener instead.
                        Err(MessagingErr::SendErr(_) | MessagingErr::ChannelClosed) => {
                            tracing::info!("listener_stopping_audio_kept_for_replay");
                            stopping_listener = Some(actor.get_id());
                            break;
                        }
                        Err(error) => {
                            tracing::warn!(error.message = ?error, "listener_audio_send_failed");
                            actor.kill();
                            break;
                        }
                    }
                }
            }
        });

        Self {
            tx,
            task,
            generation,
            delivered,
        }
    }

    fn reset(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
    }

    fn reset_delivery(&self) {
        self.delivered.store(0, Ordering::Release);
    }

    fn delivered_through(&self) -> u64 {
        self.delivered.load(Ordering::Acquire)
    }

    fn try_send(&self, actor: ActorRef<ListenerMsg>, item: &BufferedAudio) -> bool {
        let Ok(permit) = self.tx.try_reserve() else {
            return false;
        };
        let (mic, spk) = (&item.mic, &item.spk);

        let audio = match item.mode {
            ChannelMode::MicOnly => ListenerAudio::Single(f32_to_i16_bytes(mic.iter().copied())),
            ChannelMode::SpeakerOnly => {
                ListenerAudio::Single(f32_to_i16_bytes(spk.iter().copied()))
            }
            ChannelMode::MicAndSpeaker => ListenerAudio::Dual(
                f32_to_i16_bytes(mic.iter().copied()),
                f32_to_i16_bytes(spk.iter().copied()),
            ),
        };

        permit.send(ListenerDispatch {
            actor,
            audio,
            generation: self.generation.load(Ordering::Acquire),
            end_position: item.end_position,
        });
        true
    }
}

fn stop_listener(actor: &ActorRef<ListenerMsg>, reason: &'static str) {
    tracing::warn!(reason, "listener_audio_delivery_failed");
    actor.stop(Some(reason.to_string()));
}

fn kill_listener(actor: &ActorRef<ListenerMsg>, reason: &'static str) {
    tracing::warn!(reason, "listener_audio_delivery_failed");
    actor.kill();
}

impl Drop for ListenerDispatcher {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct AudioBuffer {
    buffer: VecDeque<BufferedAudio>,
    max_size: usize,
    overflowing: bool,
}

impl AudioBuffer {
    fn new(max_size: usize) -> Self {
        Self {
            buffer: VecDeque::new(),
            max_size,
            overflowing: false,
        }
    }

    fn push_item(&mut self, item: BufferedAudio) {
        if self.buffer.len() >= self.max_size {
            self.buffer.pop_front();
            if !self.overflowing {
                self.overflowing = true;
                tracing::warn!("audio_buffer_overflow_listener_unavailable");
            }
        }
        self.buffer.push_back(item);
    }

    fn push_front(&mut self, item: BufferedAudio) {
        self.buffer.push_front(item);
    }

    fn pop(&mut self) -> Option<BufferedAudio> {
        let item = self.buffer.pop_front();
        if self.overflowing && self.buffer.len() < self.max_size {
            self.overflowing = false;
        }
        item
    }

    fn len(&self) -> usize {
        self.buffer.len()
    }

    fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    fn clear(&mut self) {
        self.buffer.clear();
        self.overflowing = false;
    }
}

struct ReplayHistory {
    buffer: VecDeque<BufferedAudio>,
    max_samples: usize,
    samples: usize,
}

impl ReplayHistory {
    fn new(max_samples: usize) -> Self {
        Self {
            buffer: VecDeque::new(),
            max_samples,
            samples: 0,
        }
    }

    fn push(&mut self, item: BufferedAudio) {
        self.samples += item.sample_count();
        self.buffer.push_back(item);

        while self.samples > self.max_samples {
            let Some(item) = self.buffer.pop_front() else {
                self.samples = 0;
                return;
            };
            self.samples = self.samples.saturating_sub(item.sample_count());
        }
    }

    /// The most recent items covering at least `samples` (or all of them), oldest first.
    fn tail(&self, samples: usize) -> impl Iterator<Item = BufferedAudio> + '_ {
        let mut covered = 0;
        let start = self
            .buffer
            .iter()
            .rposition(|item| {
                covered += item.sample_count();
                covered >= samples
            })
            .unwrap_or(0);
        self.buffer.iter().skip(start).cloned()
    }

    #[cfg(test)]
    fn duration_secs(&self) -> f64 {
        self.samples as f64 / SAMPLE_RATE as f64
    }

    fn clear(&mut self) {
        self.buffer.clear();
        self.samples = 0;
    }
}

// Real microphones never produce exact zeros; a run of them means the device or its driver stopped
// delivering audio. Bluetooth headsets in call mode do this between words. Reported once per
// stream so the UI can warn without being spammed.
//
// Dual capture pads the mic with zeros while the speaker stream leads it, which is routine until
// the mic delivers its first samples. Counting starts at the first non-zero sample so a slow mic
// start is not mistaken for gating; padding after that means the mic stalled, which is a dropout.
struct DropoutMonitor {
    runtime: Arc<dyn ListenerRuntime>,
    session_id: String,
    mic_started: bool,
    zero_samples: usize,
    total_samples: usize,
    reported: bool,
}

impl DropoutMonitor {
    fn new(runtime: Arc<dyn ListenerRuntime>, session_id: String) -> Self {
        Self {
            runtime,
            session_id,
            mic_started: false,
            zero_samples: 0,
            total_samples: 0,
            reported: false,
        }
    }

    fn reset(&mut self) {
        self.mic_started = false;
        self.zero_samples = 0;
        self.total_samples = 0;
        self.reported = false;
    }

    fn observe(&mut self, raw_mic: &[f32]) {
        if self.reported {
            return;
        }

        let zero_samples = raw_mic.iter().filter(|sample| **sample == 0.0).count();
        if !self.mic_started {
            if zero_samples == raw_mic.len() {
                return;
            }
            self.mic_started = true;
        }

        self.zero_samples += zero_samples;
        self.total_samples += raw_mic.len();
        if self.total_samples < DROPOUT_WINDOW_SAMPLES {
            return;
        }

        let ratio = self.zero_samples as f32 / self.total_samples as f32;
        self.zero_samples = 0;
        self.total_samples = 0;
        if ratio < DROPOUT_RATIO_THRESHOLD {
            return;
        }

        tracing::warn!(ratio, "mic_dropouts_detected");
        self.runtime.emit_data(SessionDataEvent::MicDropouts {
            session_id: self.session_id.clone(),
            ratio,
        });
        self.reported = true;
    }
}

struct AmplitudeEmitter {
    runtime: Arc<dyn ListenerRuntime>,
    session_id: String,
    mic_smoothed: f32,
    spk_smoothed: f32,
    last_emit: Instant,
}

impl AmplitudeEmitter {
    const SMOOTHING_ALPHA: f32 = 0.7;
    const MIN_DB: f32 = -60.0;
    const MAX_DB: f32 = 0.0;

    fn new(runtime: Arc<dyn ListenerRuntime>, session_id: String) -> Self {
        Self {
            runtime,
            session_id,
            mic_smoothed: 0.0,
            spk_smoothed: 0.0,
            last_emit: Instant::now() - AUDIO_AMPLITUDE_THROTTLE,
        }
    }

    fn reset(&mut self) {
        self.mic_smoothed = 0.0;
        self.spk_smoothed = 0.0;
        self.last_emit = Instant::now() - AUDIO_AMPLITUDE_THROTTLE;
    }

    fn observe_mic(&mut self, data: &[f32]) {
        let amplitude = Self::amplitude_from_chunk(data);
        self.mic_smoothed =
            (1.0 - Self::SMOOTHING_ALPHA) * self.mic_smoothed + Self::SMOOTHING_ALPHA * amplitude;
        self.emit_if_ready();
    }

    fn observe_spk(&mut self, data: &[f32]) {
        let amplitude = Self::amplitude_from_chunk(data);
        self.spk_smoothed =
            (1.0 - Self::SMOOTHING_ALPHA) * self.spk_smoothed + Self::SMOOTHING_ALPHA * amplitude;
        self.emit_if_ready();
    }

    fn emit_if_ready(&mut self) {
        if self.last_emit.elapsed() < AUDIO_AMPLITUDE_THROTTLE {
            return;
        }

        let mic_level = (self.mic_smoothed * 1000.0) as u16;
        let spk_level = (self.spk_smoothed * 1000.0) as u16;

        self.runtime.emit_data(SessionDataEvent::AudioAmplitude {
            session_id: self.session_id.clone(),
            mic: mic_level,
            speaker: spk_level,
        });

        self.last_emit = Instant::now();
    }

    fn amplitude_from_chunk(chunk: &[f32]) -> f32 {
        if chunk.is_empty() {
            return 0.0;
        }

        let sum_squares: f32 = chunk.iter().filter(|x| x.is_finite()).map(|&x| x * x).sum();
        let count = chunk.iter().filter(|x| x.is_finite()).count();
        if count == 0 {
            return 0.0;
        }
        let rms = (sum_squares / count as f32).sqrt();

        let db = if rms > 0.0 {
            20.0 * rms.log10()
        } else {
            Self::MIN_DB
        };

        ((db - Self::MIN_DB) / (Self::MAX_DB - Self::MIN_DB)).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use ractor::{Actor, ActorProcessingErr, ActorRef};

    use syntheo_audio::CaptureFrame;

    use super::*;
    use crate::{
        ListenerRuntime, SessionDataEvent, SessionErrorEvent, SessionLifecycleEvent,
        SessionProgressEvent,
    };

    struct TestRuntime;

    impl syntheo_storage::StorageRuntime for TestRuntime {
        fn global_base(&self) -> Result<PathBuf, syntheo_storage::Error> {
            Ok(std::env::temp_dir())
        }

        fn vault_base(&self) -> Result<PathBuf, syntheo_storage::Error> {
            Ok(std::env::temp_dir())
        }
    }

    impl ListenerRuntime for TestRuntime {
        fn emit_lifecycle(&self, _event: SessionLifecycleEvent) {}

        fn emit_progress(&self, _event: SessionProgressEvent) {}

        fn emit_error(&self, _event: SessionErrorEvent) {}

        fn emit_data(&self, _event: SessionDataEvent) {}
    }

    #[derive(Default)]
    struct DropoutRuntime(std::sync::Mutex<Vec<f32>>);

    impl syntheo_storage::StorageRuntime for DropoutRuntime {
        fn global_base(&self) -> Result<PathBuf, syntheo_storage::Error> {
            Ok(std::env::temp_dir())
        }

        fn vault_base(&self) -> Result<PathBuf, syntheo_storage::Error> {
            Ok(std::env::temp_dir())
        }
    }

    impl ListenerRuntime for DropoutRuntime {
        fn emit_lifecycle(&self, _event: SessionLifecycleEvent) {}

        fn emit_progress(&self, _event: SessionProgressEvent) {}

        fn emit_error(&self, _event: SessionErrorEvent) {}

        fn emit_data(&self, event: SessionDataEvent) {
            if let SessionDataEvent::MicDropouts { ratio, .. } = event {
                self.0.lock().unwrap().push(ratio);
            }
        }
    }

    #[allow(clippy::enum_variant_names)]
    enum ProbeEvent {
        ListenerSingle,
        ListenerDual,
        ListenerControl,
        ListenerStopped,
    }

    struct ListenerProbe(tokio::sync::mpsc::UnboundedSender<ProbeEvent>);

    struct OrderingListenerProbe(tokio::sync::mpsc::UnboundedSender<i16>);

    #[ractor::async_trait]
    impl Actor for ListenerProbe {
        type Msg = ListenerMsg;
        type State = ();
        type Arguments = ();

        async fn pre_start(
            &self,
            _myself: ActorRef<Self::Msg>,
            _args: Self::Arguments,
        ) -> Result<Self::State, ActorProcessingErr> {
            Ok(())
        }

        async fn handle(
            &self,
            _myself: ActorRef<Self::Msg>,
            message: Self::Msg,
            _state: &mut Self::State,
        ) -> Result<(), ActorProcessingErr> {
            match message {
                ListenerMsg::AudioSingle(bytes, reply) => {
                    let _ = bytes.len();
                    let _ = self.0.send(ProbeEvent::ListenerSingle);
                    let _ = reply.send(ListenerAudioResult::Accepted);
                }
                ListenerMsg::AudioDual(mic, spk, reply) => {
                    let _ = (mic.len(), spk.len());
                    let _ = self.0.send(ProbeEvent::ListenerDual);
                    let _ = reply.send(ListenerAudioResult::Accepted);
                }
                _ => {}
            }
            Ok(())
        }
    }

    #[ractor::async_trait]
    impl Actor for OrderingListenerProbe {
        type Msg = ListenerMsg;
        type State = ();
        type Arguments = ();

        async fn pre_start(
            &self,
            _myself: ActorRef<Self::Msg>,
            _args: Self::Arguments,
        ) -> Result<Self::State, ActorProcessingErr> {
            Ok(())
        }

        async fn handle(
            &self,
            _myself: ActorRef<Self::Msg>,
            message: Self::Msg,
            _state: &mut Self::State,
        ) -> Result<(), ActorProcessingErr> {
            if let ListenerMsg::AudioSingle(bytes, reply) = message {
                let value = i16::from_le_bytes([bytes[0], bytes[1]]);
                let _ = self.0.send(value);
                let _ = reply.send(ListenerAudioResult::Accepted);
            }
            Ok(())
        }
    }

    struct BackpressuredListenerProbe(tokio::sync::mpsc::UnboundedSender<ProbeEvent>);

    struct StuckListenerProbe;

    #[ractor::async_trait]
    impl Actor for BackpressuredListenerProbe {
        type Msg = ListenerMsg;
        type State = ();
        type Arguments = ();

        async fn pre_start(
            &self,
            _myself: ActorRef<Self::Msg>,
            _args: Self::Arguments,
        ) -> Result<Self::State, ActorProcessingErr> {
            Ok(())
        }

        async fn handle(
            &self,
            _myself: ActorRef<Self::Msg>,
            message: Self::Msg,
            _state: &mut Self::State,
        ) -> Result<(), ActorProcessingErr> {
            match message {
                ListenerMsg::AudioSingle(_, reply) | ListenerMsg::AudioDual(_, _, reply) => {
                    let _ = reply.send(ListenerAudioResult::Backpressured);
                }
                ListenerMsg::StreamEnded => {
                    let _ = self.0.send(ProbeEvent::ListenerControl);
                }
                _ => {}
            }
            Ok(())
        }

        async fn post_stop(
            &self,
            _myself: ActorRef<Self::Msg>,
            _state: &mut Self::State,
        ) -> Result<(), ActorProcessingErr> {
            let _ = self.0.send(ProbeEvent::ListenerStopped);
            Ok(())
        }
    }

    #[ractor::async_trait]
    impl Actor for StuckListenerProbe {
        type Msg = ListenerMsg;
        type State = ();
        type Arguments = ();

        async fn pre_start(
            &self,
            _myself: ActorRef<Self::Msg>,
            _args: Self::Arguments,
        ) -> Result<Self::State, ActorProcessingErr> {
            Ok(())
        }

        async fn handle(
            &self,
            _myself: ActorRef<Self::Msg>,
            message: Self::Msg,
            _state: &mut Self::State,
        ) -> Result<(), ActorProcessingErr> {
            match message {
                ListenerMsg::AudioSingle(_, reply) | ListenerMsg::AudioDual(_, _, reply) => {
                    let reply = reply;
                    std::future::pending::<()>().await;
                    drop(reply);
                }
                _ => {}
            }
            Ok(())
        }
    }

    fn test_pipeline() -> Pipeline {
        Pipeline::new(Arc::new(TestRuntime), "session".to_string())
    }

    fn capture_frame() -> CaptureFrame {
        CaptureFrame {
            raw_mic: Arc::from([0.25_f32, -0.25, 0.5, -0.5]),
            raw_speaker: Arc::from([0.75_f32, -0.75, 1.0, -1.0]),
            aec_mic: Some(Arc::from([0.1_f32, -0.1, 0.2, -0.2])),
        }
    }

    fn source_frame(mic_muted: bool) -> SourceFrame {
        SourceFrame {
            captured: true,
            capture: capture_frame(),
            mic_muted,
        }
    }

    fn source_frame_with_speaker_value(value: f32) -> SourceFrame {
        SourceFrame {
            captured: true,
            capture: CaptureFrame {
                raw_mic: Arc::from([0.0_f32; 4]),
                raw_speaker: Arc::from([value; 4]),
                aec_mic: None,
            },
            mic_muted: false,
        }
    }

    #[tokio::test]
    async fn buffered_audio_is_delivered_before_new_audio() {
        let mut pipeline = test_pipeline();

        for value in [0.1, 0.2] {
            pipeline
                .dispatch_frame(
                    source_frame_with_speaker_value(value),
                    ChannelMode::SpeakerOnly,
                    &ListenerRouting::Buffering,
                )
                .await
                .unwrap();
        }

        let (probe_tx, mut probe_rx) = tokio::sync::mpsc::unbounded_channel();
        let (listener_ref, handle) = Actor::spawn(None, OrderingListenerProbe(probe_tx), ())
            .await
            .unwrap();
        let routing = ListenerRouting::Attached(listener_ref);
        pipeline.on_listener_routing_changed(&routing);
        pipeline
            .dispatch_frame(
                source_frame_with_speaker_value(0.3),
                ChannelMode::SpeakerOnly,
                &routing,
            )
            .await
            .unwrap();

        let mut values = Vec::new();
        for _ in 0..3 {
            values.push(
                tokio::time::timeout(std::time::Duration::from_secs(1), probe_rx.recv())
                    .await
                    .unwrap()
                    .unwrap(),
            );
        }
        assert!(values[0] < values[1] && values[1] < values[2]);

        handle.abort();
    }

    #[tokio::test]
    async fn listener_reconnect_replays_old_audio_before_new_audio() {
        let mut pipeline = test_pipeline();
        let (old_probe_tx, _old_probe_rx) = tokio::sync::mpsc::unbounded_channel();
        let (old_listener, old_handle) =
            Actor::spawn(None, BackpressuredListenerProbe(old_probe_tx), ())
                .await
                .unwrap();
        let old_routing = ListenerRouting::Attached(old_listener);

        for value in [0.1, 0.2] {
            pipeline
                .dispatch_frame(
                    source_frame_with_speaker_value(value),
                    ChannelMode::SpeakerOnly,
                    &old_routing,
                )
                .await
                .unwrap();
        }
        tokio::task::yield_now().await;

        let replay = pipeline.prepare_listener_refresh();
        assert!(replay.duration_secs > 0.0);

        let (new_probe_tx, mut new_probe_rx) = tokio::sync::mpsc::unbounded_channel();
        let (new_listener, new_handle) =
            Actor::spawn(None, OrderingListenerProbe(new_probe_tx), ())
                .await
                .unwrap();
        let new_routing = ListenerRouting::Attached(new_listener);
        pipeline.on_listener_routing_changed(&new_routing);
        pipeline
            .dispatch_frame(
                source_frame_with_speaker_value(0.3),
                ChannelMode::SpeakerOnly,
                &new_routing,
            )
            .await
            .unwrap();

        let mut values = Vec::new();
        for _ in 0..3 {
            values.push(
                tokio::time::timeout(std::time::Duration::from_secs(1), new_probe_rx.recv())
                    .await
                    .unwrap()
                    .unwrap(),
            );
        }
        assert!(values[0] < values[1] && values[1] < values[2]);

        old_handle.abort();
        new_handle.abort();
    }

    #[tokio::test]
    async fn listener_backpressure_stays_bounded_without_blocking_control_messages() {
        let mut pipeline = test_pipeline();
        let (probe_tx, mut probe_rx) = tokio::sync::mpsc::unbounded_channel();
        let (listener_ref, handle) = Actor::spawn(None, BackpressuredListenerProbe(probe_tx), ())
            .await
            .unwrap();
        let routing = ListenerRouting::Attached(listener_ref.clone());

        for _ in 0..(LISTENER_DISPATCH_CAPACITY + MAX_BUFFER_CHUNKS + 100) {
            pipeline
                .dispatch_frame(source_frame(false), ChannelMode::MicAndSpeaker, &routing)
                .await
                .unwrap();
        }

        assert_eq!(pipeline.audio_buffer.len(), MAX_BUFFER_CHUNKS);

        listener_ref.cast(ListenerMsg::StreamEnded).unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(1), probe_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(event, ProbeEvent::ListenerControl));

        handle.abort();
    }

    #[tokio::test]
    async fn listener_ack_timeout_terminates_stuck_actor() {
        let mut pipeline = test_pipeline();
        let (listener_ref, handle) = Actor::spawn(None, StuckListenerProbe, ()).await.unwrap();
        let routing = ListenerRouting::Attached(listener_ref);

        pipeline
            .dispatch_frame(source_frame(false), ChannelMode::MicAndSpeaker, &routing)
            .await
            .unwrap();

        tokio::time::timeout(LISTENER_AUDIO_ACK_TIMEOUT + Duration::from_secs(1), handle)
            .await
            .expect("stuck listener should be terminated after its acknowledgement timeout")
            .unwrap();
    }

    #[tokio::test]
    async fn repeated_listener_backpressure_terminates_actor_and_preserves_replay() {
        let mut pipeline = test_pipeline();
        let (probe_tx, mut probe_rx) = tokio::sync::mpsc::unbounded_channel();
        let (listener_ref, handle) = Actor::spawn(None, BackpressuredListenerProbe(probe_tx), ())
            .await
            .unwrap();
        let routing = ListenerRouting::Attached(listener_ref);

        pipeline
            .dispatch_frame(source_frame(false), ChannelMode::MicAndSpeaker, &routing)
            .await
            .unwrap();

        tokio::time::timeout(
            LISTENER_BACKPRESSURE_TIMEOUT + Duration::from_secs(1),
            handle,
        )
        .await
        .expect("listener should be terminated after sustained backpressure")
        .unwrap();

        let event = tokio::time::timeout(Duration::from_secs(1), probe_rx.recv())
            .await
            .expect("listener post_stop should complete")
            .expect("listener post_stop event");
        assert!(matches!(event, ProbeEvent::ListenerStopped));

        let replay = pipeline.prepare_listener_refresh();
        assert!(replay.duration_secs > 0.0);
        assert_eq!(pipeline.audio_buffer.len(), 1);
    }

    #[tokio::test]
    async fn dropped_listener_clears_backlog_and_stops_future_buffering() {
        let mut pipeline = test_pipeline();

        pipeline
            .dispatch_frame(
                source_frame(false),
                ChannelMode::MicAndSpeaker,
                &ListenerRouting::Buffering,
            )
            .await
            .unwrap();
        assert_eq!(pipeline.audio_buffer.len(), 1);

        pipeline.on_listener_routing_changed(&ListenerRouting::Dropped);
        assert!(pipeline.audio_buffer.is_empty());

        let (probe_tx, mut probe_rx) = tokio::sync::mpsc::unbounded_channel();
        let (listener_ref, handle) = Actor::spawn(None, ListenerProbe(probe_tx), ())
            .await
            .unwrap();

        pipeline.on_listener_routing_changed(&ListenerRouting::Attached(listener_ref));

        pipeline
            .dispatch_frame(
                source_frame(false),
                ChannelMode::MicAndSpeaker,
                &ListenerRouting::Dropped,
            )
            .await
            .unwrap();

        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(200), probe_rx.recv())
                .await
                .is_err()
        );

        handle.abort();
    }

    /// A listener whose `post_stop` takes a while, like one finalizing its stream.
    struct SlowStoppingListenerProbe(tokio::sync::mpsc::UnboundedSender<ProbeEvent>);

    #[ractor::async_trait]
    impl Actor for SlowStoppingListenerProbe {
        type Msg = ListenerMsg;
        type State = ();
        type Arguments = ();

        async fn pre_start(
            &self,
            _myself: ActorRef<Self::Msg>,
            _args: Self::Arguments,
        ) -> Result<Self::State, ActorProcessingErr> {
            Ok(())
        }

        async fn handle(
            &self,
            _myself: ActorRef<Self::Msg>,
            message: Self::Msg,
            _state: &mut Self::State,
        ) -> Result<(), ActorProcessingErr> {
            if let ListenerMsg::AudioSingle(_, reply) | ListenerMsg::AudioDual(_, _, reply) =
                message
            {
                let _ = reply.send(ListenerAudioResult::Accepted);
            }
            Ok(())
        }

        async fn post_stop(
            &self,
            _myself: ActorRef<Self::Msg>,
            _state: &mut Self::State,
        ) -> Result<(), ActorProcessingErr> {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = self.0.send(ProbeEvent::ListenerStopped);
            Ok(())
        }
    }

    /// 120 ms of speaker audio whose samples all carry `value`.
    fn speech_frame(value: f32) -> SourceFrame {
        SourceFrame {
            captured: true,
            capture: CaptureFrame {
                raw_mic: Arc::from(vec![0.0_f32; 1920]),
                raw_speaker: Arc::from(vec![value; 1920]),
                aec_mic: None,
            },
            mic_muted: false,
        }
    }

    fn frame_value(index: usize) -> f32 {
        index as f32 / 1_000.0
    }

    fn frame_sample(index: usize) -> i16 {
        let bytes = f32_to_i16_bytes([frame_value(index)].into_iter());
        i16::from_le_bytes([bytes[0], bytes[1]])
    }

    // Issue #271 : une écoute qui s'arrête (plafond de 90 s sans finalisation)
    // valide son texte provisoire dans `post_stop`. L'audio envoyé pendant cet
    // arrêt échouait en `SendErr` et l'acteur était alors tué, ce qui
    // interrompait `post_stop` et perdait ce texte.
    #[tokio::test]
    async fn audio_sent_to_a_stopping_listener_does_not_interrupt_its_shutdown() {
        let mut pipeline = test_pipeline();
        let (probe_tx, mut probe_rx) = tokio::sync::mpsc::unbounded_channel();
        let (listener, handle) = Actor::spawn(None, SlowStoppingListenerProbe(probe_tx), ())
            .await
            .unwrap();
        let routing = ListenerRouting::Attached(listener.clone());
        pipeline
            .dispatch_frame(speech_frame(0.1), ChannelMode::SpeakerOnly, &routing)
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;

        listener.stop(Some("unfinalized_cap".to_string()));
        tokio::time::sleep(Duration::from_millis(20)).await;
        for index in 0..10 {
            pipeline
                .dispatch_frame(
                    speech_frame(frame_value(index)),
                    ChannelMode::SpeakerOnly,
                    &routing,
                )
                .await
                .unwrap();
        }

        let event = tokio::time::timeout(Duration::from_secs(2), probe_rx.recv())
            .await
            .expect("the stopping listener must finish its post_stop");
        assert!(matches!(event, Some(ProbeEvent::ListenerStopped)));
        handle.await.unwrap();
    }

    // Issue #271 : l'audio capturé entre l'arrêt d'une écoute et sa reconnexion
    // est conservé en mémoire (borné) et rejoué au nouveau flux, au lieu de ne
    // rejouer que les 5 dernières secondes.
    #[tokio::test]
    async fn listener_reconnect_replays_all_audio_the_old_listener_never_accepted() {
        let mut pipeline = test_pipeline();
        let (old_tx, mut old_rx) = tokio::sync::mpsc::unbounded_channel();
        let (old_listener, old_handle) = Actor::spawn(None, OrderingListenerProbe(old_tx), ())
            .await
            .unwrap();
        let old_routing = ListenerRouting::Attached(old_listener.clone());
        for index in 1..=10 {
            pipeline
                .dispatch_frame(
                    speech_frame(frame_value(index)),
                    ChannelMode::SpeakerOnly,
                    &old_routing,
                )
                .await
                .unwrap();
        }
        for _ in 1..=10 {
            tokio::time::timeout(Duration::from_secs(1), old_rx.recv())
                .await
                .unwrap()
                .unwrap();
        }

        // The listener stops; audio keeps arriving while it shuts down, then
        // while the session waits to reconnect (batch fallback drops routing).
        old_listener.stop(None);
        old_handle.await.unwrap();
        for index in 11..=30 {
            pipeline
                .dispatch_frame(
                    speech_frame(frame_value(index)),
                    ChannelMode::SpeakerOnly,
                    &old_routing,
                )
                .await
                .unwrap();
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        pipeline.on_listener_routing_changed(&ListenerRouting::Dropped);
        for index in 31..=80 {
            pipeline
                .dispatch_frame(
                    speech_frame(frame_value(index)),
                    ChannelMode::SpeakerOnly,
                    &ListenerRouting::Dropped,
                )
                .await
                .unwrap();
        }

        // 70 undelivered frames (8.4 s) plus the 1.2 s already delivered.
        let replay = pipeline.prepare_listener_refresh();
        assert!(
            (replay.duration_secs - 9.6).abs() < 1e-6,
            "replayed {:.2} s instead of every undelivered frame",
            replay.duration_secs
        );

        let (new_tx, mut new_rx) = tokio::sync::mpsc::unbounded_channel();
        let (new_listener, new_handle) = Actor::spawn(None, OrderingListenerProbe(new_tx), ())
            .await
            .unwrap();
        let new_routing = ListenerRouting::Attached(new_listener);
        pipeline.on_listener_routing_changed(&new_routing);
        // Live frames keep coming; each one also drains part of the backlog.
        let mut received = Vec::new();
        for index in 81..=160 {
            pipeline
                .dispatch_frame(
                    speech_frame(frame_value(index)),
                    ChannelMode::SpeakerOnly,
                    &new_routing,
                )
                .await
                .unwrap();
            while let Ok(Some(sample)) =
                tokio::time::timeout(Duration::from_millis(5), new_rx.recv()).await
            {
                received.push(sample);
            }
        }
        assert!(
            received.len() >= 81,
            "only {} frames delivered",
            received.len()
        );
        assert_eq!(
            received[..81],
            (1..=81).map(frame_sample).collect::<Vec<_>>(),
            "every frame is replayed once, in order, before live audio"
        );
        new_handle.abort();
    }

    #[test]
    fn replay_stays_bounded_in_memory_and_within_the_buffer() {
        assert!(MAX_REPLAY_SECS * SAMPLE_RATE as usize <= MAX_BUFFER_CHUNKS * 1920 / 2);
        let mut history = ReplayHistory::new(SAMPLE_RATE as usize * MAX_REPLAY_SECS);
        for _ in 0..1_000 {
            history.push(BufferedAudio::new(
                Arc::from(vec![0.0_f32; 1920]),
                Arc::from(vec![0.0_f32; 1920]),
                ChannelMode::MicAndSpeaker,
                0,
            ));
        }
        assert!(history.duration_secs() <= MAX_REPLAY_SECS as f64);
    }

    #[test]
    fn select_tracks_picks_mic_by_availability_mute_and_mode() {
        for (mic_muted, aec_mic, mode, expected_mic, label) in [
            (
                false,
                true,
                ChannelMode::MicAndSpeaker,
                vec![0.1, -0.1, 0.2, -0.2],
                "prefers aec mic",
            ),
            (
                false,
                false,
                ChannelMode::MicAndSpeaker,
                vec![0.25, -0.25, 0.5, -0.5],
                "falls back to raw mic",
            ),
            (
                true,
                true,
                ChannelMode::MicAndSpeaker,
                vec![0.0, 0.0, 0.0, 0.0],
                "zeroes muted mic",
            ),
            (
                false,
                true,
                ChannelMode::SpeakerOnly,
                vec![0.0, 0.0, 0.0, 0.0],
                "zeroes mic for speaker only",
            ),
        ] {
            let mut frame = source_frame(mic_muted);
            if !aec_mic {
                frame.capture.aec_mic = None;
            }

            let (mic, speaker) = Pipeline::select_tracks(frame, mode);
            assert_eq!(mic, expected_mic, "case: {label}");
            assert_eq!(&*speaker, &[0.75, -0.75, 1.0, -1.0], "case: {label}");
        }
    }

    fn feed_window(monitor: &mut DropoutMonitor, zero_ratio: f32) {
        let chunk = 1_600;
        let zeros = (chunk as f32 * zero_ratio) as usize;
        let mut frame = vec![0.01_f32; chunk];
        frame[..zeros].fill(0.0);
        for _ in 0..DROPOUT_WINDOW_SAMPLES.div_ceil(chunk) {
            monitor.observe(&frame);
        }
    }

    #[test]
    fn dropout_monitor_reports_gated_mic_once_until_reset() {
        let runtime = Arc::new(DropoutRuntime::default());
        let mut monitor = DropoutMonitor::new(runtime.clone(), "session".to_string());

        feed_window(&mut monitor, 0.3);
        feed_window(&mut monitor, 0.3);

        let reported = runtime.0.lock().unwrap().clone();
        assert_eq!(reported.len(), 1);
        assert!((reported[0] - 0.3).abs() < 0.01, "ratio {}", reported[0]);

        monitor.reset();
        feed_window(&mut monitor, 0.5);

        assert_eq!(runtime.0.lock().unwrap().len(), 2);
    }

    #[test]
    fn dropout_monitor_ignores_healthy_or_not_yet_started_mic() {
        let runtime = Arc::new(DropoutRuntime::default());
        let mut monitor = DropoutMonitor::new(runtime.clone(), "session".to_string());

        feed_window(&mut monitor, 0.1);
        feed_window(&mut monitor, 0.0);

        assert!(runtime.0.lock().unwrap().is_empty());

        let runtime = Arc::new(DropoutRuntime::default());
        let mut monitor = DropoutMonitor::new(runtime.clone(), "session".to_string());

        for _ in 0..20 {
            monitor.observe(&[0.0; 1_600]);
        }
        feed_window(&mut monitor, 0.0);

        assert!(runtime.0.lock().unwrap().is_empty());
    }
}
