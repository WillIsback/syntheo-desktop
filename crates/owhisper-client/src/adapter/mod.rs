pub mod parsing;
mod segment;

pub mod http;
mod language;
mod nvidia;
mod openai;
mod openai_compatible_batch;

pub use language::{LanguageQuality, LanguageSupport};
pub use nvidia::*;
pub use openai::*;

use std::collections::{BTreeSet, HashSet};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::str::FromStr;
use std::time::Duration;

use anlg_ws_client::client::Message;
use owhisper_interface::ListenParams;
use owhisper_interface::batch::Response as BatchResponse;
use owhisper_interface::batch_stream::BatchStreamEvent;
use owhisper_interface::stream::StreamResponse;

use crate::error::Error;

pub use reqwest_middleware::ClientWithMiddleware;

pub type BatchFuture<'a> = Pin<Box<dyn Future<Output = Result<BatchResponse, Error>> + Send + 'a>>;

pub(crate) const MIXED_CAPTURE_CHANNEL: i32 = 2;

pub type StreamingBatchEvent = BatchStreamEvent;

pub type StreamingBatchStream =
    Pin<Box<dyn futures_util::Stream<Item = Result<BatchStreamEvent, Error>> + Send>>;

fn canonical_menu_language_code(code: &str) -> Option<String> {
    let language = code
        .split(['-', '_'])
        .next()
        .filter(|part| !part.is_empty())?
        .to_lowercase();
    let language = match language.as_str() {
        "jw" => "jv",
        _ => language.as_str(),
    };

    anlg_language::ISO639::from_str(language)
        .ok()
        .map(|code| code.code().to_string())
}

fn whisper_language_codes() -> Vec<String> {
    anlg_language::whisper_multilingual()
        .iter()
        .map(|language| language.iso639_code().to_string())
        .collect()
}

pub fn documented_language_codes_live() -> Vec<String> {
    let codes = whisper_language_codes();

    let set: BTreeSet<String> = codes
        .iter()
        .filter_map(|code| canonical_menu_language_code(code))
        .collect();
    set.into_iter().collect()
}

pub fn documented_language_codes_batch() -> Vec<String> {
    documented_language_codes_live()
}

pub trait RealtimeSttAdapter: Clone + Default + Send + Sync + 'static {
    fn fork_session(&self) -> Self {
        self.clone()
    }

    fn provider_name(&self) -> &'static str;

    fn initial_response_type(&self) -> Option<&'static str> {
        None
    }

    fn initial_response_field(&self) -> &'static str {
        "type"
    }

    fn required_sample_rate(&self) -> Option<u32> {
        None
    }

    fn is_supported_languages(
        &self,
        languages: &[anlg_language::Language],
        model: Option<&str>,
    ) -> bool;

    fn supports_native_multichannel(&self) -> bool;

    fn build_ws_url(&self, api_base: &str, params: &ListenParams, channels: u8) -> url::Url;

    fn build_ws_url_with_api_key(
        &self,
        api_base: &str,
        params: &ListenParams,
        channels: u8,
        _api_key: Option<&str>,
    ) -> impl std::future::Future<Output = Option<url::Url>> + Send {
        let url = self.build_ws_url(api_base, params, channels);
        async move { Some(url) }
    }

    fn build_auth_header(&self, api_key: Option<&str>) -> Option<(&'static str, String)>;

    fn keep_alive_message(&self) -> Option<Message>;

    fn finalize_message(&self) -> Message;

    fn finalize_messages(&self) -> Vec<Message> {
        vec![self.finalize_message()]
    }

    fn audio_to_message(&self, audio: bytes::Bytes) -> Message {
        Message::Binary(audio)
    }

    fn initial_message(
        &self,
        _api_key: Option<&str>,
        _params: &ListenParams,
        _channels: u8,
    ) -> Option<Message> {
        None
    }

    fn parse_response(&self, raw: &str) -> Vec<StreamResponse>;
}

pub trait BatchSttAdapter: Clone + Default + Send + Sync + 'static {
    fn provider_name(&self) -> &'static str {
        "unknown"
    }

    fn is_supported_languages(
        &self,
        languages: &[anlg_language::Language],
        model: Option<&str>,
    ) -> bool;

    fn transcribe_file<'a, P: AsRef<Path> + Send + 'a>(
        &'a self,
        client: &'a ClientWithMiddleware,
        api_base: &'a str,
        api_key: &'a str,
        params: &'a ListenParams,
        file_path: P,
    ) -> BatchFuture<'a>;

    /// Transcrire un tampon audio en mémoire : les chemins qui ne doivent rien
    /// écrire sur disque (dictée, imports) passent par ici. L'implémentation par
    /// défaut refuse, tous les adaptateurs n'ayant pas de corps multipart
    /// générique.
    fn transcribe_bytes<'a>(
        &'a self,
        _client: &'a ClientWithMiddleware,
        _api_base: &'a str,
        _api_key: &'a str,
        _params: &'a ListenParams,
        _audio: Vec<u8>,
        _file_name: String,
    ) -> BatchFuture<'a> {
        Box::pin(async {
            Err(Error::AudioProcessing(
                "this adapter cannot transcribe in-memory audio".to_string(),
            ))
        })
    }
}

pub fn extract_query_params(url: &url::Url) -> Vec<(String, String)> {
    url.query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

pub fn append_path_if_missing(url: &mut url::Url, suffix: &str) {
    let path = url.path().to_string();
    if !path.ends_with(suffix) && !path.ends_with(&format!("{}/", suffix)) {
        let mut new_path = path;
        if !new_path.ends_with('/') {
            new_path.push('/');
        }
        new_path.push_str(suffix.trim_start_matches('/'));
        url.set_path(&new_path);
    }
}

pub fn normalize_languages(languages: &[anlg_language::Language]) -> Vec<anlg_language::Language> {
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(languages.len());

    for lang in languages {
        let iso639 = lang.iso639();
        if seen.insert(iso639) {
            result.push(lang.clone());
        } else if lang.region().is_none()
            && let Some(pos) = result.iter().position(|l| l.iso639() == iso639)
        {
            result[pos] = lang.clone();
        }
    }

    result
}

pub fn append_provider_param(base_url: &str, provider: &str) -> String {
    match url::Url::parse(base_url) {
        Ok(mut url) => {
            let existing: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(k, _)| k != "provider")
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();

            url.query_pairs_mut().clear().extend_pairs(&existing);
            url.query_pairs_mut().append_pair("provider", provider);
            url.to_string()
        }
        Err(_) => base_url.to_string(),
    }
}

const OPENAI_COMPATIBLE_MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;
const OPENAI_COMPATIBLE_MAX_DURATION: Duration = Duration::from_secs(25 * 60);
/// `gpt-4o-transcribe-diarize` rejects audio longer than 1400s. Stay 10s under
/// so MP3 re-encode padding cannot push a segment over the API cap.
const OPENAI_DIARIZE_MAX_DURATION: Duration = Duration::from_secs(1390);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchUploadLimit {
    pub max_bytes: u64,
    /// Doubles as the length of each split segment, so it must stay short enough
    /// that one segment of mono 64 kbps MP3 fits in `max_bytes` (~53 minutes at
    /// 25 MB); otherwise splitting a long recording still produces oversized
    /// uploads.
    pub max_duration: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::EnumString)]
pub enum AdapterKind {
    #[strum(serialize = "nvidia")]
    Nvidia,
    #[strum(serialize = "openai")]
    OpenAI,
}

impl AdapterKind {
    /// Routes a configured endpoint to a protocol. On-prem servers rarely have a
    /// recognizable host, so the desktop marks the protocol with `?provider=`;
    /// anything else speaks the OpenAI protocol (Realtime and
    /// `/v1/audio/transcriptions`), the common denominator of vLLM, speaches and
    /// faster-whisper-server.
    pub fn from_url_and_languages(
        base_url: &str,
        _languages: &[anlg_language::Language],
        _model: Option<&str>,
    ) -> Self {
        if let Ok(url) = url::Url::parse(base_url)
            && let Some(kind) = url
                .query_pairs()
                .find(|(key, _)| key == "provider")
                .and_then(|(_, value)| value.parse::<Self>().ok())
                .filter(|kind| matches!(kind, Self::Nvidia | Self::OpenAI))
        {
            return kind;
        }

        Self::OpenAI
    }

    /// Recordings past either bound are split into one request per segment
    /// instead of failing at the server.
    pub fn batch_upload_limit(&self, model: Option<&str>) -> Option<BatchUploadLimit> {
        let (max_bytes, max_duration) = match self {
            Self::OpenAI => (
                OPENAI_COMPATIBLE_MAX_UPLOAD_BYTES,
                openai_batch_max_duration(model),
            ),
            _ => return None,
        };

        Some(BatchUploadLimit {
            max_bytes,
            max_duration,
        })
    }

    pub fn has_live_mode(&self) -> bool {
        match self {
            Self::Nvidia | Self::OpenAI => true,
        }
    }

    pub fn language_support_live(
        &self,
        languages: &[anlg_language::Language],
        model: Option<&str>,
    ) -> LanguageSupport {
        match self {
            Self::Nvidia => NvidiaAdapter::language_support_live(languages, model),
            Self::OpenAI => OpenAIAdapter::language_support_live(languages),
        }
    }

    pub fn language_support_batch(
        &self,
        languages: &[anlg_language::Language],
        _model: Option<&str>,
    ) -> LanguageSupport {
        match self {
            Self::Nvidia => LanguageSupport::NotSupported,
            Self::OpenAI => OpenAIAdapter::language_support_batch(languages),
        }
    }

    pub fn is_supported_languages_live(
        &self,
        languages: &[anlg_language::Language],
        model: Option<&str>,
    ) -> bool {
        self.language_support_live(languages, model).is_supported()
    }

    pub fn is_supported_languages_batch(
        &self,
        languages: &[anlg_language::Language],
        model: Option<&str>,
    ) -> bool {
        self.language_support_batch(languages, model).is_supported()
    }
}

fn openai_batch_max_duration(model: Option<&str>) -> Duration {
    match openai::OpenAIAdapter::resolve_batch_model(model) {
        Some(openai_transcription::batch::AudioModel::Gpt4oTranscribeDiarize) => {
            OPENAI_DIARIZE_MAX_DURATION
        }
        _ => OPENAI_COMPATIBLE_MAX_DURATION,
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod streaming_providers_tests;
