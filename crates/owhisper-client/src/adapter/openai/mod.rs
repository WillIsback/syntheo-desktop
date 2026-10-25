mod batch;
mod live;

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use openai_transcription::batch::AudioModel;

use crate::providers::Provider;

use super::{LanguageQuality, LanguageSupport};

#[derive(Clone, Default)]
pub struct OpenAIAdapter {
    live_state: Arc<Mutex<OpenAILiveState>>,
}

#[derive(Default)]
struct OpenAILiveState {
    input_sample_rate: u32,
    fallback_end_ms: u64,
    item_order: VecDeque<String>,
    items: HashMap<String, OpenAILiveItem>,
}

#[derive(Default)]
struct OpenAILiveItem {
    start_ms: Option<u64>,
    end_ms: Option<u64>,
    transcript: String,
    completed_transcript: Option<String>,
}

impl OpenAIAdapter {
    pub fn for_live_sample_rate(input_sample_rate: u32) -> Self {
        Self {
            live_state: Arc::new(Mutex::new(OpenAILiveState {
                input_sample_rate,
                ..Default::default()
            })),
        }
    }

    pub fn language_support_live(_languages: &[anlg_language::Language]) -> LanguageSupport {
        LanguageSupport::Supported {
            quality: LanguageQuality::NoData,
        }
    }

    pub fn language_support_batch(_languages: &[anlg_language::Language]) -> LanguageSupport {
        Self::language_support_live(_languages)
    }

    pub fn is_supported_languages_live(languages: &[anlg_language::Language]) -> bool {
        Self::language_support_live(languages).is_supported()
    }

    pub fn is_supported_languages_batch(languages: &[anlg_language::Language]) -> bool {
        Self::language_support_batch(languages).is_supported()
    }

    /// `None` means a model the OpenAI API does not know (Voxtral, Whisper on
    /// vLLM...): it is sent verbatim through the generic
    /// `/v1/audio/transcriptions` path instead of being replaced.
    pub(crate) fn resolve_batch_model(model: Option<&str>) -> Option<AudioModel> {
        let default = || {
            Provider::OpenAI
                .default_batch_model()
                .parse()
                .expect("invalid_default_openai_batch_model")
        };

        match model {
            Some(value) if crate::providers::is_meta_model(value) => Some(default()),
            Some(value) => value.parse().ok(),
            None => Some(default()),
        }
    }

    /// File-only models of the OpenAI API (`whisper-1`, `gpt-transcribe`...).
    /// Any other name, notably an on-prem realtime model, can stream live.
    pub fn is_batch_only_model(model: &str) -> bool {
        !crate::providers::is_meta_model(model) && model.parse::<AudioModel>().is_ok()
    }

    pub fn supports_progressive_batch_model(model: Option<&str>) -> bool {
        matches!(
            Self::resolve_batch_model(model),
            Some(
                AudioModel::GptTranscribe
                    | AudioModel::Gpt4oTranscribe
                    | AudioModel::Gpt4oMiniTranscribe
                    | AudioModel::Gpt4oMiniTranscribe20251215
            )
        )
    }

    /// The configured base URL is kept as typed: scheme (`http` → `ws`),
    /// host, port and any reverse-proxy path prefix. Only the local Anarlog
    /// `/stt` proxy is rewritten. The desktop's `?provider=` marker is dropped.
    pub(crate) fn build_ws_url_from_base(api_base: &str) -> (url::Url, Vec<(String, String)>) {
        if super::is_anarlog_proxy(api_base)
            && let Some(proxy_result) = super::build_proxy_ws_url(api_base)
        {
            return proxy_result;
        }

        let mut url: url::Url = api_base.parse().expect("invalid_api_base");
        let mut params: Vec<(String, String)> = super::extract_query_params(&url)
            .into_iter()
            .filter(|(key, _)| key != "provider")
            .collect();
        if !params.iter().any(|(key, _)| key == "intent") {
            params.push(("intent".to_string(), "transcription".to_string()));
        }

        let scheme = if matches!(url.scheme(), "http" | "ws") {
            "ws"
        } else {
            "wss"
        };
        url.set_scheme(scheme).expect("invalid_api_base_scheme");
        url.set_query(None);
        let path = url.path().trim_end_matches('/').to_string();
        if !path.ends_with("/realtime") {
            url.set_path(&format!("{path}/realtime"));
        }

        (url, params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_batch_model_keeps_unknown_models() {
        assert_eq!(
            OpenAIAdapter::resolve_batch_model(Some("whisper-large-v3")),
            None
        );
        assert_eq!(
            OpenAIAdapter::resolve_batch_model(Some("whisper-1")),
            Some(AudioModel::Whisper1)
        );
        assert_eq!(
            OpenAIAdapter::resolve_batch_model(Some("auto")),
            Some(AudioModel::GptTranscribe)
        );
        assert_eq!(
            OpenAIAdapter::resolve_batch_model(None),
            Some(AudioModel::GptTranscribe)
        );
    }

    #[test]
    fn progressive_batch_rejects_custom_models() {
        assert!(!OpenAIAdapter::supports_progressive_batch_model(Some(
            "whisper-large-v3"
        )));
    }

    #[test]
    fn progressive_batch_only_supports_non_diarized_gpt_models() {
        assert!(OpenAIAdapter::supports_progressive_batch_model(Some(
            "gpt-transcribe"
        )));
        assert!(OpenAIAdapter::supports_progressive_batch_model(Some(
            "gpt-4o-transcribe"
        )));
        assert!(OpenAIAdapter::supports_progressive_batch_model(Some(
            "gpt-4o-mini-transcribe"
        )));
        assert!(!OpenAIAdapter::supports_progressive_batch_model(Some(
            "gpt-4o-transcribe-diarize"
        )));
        assert!(!OpenAIAdapter::supports_progressive_batch_model(Some(
            "whisper-1"
        )));
        assert!(OpenAIAdapter::supports_progressive_batch_model(None));
    }

    #[test]
    fn build_ws_url_resolves_intent_and_proxy_params() {
        for (input, expected_url, expected_params) in [
            (
                "https://api.anarlog.so?provider=openai",
                "wss://api.anarlog.so/listen",
                vec![("provider", "openai")],
            ),
            (
                "https://stt.example.com:8443/v1",
                "wss://stt.example.com:8443/v1/realtime",
                vec![("intent", "transcription")],
            ),
        ] {
            let (url, params) = OpenAIAdapter::build_ws_url_from_base(input);
            assert_eq!(url.as_str(), expected_url, "input: {input}");
            assert_eq!(
                params,
                expected_params
                    .into_iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect::<Vec<_>>(),
                "input: {input}"
            );
        }
    }

    #[test]
    fn realtime_url_respects_the_on_prem_base_url() {
        use crate::adapter::RealtimeSttAdapter;
        use owhisper_interface::ListenParams;

        for (input, expected) in [
            (
                "http://192.168.1.87:8000/v1?provider=openai",
                "ws://192.168.1.87:8000/v1/realtime?intent=transcription",
            ),
            (
                "http://localhost:8000/v1?provider=openai",
                "ws://localhost:8000/v1/realtime?intent=transcription",
            ),
            (
                "https://gpu.example/stt-gpu/v1/",
                "wss://gpu.example/stt-gpu/v1/realtime?intent=transcription",
            ),
            (
                "http://localhost:9000/v1/realtime",
                "ws://localhost:9000/v1/realtime?intent=transcription",
            ),
        ] {
            let url = OpenAIAdapter::default().build_ws_url(input, &ListenParams::default(), 1);
            assert_eq!(url.as_str(), expected, "input: {input}");
        }
    }
}
