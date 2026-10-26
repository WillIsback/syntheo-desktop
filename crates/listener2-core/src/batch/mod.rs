mod accumulator;
mod progressive;
mod simple;
mod upload;

use std::sync::Arc;

use owhisper_client::{AdapterKind, OpenAIAdapter};

use crate::{BatchEvent, BatchRuntime};

use progressive::run_progressive_batch_session;
use simple::run_direct_batch_for_adapter_kind;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, strum::Display, strum::EnumString)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum BatchProvider {
    OpenAI,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BatchParams {
    pub session_id: String,
    pub provider: BatchProvider,
    pub file_path: String,
    #[serde(default)]
    pub model: Option<String>,
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub languages: Vec<anlg_language::Language>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub num_speakers: Option<u32>,
    #[serde(default)]
    pub min_speakers: Option<u32>,
    #[serde(default)]
    pub max_speakers: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum BatchRunMode {
    Direct,
    Streamed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BatchRunOutput {
    pub session_id: String,
    pub mode: BatchRunMode,
    pub response: owhisper_interface::batch::Response,
}

pub async fn run_batch(
    runtime: Arc<dyn BatchRuntime>,
    params: BatchParams,
) -> crate::Result<BatchRunOutput> {
    runtime.emit(BatchEvent::BatchStarted {
        session_id: params.session_id.clone(),
    });

    let session_id = params.session_id.clone();
    let result = run_batch_inner(runtime.clone(), params).await;

    if let Err(error) = &result {
        let (code, message) = match error {
            crate::Error::BatchFailed(failure) => (failure.code(), failure.to_string()),
            _ => (crate::BatchErrorCode::Unknown, error.to_string()),
        };

        runtime.emit(BatchEvent::BatchFailed {
            session_id,
            code,
            error: message,
        });
    } else {
        let output = result.as_ref().unwrap();

        runtime.emit(BatchEvent::BatchResponse {
            session_id: output.session_id.clone(),
            response: output.response.clone(),
            mode: output.mode,
        });
        runtime.emit(BatchEvent::BatchCompleted {
            session_id: output.session_id.clone(),
        });
    }

    result
}

pub fn expects_progressive_batch(params: &BatchParams) -> bool {
    match params.provider {
        BatchProvider::OpenAI => {
            OpenAIAdapter::supports_progressive_batch_model(params.model.as_deref())
        }
    }
}

async fn run_batch_inner(
    runtime: Arc<dyn BatchRuntime>,
    params: BatchParams,
) -> crate::Result<BatchRunOutput> {
    let metadata_joined = tokio::task::spawn_blocking({
        let path = params.file_path.clone();
        move || anlg_audio_utils::audio_file_metadata(path)
    })
    .await;

    let metadata_result = match metadata_joined {
        Ok(result) => result,
        Err(_err) => {
            tracing::error!(error.type = "audio_metadata_task_join_failed", "audio_metadata_task_join_failed");
            return Err(crate::BatchFailure::AudioMetadataJoinFailed.into());
        }
    };

    let metadata = match metadata_result {
        Ok(metadata) => metadata,
        Err(err) => {
            let raw_error = err.to_string();
            let message = format_user_friendly_error(&raw_error);
            log_batch_failure("audio_metadata_read", &raw_error);
            return Err(crate::BatchFailure::AudioMetadataReadFailed { message }.into());
        }
    };

    let listen_params = build_listen_params(&params, metadata.channels, metadata.sample_rate);

    match params.provider {
        BatchProvider::OpenAI => {
            if OpenAIAdapter::supports_progressive_batch_model(listen_params.model.as_deref()) {
                run_progressive_batch_session(runtime, params, listen_params).await
            } else {
                run_direct_batch_for_adapter_kind(AdapterKind::OpenAI, params, listen_params).await
            }
        }
    }
}

fn build_listen_params(
    params: &BatchParams,
    channels: u8,
    sample_rate: u32,
) -> owhisper_interface::ListenParams {
    owhisper_interface::ListenParams {
        model: params.model.clone(),
        channels,
        sample_rate,
        languages: params.languages.clone(),
        keywords: params.keywords.clone(),
        num_speakers: params.num_speakers,
        min_speakers: params.min_speakers,
        max_speakers: params.max_speakers,
        mic_num_speakers: None,
        custom_query: None,
    }
}

pub(super) fn session_span(session_id: &str) -> tracing::Span {
    let _ = session_id;
    tracing::info_span!("session")
}

pub(super) fn log_batch_failure(operation: &str, error: &str) {
    if anlg_user_error::is_user_error_text(error) {
        tracing::warn!(
            anarlog.operation = operation,
            error.type = "user_error",
            "batch_operation_rejected"
        );
    } else {
        tracing::error!(
            anarlog.operation = operation,
            error.type = "batch_operation_failed",
            "batch_operation_failed"
        );
    }
}

pub(super) fn format_user_friendly_error(error: &str) -> String {
    let error_lower = error.to_lowercase();

    if error_lower.contains("401") || error_lower.contains("unauthorized") {
        return "Authentication failed. Please check your API key in settings.".to_string();
    }
    if error_lower.contains("403") || error_lower.contains("forbidden") {
        return "Access denied. Your API key may not have permission for this operation."
            .to_string();
    }
    if error_lower.contains("429") || error_lower.contains("rate limit") {
        return "Rate limit exceeded. Wait a few minutes or check your provider plan's quota, then try again.".to_string();
    }
    if error_lower.contains("timeout") {
        return "Connection timed out. Please check your internet connection and try again."
            .to_string();
    }
    if error_lower.contains("connection refused")
        || error_lower.contains("failed to connect")
        || error_lower.contains("network")
    {
        return "Could not connect to the transcription service. Please check your internet connection.".to_string();
    }
    if error_lower.contains("413")
        || error_lower.contains("payload too large")
        || error_lower.contains("file too large")
        || error_lower.contains("upload limit")
        || error_lower.contains("audio duration")
    {
        return "This recording is too large for the selected transcription provider. Try another provider or split the recording.".to_string();
    }
    if error_lower.contains("invalid audio")
        || error_lower.contains("unsupported format")
        || error_lower.contains("codec")
    {
        return "The audio file format is not supported. Please try a different file.".to_string();
    }
    if error_lower.contains("file not found") || error_lower.contains("no such file") {
        return "Audio file not found. The recording may have been moved or deleted.".to_string();
    }

    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch_params(provider: BatchProvider, base_url: &str) -> BatchParams {
        BatchParams {
            session_id: "session".to_string(),
            provider,
            file_path: "/tmp/audio.wav".to_string(),
            model: None,
            base_url: base_url.to_string(),
            api_key: "key".to_string(),
            languages: vec![anlg_language::ISO639::En.into()],
            keywords: vec![],
            num_speakers: None,
            min_speakers: None,
            max_speakers: None,
        }
    }

    #[test]
    fn build_listen_params_preserves_speaker_options() {
        let mut params = batch_params(BatchProvider::OpenAI, "http://192.168.1.87:8000/v1");
        params.num_speakers = Some(3);
        params.min_speakers = Some(2);
        params.max_speakers = Some(4);

        let listen_params = build_listen_params(&params, 2, 48_000);
        assert_eq!(listen_params.num_speakers, Some(3));
        assert_eq!(listen_params.min_speakers, Some(2));
        assert_eq!(listen_params.max_speakers, Some(4));
        assert_eq!(listen_params.channels, 2);
        assert_eq!(listen_params.sample_rate, 48_000);
        assert!(listen_params.custom_query.is_none());
    }

    #[test]
    fn only_gpt_transcription_models_run_progressively() {
        for (model, expected) in [
            (None, true),
            (Some("gpt-4o-transcribe"), true),
            (Some("gpt-4o-transcribe-diarize"), false),
            (Some("whisper-large-v3"), false),
        ] {
            let mut params = batch_params(BatchProvider::OpenAI, "http://192.168.1.87:8000/v1");
            params.model = model.map(ToOwned::to_owned);
            assert_eq!(expects_progressive_batch(&params), expected, "{model:?}");
        }
    }

    #[test]
    fn provider_size_limit_errors_are_explained() {
        let errors = [
            r#"UnexpectedStatus { status: 400, body: "Audio file exceeds the 25 MB multipart upload limit." }"#,
            r#"UnexpectedStatus { status: 400, body: "{\"error\":{\"message\":\"audio duration 1500.012 seconds is longer than 1400 seconds which is the maximum for this model\"}}" }"#,
        ];

        for error in errors {
            let message = format_user_friendly_error(error);
            assert!(message.starts_with("This recording is too large"));
        }
    }
}
