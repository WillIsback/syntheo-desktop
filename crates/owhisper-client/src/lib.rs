mod adapter;
mod batch;
mod error;
mod http_client;
mod live;
mod providers;

use owhisper_interface::ListenParams;
pub use providers::{Provider, is_meta_model};

pub use adapter::{
    AdapterKind, BatchSttAdapter, BatchUploadLimit, LanguageQuality, LanguageSupport,
    NvidiaAdapter, OpenAIAdapter, RealtimeSttAdapter, append_provider_param,
    documented_language_codes_batch, documented_language_codes_live, normalize_languages,
};
pub use adapter::{StreamingBatchEvent, StreamingBatchStream};

pub use anlg_ws_client;
pub use batch::{BatchClient, BatchClientBuilder};
pub use error::Error;
pub use live::{
    DualHandle, FinalizeHandle, ListenClient, ListenClientBuilder, ListenClientDual,
    ListenClientDualInput, ListenClientInput,
};

pub(crate) fn log_provider_failure(
    provider: &'static str,
    error_type: &str,
    error_code: Option<&str>,
    message: &str,
) {
    let safe_error_type = error_type
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"_.-/".contains(&byte))
        .then_some(error_type)
        .filter(|value| value.len() <= 64)
        .unwrap_or("provider_error");
    let safe_error_code = error_code
        .filter(|value| value.len() <= 64)
        .filter(|value| {
            value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_.-/".contains(&byte))
        })
        .unwrap_or("unknown");

    if anlg_user_error::is_user_error_text(message) {
        tracing::warn!(
            anarlog.stt.provider.name = provider,
            error.type = safe_error_type,
            error.code = safe_error_code,
            "provider_request_rejected"
        );
    } else {
        tracing::error!(
            anarlog.stt.provider.name = provider,
            error.type = safe_error_type,
            error.code = safe_error_code,
            "provider_request_failed"
        );
    }
}

pub fn normalize_listen_params(mut params: ListenParams) -> ListenParams {
    params.languages = adapter::normalize_languages(&params.languages);
    params
}
