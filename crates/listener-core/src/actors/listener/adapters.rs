use std::time::{Duration, UNIX_EPOCH};

use bytes::Bytes;
use ractor::{ActorProcessingErr, ActorRef};

use owhisper_client::{
    AdapterKind, NvidiaAdapter, OpenAIAdapter, RealtimeSttAdapter, syntheo_ws_client,
};
use owhisper_interface::stream::{Extra, StreamResponse};
use owhisper_interface::{ControlMessage, MixedMessage};

use super::stream::process_stream;
use super::{
    ChannelSender, ListenerArgs, ListenerMsg, actor_error, actor_error_with_degraded,
    actor_error_with_degraded_retry,
};

use crate::{DegradedError, SessionErrorEvent};

fn client_build_error(args: &ListenerArgs, error: owhisper_client::Error) -> ActorProcessingErr {
    let message = error.to_string();
    args.runtime.emit_error(SessionErrorEvent::ConnectionError {
        session_id: args.session_id.clone(),
        error: message.clone(),
    });

    match error {
        owhisper_client::Error::ProviderConfiguration { provider, message } => {
            actor_error_with_degraded(
                format!("listen_provider_configuration_failed: {provider}: {message}"),
                DegradedError::ProviderConfiguration { provider, message },
            )
        }
        _ => actor_error(format!("listen_client_build_failed: {message}")),
    }
}

fn classify_ws_connect_failure(provider: &str, error: &syntheo_ws_client::Error) -> DegradedError {
    if error.is_auth_error() {
        return DegradedError::AuthenticationFailed {
            provider: provider.to_string(),
        };
    }

    match error {
        syntheo_ws_client::Error::InvalidRequest { message }
        | syntheo_ws_client::Error::ConnectFailed {
            message,
            status_code: Some(400 | 402 | 404 | 422),
            ..
        } => DegradedError::ProviderConfiguration {
            provider: provider.to_string(),
            message: message.clone(),
        },
        _ => DegradedError::UpstreamUnavailable {
            message: error.to_string(),
        },
    }
}

fn ws_connect_error(args: &ListenerArgs, error: syntheo_ws_client::Error) -> ActorProcessingErr {
    let provider =
        AdapterKind::from_url_and_languages(&args.base_url, &args.languages, Some(&args.model))
            .to_string();
    let message = format!("listen_ws_connect_failed: {error:?}");

    tracing::warn!(
        syntheo.session.id = %args.session_id,
        syntheo.stt.provider.name = %provider,
        error.message = ?error,
        "listen_ws_connect_failed"
    );
    args.runtime.emit_error(SessionErrorEvent::ConnectionError {
        session_id: args.session_id.clone(),
        error: message.clone(),
    });

    let retry_after = error.retry_after_secs().map(Duration::from_secs);
    actor_error_with_degraded_retry(
        message,
        classify_ws_connect_failure(&provider, &error),
        retry_after,
    )
}

pub(super) async fn spawn_rx_task(
    args: ListenerArgs,
    myself: ActorRef<ListenerMsg>,
) -> Result<
    (
        ChannelSender,
        tokio::task::JoinHandle<Vec<StreamResponse>>,
        tokio::sync::oneshot::Sender<()>,
        String,
    ),
    ActorProcessingErr,
> {
    if args.transcription_mode != crate::TranscriptionMode::Live {
        return Err(actor_error(
            "listener_batch_mode: live listener is disabled for batch transcription",
        ));
    }

    let adapter_kind =
        AdapterKind::from_url_and_languages(&args.base_url, &args.languages, Some(&args.model));
    let is_dual = matches!(args.mode, crate::actors::ChannelMode::MicAndSpeaker);

    let result = match (adapter_kind, is_dual) {
        (AdapterKind::OpenAI, false) => {
            spawn_rx_task_single_with_adapter::<OpenAIAdapter>(args, myself).await
        }
        (AdapterKind::OpenAI, true) => {
            spawn_rx_task_dual_with_adapter::<OpenAIAdapter>(args, myself).await
        }
        (AdapterKind::Nvidia, false) => {
            spawn_rx_task_single_with_adapter::<NvidiaAdapter>(args, myself).await
        }
        (AdapterKind::Nvidia, true) => {
            spawn_rx_task_dual_with_adapter::<NvidiaAdapter>(args, myself).await
        }
    }?;

    Ok((result.0, result.1, result.2, adapter_kind.to_string()))
}

fn build_listen_params(args: &ListenerArgs) -> owhisper_interface::ListenParams {
    let redemption_time_ms = if args.onboarding { "60" } else { "400" };
    let custom_query = std::collections::HashMap::from([(
        "redemption_time_ms".to_string(),
        redemption_time_ms.to_string(),
    )]);
    let num_speakers = expected_speakers(args);

    owhisper_interface::ListenParams {
        model: Some(args.model.clone()),
        languages: args.languages.clone(),
        sample_rate: super::super::SAMPLE_RATE,
        keywords: args.keywords.clone(),
        num_speakers,
        max_speakers: num_speakers,
        mic_num_speakers: args.mic_isolated.then_some(1),
        custom_query: Some(custom_query),
        ..Default::default()
    }
}

fn expected_speakers(args: &ListenerArgs) -> Option<u32> {
    crate::expected_speakers_per_channel(&args.participant_human_ids, args.self_human_id.as_deref())
}

fn build_extra(args: &ListenerArgs) -> (f64, Extra) {
    let session_offset_secs = args
        .stream_offset_secs
        .unwrap_or_else(|| args.session_started_at.elapsed().as_secs_f64());
    let started_unix_millis = args
        .session_started_at_unix
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis()
        .min(u64::MAX as u128) as u64;

    let extra = Extra {
        started_unix_millis,
    };

    (session_offset_secs, extra)
}

fn desktop_connect_policy() -> syntheo_ws_client::client::WebSocketConnectPolicy {
    syntheo_ws_client::client::WebSocketConnectPolicy {
        connect_timeout: Duration::from_secs(4),
        max_attempts: 1,
        retry_delay: Duration::from_secs(1),
    }
}

async fn spawn_rx_task_single_with_adapter<A: RealtimeSttAdapter>(
    args: ListenerArgs,
    myself: ActorRef<ListenerMsg>,
) -> Result<
    (
        ChannelSender,
        tokio::task::JoinHandle<Vec<StreamResponse>>,
        tokio::sync::oneshot::Sender<()>,
    ),
    ActorProcessingErr,
> {
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let (session_offset_secs, extra) = build_extra(&args);

    let (tx, rx) = tokio::sync::mpsc::channel::<MixedMessage<Bytes, ControlMessage>>(32);

    let client = owhisper_client::ListenClient::builder()
        .adapter::<A>()
        .api_base(args.base_url.clone())
        .api_key(args.api_key.clone())
        .params(build_listen_params(&args))
        .connect_policy(desktop_connect_policy())
        .build_single()
        .await
        .map_err(|error| client_build_error(&args, error))?;

    let outbound = tokio_stream::wrappers::ReceiverStream::new(rx);

    let (listen_stream, handle) = client
        .from_realtime_audio(outbound)
        .await
        .map_err(|error| ws_connect_error(&args, error))?;

    let rx_task = tokio::spawn(async move {
        futures_util::pin_mut!(listen_stream);
        process_stream(
            listen_stream,
            handle,
            myself,
            shutdown_rx,
            session_offset_secs,
            extra,
            Some(super::LISTEN_STREAM_TIMEOUT),
        )
        .await
    });

    Ok((ChannelSender::Single(tx), rx_task, shutdown_tx))
}

async fn spawn_rx_task_dual_with_adapter<A: RealtimeSttAdapter>(
    args: ListenerArgs,
    myself: ActorRef<ListenerMsg>,
) -> Result<
    (
        ChannelSender,
        tokio::task::JoinHandle<Vec<StreamResponse>>,
        tokio::sync::oneshot::Sender<()>,
    ),
    ActorProcessingErr,
> {
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let (session_offset_secs, extra) = build_extra(&args);

    let (tx, rx) = tokio::sync::mpsc::channel::<MixedMessage<(Bytes, Bytes), ControlMessage>>(32);

    let client = owhisper_client::ListenClient::builder()
        .adapter::<A>()
        .api_base(args.base_url.clone())
        .api_key(args.api_key.clone())
        .params(build_listen_params(&args))
        .connect_policy(desktop_connect_policy())
        .build_dual()
        .await
        .map_err(|error| client_build_error(&args, error))?;

    let outbound = tokio_stream::wrappers::ReceiverStream::new(rx);

    let (listen_stream, handle) = client
        .from_realtime_audio(outbound)
        .await
        .map_err(|error| ws_connect_error(&args, error))?;

    let rx_task = tokio::spawn(async move {
        futures_util::pin_mut!(listen_stream);
        process_stream(
            listen_stream,
            handle,
            myself,
            shutdown_rx,
            session_offset_secs,
            extra,
            Some(super::LISTEN_STREAM_TIMEOUT),
        )
        .await
    });

    Ok((ChannelSender::Dual(tx), rx_task, shutdown_tx))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::{Instant, SystemTime};

    use super::*;

    struct NoopRuntime;

    impl syntheo_storage::StorageRuntime for NoopRuntime {
        fn global_base(&self) -> Result<std::path::PathBuf, syntheo_storage::Error> {
            Ok(std::path::PathBuf::from("/tmp"))
        }

        fn vault_base(&self) -> Result<std::path::PathBuf, syntheo_storage::Error> {
            Ok(std::path::PathBuf::from("/tmp"))
        }
    }

    impl crate::ListenerRuntime for NoopRuntime {
        fn emit_lifecycle(&self, _event: crate::SessionLifecycleEvent) {}

        fn emit_progress(&self, _event: crate::SessionProgressEvent) {}

        fn emit_data(&self, _event: crate::SessionDataEvent) {}

        fn emit_error(&self, _event: crate::SessionErrorEvent) {}
    }

    fn listener_args(base_url: &str, model: &str) -> ListenerArgs {
        ListenerArgs {
            runtime: Arc::new(NoopRuntime),
            languages: vec![syntheo_language::ISO639::En.into()],
            onboarding: false,
            model: model.to_string(),
            base_url: base_url.to_string(),
            api_key: String::new(),
            keywords: vec![],
            transcription_mode: crate::TranscriptionMode::Live,
            mode: crate::actors::ChannelMode::MicOnly,
            session_started_at: Instant::now(),
            session_started_at_unix: SystemTime::now(),
            stream_offset_secs: None,
            session_id: "session".to_string(),
            participant_human_ids: vec![],
            self_human_id: None,
            speaker_assignments: vec![],
            live_transcript: Default::default(),
            mic_isolated: false,
        }
    }

    #[test]
    fn listen_params_leave_speaker_counts_open() {
        for (label, base_url, model, participants, self_human_id) in [
            (
                "openai repeated attendance",
                "http://192.168.1.87:8000/v1",
                "mistralai/Voxtral-Mini-4B-Realtime-2602",
                vec!["remote-a", "self", "remote-b", "remote-a"],
                Some("self"),
            ),
            (
                "openai no remote participants",
                "http://192.168.1.87:8000/v1",
                "mistralai/Voxtral-Mini-4B-Realtime-2602",
                vec![],
                Some("self"),
            ),
            (
                "openai self only",
                "http://192.168.1.87:8000/v1",
                "mistralai/Voxtral-Mini-4B-Realtime-2602",
                vec!["self"],
                Some("self"),
            ),
            (
                "openai one remote",
                "http://192.168.1.87:8000/v1",
                "mistralai/Voxtral-Mini-4B-Realtime-2602",
                vec!["remote"],
                Some("self"),
            ),
            (
                "nvidia",
                "https://asr.example/v1/realtime?provider=nvidia",
                "nemotron-asr-streaming",
                vec!["remote"],
                Some("self"),
            ),
            (
                "syntheo proxy",
                "https://api.example.com/stt",
                "cloud",
                vec!["self", "remote-a", "remote-b"],
                Some("self"),
            ),
        ] {
            let mut args = listener_args(base_url, model);
            args.participant_human_ids = participants.iter().map(|id| id.to_string()).collect();
            args.self_human_id = self_human_id.map(|id| id.to_string());

            assert_eq!(expected_speakers(&args), None, "case: {label}");

            let params = build_listen_params(&args);
            let custom_query = params.custom_query.expect("custom query");

            assert_eq!(params.num_speakers, None, "case: {label}");
            assert_eq!(params.max_speakers, None, "case: {label}");
            assert!(
                !custom_query.contains_key("speaker_labels"),
                "case: {label}"
            );
            assert!(!custom_query.contains_key("max_speakers"), "case: {label}");
        }
    }

    #[test]
    fn listen_params_count_only_isolated_mic_as_single_speaker() {
        let mut args = listener_args(
            "http://192.168.1.87:8000/v1",
            "mistralai/Voxtral-Mini-4B-Realtime-2602",
        );
        args.mic_isolated = true;

        let params = build_listen_params(&args);
        assert_eq!(params.mic_num_speakers, Some(1));
        assert_eq!(params.num_speakers, None);

        let args = listener_args(
            "http://192.168.1.87:8000/v1",
            "mistralai/Voxtral-Mini-4B-Realtime-2602",
        );
        let params = build_listen_params(&args);
        assert_eq!(params.mic_num_speakers, None);
    }

    #[test]
    fn build_extra_prefers_explicit_stream_offset() {
        let mut args = listener_args(
            "http://192.168.1.87:8000/v1",
            "mistralai/Voxtral-Mini-4B-Realtime-2602",
        );
        args.stream_offset_secs = Some(12.5);

        let (offset_secs, _) = build_extra(&args);

        assert_eq!(offset_secs, 12.5);
    }

    #[test]
    fn websocket_connect_failures_are_classified() {
        let error = syntheo_ws_client::Error::ConnectFailed {
            attempt: 1,
            max_attempts: 3,
            message: "HTTP 401 Unauthorized".to_string(),
            is_auth: true,
            status_code: Some(401),
            retryable: false,
            retry_after_secs: None,
        };
        assert!(matches!(
            classify_ws_connect_failure("openai", &error),
            DegradedError::AuthenticationFailed { provider } if provider == "openai"
        ));

        let error = syntheo_ws_client::Error::ConnectFailed {
            attempt: 1,
            max_attempts: 3,
            message: "HTTP 400 Bad Request".to_string(),
            is_auth: false,
            status_code: Some(400),
            retryable: false,
            retry_after_secs: None,
        };
        assert!(matches!(
            classify_ws_connect_failure("openai", &error),
            DegradedError::ProviderConfiguration { provider, message }
                if provider == "openai" && message == "HTTP 400 Bad Request"
        ));

        let error = syntheo_ws_client::Error::ConnectRetriesExhausted {
            attempts: 3,
            last_error: "HTTP 503 Service Unavailable".to_string(),
            retry_after_secs: None,
        };
        assert!(matches!(
            classify_ws_connect_failure("openai", &error),
            DegradedError::UpstreamUnavailable { .. }
        ));
    }

    #[test]
    fn websocket_retry_after_reaches_the_session_supervisor() {
        let error = syntheo_ws_client::Error::ConnectFailed {
            attempt: 1,
            max_attempts: 1,
            message: "HTTP 503 Service Unavailable".to_string(),
            is_auth: false,
            status_code: Some(503),
            retryable: true,
            retry_after_secs: Some(7),
        };

        let error = ws_connect_error(
            &listener_args("https://api.example.com/stt", "cloud"),
            error,
        );
        let error = error
            .downcast_ref::<super::super::ListenerInitError>()
            .expect("listener init error");

        assert_eq!(error.retry_after, Some(Duration::from_secs(7)));
    }
}
