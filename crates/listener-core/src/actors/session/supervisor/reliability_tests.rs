use std::path::PathBuf;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use ractor::{Actor, ActorRef, ActorStatus, registry};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Duration, timeout};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use super::tests::test_ctx;
use super::{SessionActor, SessionMsg};
use crate::actors::{ListenerActor, ListenerAudioResult, ListenerMsg, RecorderActor, SourceActor};
use crate::{
    ListenerRuntime, SessionDataEvent, SessionErrorEvent, SessionLifecycleEvent,
    SessionProgressEvent,
};

struct TranscriptRuntime {
    events: mpsc::UnboundedSender<SessionDataEvent>,
}

impl anlg_storage::StorageRuntime for TranscriptRuntime {
    fn global_base(&self) -> Result<PathBuf, anlg_storage::Error> {
        Ok(std::env::temp_dir())
    }
    fn vault_base(&self) -> Result<PathBuf, anlg_storage::Error> {
        Ok(std::env::temp_dir())
    }
}

impl ListenerRuntime for TranscriptRuntime {
    fn emit_lifecycle(&self, _event: SessionLifecycleEvent) {}
    fn emit_progress(&self, _event: SessionProgressEvent) {}
    fn emit_error(&self, _event: SessionErrorEvent) {}
    fn emit_data(&self, event: SessionDataEvent) {
        let _ = self.events.send(event);
    }
}

/// OpenAI Realtime transcription event for `word`: a completed item when
/// final, a delta otherwise. The item ID is derived from the word so a
/// repeated final replays the same item.
fn response(word: &str, is_final: bool) -> Message {
    let raw = if is_final {
        serde_json::json!({
            "type": "conversation.item.input_audio_transcription.completed",
            "event_id": format!("event-{word}"),
            "item_id": format!("item-{word}"),
            "content_index": 0,
            "transcript": format!("{word} speech"),
        })
    } else {
        serde_json::json!({
            "type": "conversation.item.input_audio_transcription.delta",
            "event_id": format!("event-{word}"),
            "item_id": format!("item-{word}"),
            "content_index": 0,
            "delta": format!("{word} speech"),
        })
    };
    Message::Text(raw.to_string().into())
}

fn is_audio(message: &Message) -> bool {
    matches!(message, Message::Text(text) if text.contains("input_audio_buffer.append"))
}

async fn wait_for_word(events: &mut mpsc::UnboundedReceiver<SessionDataEvent>, word: &str) {
    timeout(Duration::from_secs(10), async {
        while let Some(event) = events.recv().await {
            if let SessionDataEvent::TranscriptDelta { delta, .. } = event
                && delta
                    .new_words
                    .iter()
                    .any(|value| value.text.trim() == word)
            {
                return;
            }
        }
        panic!("transcript event channel closed before {word}");
    })
    .await
    .expect("finalized transcript should resume");
}

/// Les deux canaux finalisent dans un ordre quelconque.
async fn wait_for_words(events: &mut mpsc::UnboundedReceiver<SessionDataEvent>, words: &[&str]) {
    let mut missing: Vec<&str> = words.to_vec();
    timeout(Duration::from_secs(10), async {
        while let Some(event) = events.recv().await {
            if let SessionDataEvent::TranscriptDelta { delta, .. } = event {
                missing.retain(|word| {
                    !delta
                        .new_words
                        .iter()
                        .any(|value| value.text.trim() == *word)
                });
                if missing.is_empty() {
                    return;
                }
            }
        }
        panic!("transcript event channel closed before {missing:?}");
    })
    .await
    .expect("both channels should finalize");
}

async fn wait_for_listener(
    session_id: &str,
    previous_id: Option<ractor::ActorId>,
) -> ActorRef<ListenerMsg> {
    timeout(Duration::from_secs(15), async {
        loop {
            if let Some(actor) = registry::where_is(ListenerActor::name(session_id))
                && actor.get_status() == ActorStatus::Running
                && Some(actor.get_id()) != previous_id
            {
                return actor.into();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("listener should connect automatically")
}

fn one_second_of_audio() -> Bytes {
    Bytes::from(
        1000_i16
            .to_le_bytes()
            .repeat(crate::actors::SAMPLE_RATE as usize),
    )
}

async fn send_dual_audio(listener: &ActorRef<ListenerMsg>) {
    let audio = one_second_of_audio();
    assert_eq!(
        ractor::call_t!(listener, ListenerMsg::AudioDual, 1000, audio.clone(), audio).unwrap(),
        ListenerAudioResult::Accepted
    );
}

async fn send_audio(listener: &ActorRef<ListenerMsg>) {
    let audio = Bytes::from(
        1000_i16
            .to_le_bytes()
            .repeat(crate::actors::SAMPLE_RATE as usize),
    );
    assert_eq!(
        ractor::call_t!(listener, ListenerMsg::AudioSingle, 1000, audio).unwrap(),
        ListenerAudioResult::Accepted
    );
}

#[derive(Clone, Copy)]
enum StreamFailure {
    Silent,
    Unfinalized,
}

#[tokio::test]
#[allow(
    clippy::result_large_err,
    reason = "Tungstenite requires an unboxed HTTP response in handshake callbacks"
)]
async fn refreshed_credentials_resume_live_transcription_after_authentication_failure() {
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let (rejected_tx, rejected_rx) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (stream, _) = socket.accept().await.unwrap();
        let rejected = tokio_tungstenite::accept_hdr_async(
            stream,
            |request: &Request, _response: Response| {
                assert_eq!(request.headers()["authorization"], "Bearer test-key");
                Err(Response::builder()
                    .status(401)
                    .body(Some("Expired".into()))
                    .unwrap())
            },
        )
        .await;
        assert!(rejected.is_err());
        rejected_tx.send(()).unwrap();
        let (stream, _) = socket.accept().await.unwrap();
        let mut ws =
            tokio_tungstenite::accept_hdr_async(stream, |request: &Request, response: Response| {
                assert_eq!(request.headers()["authorization"], "Bearer refreshed-token");
                Ok(response)
            })
            .await
            .unwrap();
        while let Some(Ok(message)) = ws.next().await {
            match message {
                message if is_audio(&message) => {
                    ws.send(response("recovered", true)).await.unwrap();
                }
                Message::Text(text) if text.contains("input_audio_buffer.commit") => {
                    let _ = ws.close(None).await;
                    break;
                }
                _ => {}
            }
        }
    });
    let vault = tempfile::tempdir().unwrap();
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let mut ctx = test_ctx();
    ctx.runtime = Arc::new(TranscriptRuntime { events: events_tx });
    ctx.app_dir = vault.path().to_path_buf();
    ctx.params.session_id = uuid::Uuid::new_v4().to_string();
    ctx.params.base_url = format!("http://{address}/v1");
    // Un seul flux : le protocole OpenAI ouvre une connexion par canal.
    ctx.params.onboarding = true;
    ctx.params.model = "cloud".into();
    ctx.params.retain_audio = Some(false);
    let session_id = ctx.params.session_id.clone();
    let (supervisor, supervisor_task) = Actor::spawn(None, SessionActor, ctx).await.unwrap();
    timeout(Duration::from_secs(10), rejected_rx)
        .await
        .unwrap()
        .unwrap();
    supervisor
        .cast(SessionMsg::UpdateCredentials("refreshed-token".into()))
        .unwrap();
    let listener = wait_for_listener(&session_id, None).await;
    send_audio(&listener).await;
    wait_for_word(&mut events, "recovered").await;
    supervisor.cast(SessionMsg::Shutdown).unwrap();
    timeout(Duration::from_secs(10), supervisor_task)
        .await
        .unwrap()
        .unwrap();
    timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        audio_files_in(&vault.path().join(&session_id)),
        Vec::<PathBuf>::new()
    );
}

fn audio_files_in(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if name == "audio-recovery" {
                found.push(path.clone());
            }
            found.extend(audio_files_in(&path));
        } else if name == ".delete-audio-on-stop"
            || ["mp3", "wav", "ogg", "part"]
                .iter()
                .any(|ext| path.extension().and_then(|e| e.to_str()) == Some(*ext))
        {
            found.push(path);
        }
    }
    found
}

// Règle audio de Syntheo : aucune session n'écrit d'audio sur disque, même si
// l'appelant demande de le conserver.
#[tokio::test]
async fn supervisor_writes_no_audio_to_session_dir() {
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = socket.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        while let Some(Ok(message)) = ws.next().await {
            match message {
                message if is_audio(&message) => {
                    ws.send(response("live", true)).await.unwrap();
                }
                Message::Text(text) if text.contains("input_audio_buffer.commit") => {
                    let _ = ws.close(None).await;
                    break;
                }
                _ => {}
            }
        }
    });
    let vault = tempfile::tempdir().unwrap();
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let mut ctx = test_ctx();
    ctx.runtime = Arc::new(TranscriptRuntime { events: events_tx });
    ctx.app_dir = vault.path().to_path_buf();
    ctx.params.session_id = uuid::Uuid::new_v4().to_string();
    ctx.params.base_url = format!("http://{address}/v1");
    // Un seul flux : le protocole OpenAI ouvre une connexion par canal.
    ctx.params.onboarding = true;
    ctx.params.model = "cloud".into();
    ctx.params.retain_audio = Some(true);
    let session_id = ctx.params.session_id.clone();
    let (supervisor, supervisor_task) = Actor::spawn(None, SessionActor, ctx).await.unwrap();
    let listener = wait_for_listener(&session_id, None).await;
    for _ in 0..3 {
        send_audio(&listener).await;
    }
    wait_for_word(&mut events, "live").await;
    assert!(
        registry::where_is(RecorderActor::name(&session_id)).is_none(),
        "no recorder actor may run for a capture session"
    );
    supervisor.cast(SessionMsg::Shutdown).unwrap();
    timeout(Duration::from_secs(10), supervisor_task)
        .await
        .unwrap()
        .unwrap();
    let _ = timeout(Duration::from_secs(5), server).await;
    assert_eq!(
        audio_files_in(&vault.path().join(&session_id)),
        Vec::<PathBuf>::new()
    );
}

#[tokio::test]
async fn live_words_resume_after_stalled_streams_without_restarting_source() {
    // Un serveur OpenAI Realtime ne renvoie jamais un item déjà complété :
    // la déduplication des finaux répétés est couverte par stream.rs.
    for failure in [StreamFailure::Silent, StreamFailure::Unfinalized] {
        let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for connection in 0..2 {
                let (stream, _) = socket.accept().await.unwrap();
                let mut ws = accept_async(stream).await.unwrap();
                let mut first_audio = true;
                while let Some(Ok(message)) = ws.next().await {
                    match message {
                        message if is_audio(&message) => {
                            if first_audio || connection == 1 {
                                ws.send(response(
                                    if connection == 0 { "before" } else { "after" },
                                    true,
                                ))
                                .await
                                .unwrap();
                                first_audio = false;
                            } else {
                                let update = match failure {
                                    StreamFailure::Silent => None,
                                    StreamFailure::Unfinalized => {
                                        Some(response("unfinished", false))
                                    }
                                };
                                if let Some(update) = update
                                    && ws.send(update).await.is_err()
                                {
                                    break;
                                }
                            }
                        }
                        Message::Text(text) if text.contains("input_audio_buffer.commit") => {
                            let _ = ws.close(None).await;
                            break;
                        }
                        _ => {}
                    }
                }
            }
        });
        let vault = tempfile::tempdir().unwrap();
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let mut ctx = test_ctx();
        ctx.runtime = Arc::new(TranscriptRuntime { events: events_tx });
        ctx.app_dir = vault.path().to_path_buf();
        ctx.params.session_id = uuid::Uuid::new_v4().to_string();
        ctx.params.base_url = format!("http://{address}/v1");
        // Un seul flux : le protocole OpenAI ouvre une connexion par canal.
        ctx.params.onboarding = true;
        ctx.params.model = "cloud".to_string();
        let session_id = ctx.params.session_id.clone();
        let (supervisor, supervisor_task) = Actor::spawn(None, SessionActor, ctx).await.unwrap();
        let listener = wait_for_listener(&session_id, None).await;
        let source = registry::where_is(SourceActor::name(&session_id)).unwrap();
        send_audio(&listener).await;
        wait_for_word(&mut events, "before").await;

        match failure {
            StreamFailure::Unfinalized => {
                for _ in 0..89 {
                    send_audio(&listener).await;
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            }
            StreamFailure::Silent => {
                tokio::time::sleep(Duration::from_secs(30)).await;
                for _ in 0..4 {
                    send_audio(&listener).await;
                }
            }
        }
        // The first finalized response resets the audio count for the stalled period.
        send_audio(&listener).await;
        let recovered = wait_for_listener(&session_id, Some(listener.get_id())).await;
        assert_eq!(
            registry::where_is(SourceActor::name(&session_id))
                .unwrap()
                .get_id(),
            source.get_id()
        );
        send_audio(&recovered).await;
        wait_for_word(&mut events, "after").await;
        supervisor.cast(SessionMsg::Shutdown).unwrap();
        timeout(Duration::from_secs(10), supervisor_task)
            .await
            .unwrap()
            .unwrap();
        timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            audio_files_in(&vault.path().join(&session_id)),
            Vec::<PathBuf>::new()
        );
    }
}

// Chemin d'une vraie réunion : micro et haut-parleur, une connexion OpenAI
// Realtime par canal. Après un blocage, les deux connexions sont rouvertes
// sans redémarrer la capture.
#[tokio::test]
async fn meeting_capture_uses_one_connection_per_channel_and_recovers_from_a_stall() {
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut handlers = Vec::new();
        for connection in 0..4 {
            let (stream, _) = socket.accept().await.unwrap();
            handlers.push(tokio::spawn(async move {
                let mut ws = accept_async(stream).await.unwrap();
                let mut first_audio = true;
                while let Some(Ok(message)) = ws.next().await {
                    match message {
                        message if is_audio(&message) => {
                            let update = match connection {
                                0 if first_audio => Some(response("alpha", true)),
                                1 if first_audio => Some(response("bravo", true)),
                                0 | 1 => Some(response("unfinished", false)),
                                _ => Some(response("after", true)),
                            };
                            first_audio = false;
                            if let Some(update) = update
                                && ws.send(update).await.is_err()
                            {
                                break;
                            }
                        }
                        Message::Text(text) if text.contains("input_audio_buffer.commit") => {
                            let _ = ws.close(None).await;
                            break;
                        }
                        _ => {}
                    }
                }
            }));
        }
        for handler in handlers {
            handler.await.unwrap();
        }
    });
    let vault = tempfile::tempdir().unwrap();
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let mut ctx = test_ctx();
    ctx.runtime = Arc::new(TranscriptRuntime { events: events_tx });
    ctx.app_dir = vault.path().to_path_buf();
    ctx.params.session_id = uuid::Uuid::new_v4().to_string();
    ctx.params.base_url = format!("http://{address}/v1");
    ctx.params.onboarding = false;
    ctx.params.model = "cloud".to_string();
    let session_id = ctx.params.session_id.clone();
    let (supervisor, supervisor_task) = Actor::spawn(None, SessionActor, ctx).await.unwrap();
    let listener = wait_for_listener(&session_id, None).await;
    let source = registry::where_is(SourceActor::name(&session_id)).unwrap();
    send_dual_audio(&listener).await;
    wait_for_words(&mut events, &["alpha", "bravo"]).await;

    for _ in 0..90 {
        send_dual_audio(&listener).await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let recovered = wait_for_listener(&session_id, Some(listener.get_id())).await;
    assert_eq!(
        registry::where_is(SourceActor::name(&session_id))
            .unwrap()
            .get_id(),
        source.get_id()
    );
    send_dual_audio(&recovered).await;
    wait_for_word(&mut events, "after").await;
    supervisor.cast(SessionMsg::Shutdown).unwrap();
    timeout(Duration::from_secs(10), supervisor_task)
        .await
        .unwrap()
        .unwrap();
    timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        audio_files_in(&vault.path().join(&session_id)),
        Vec::<PathBuf>::new()
    );
}
