mod batch;
mod error;
mod events;
mod runtime;
mod subtitle;

pub use batch::{
    BatchAudio, BatchParams, BatchProvider, BatchRunMode, BatchRunOutput,
    expects_progressive_batch, run_batch,
};
pub use error::*;
pub use events::*;
pub use runtime::*;
pub use subtitle::*;

use std::str::FromStr;

use owhisper_client::AdapterKind;

pub fn is_supported_languages_live(
    provider: &str,
    model: Option<&str>,
    languages: &[syntheo_language::Language],
) -> std::result::Result<bool, String> {
    let adapter_kind =
        AdapterKind::from_str(provider).map_err(|_| format!("unknown_provider: {}", provider))?;

    Ok(adapter_kind.is_supported_languages_live(languages, model))
}

pub fn is_supported_languages_batch(
    provider: &str,
    model: Option<&str>,
    languages: &[syntheo_language::Language],
) -> std::result::Result<bool, String> {
    let adapter_kind =
        AdapterKind::from_str(provider).map_err(|_| format!("unknown_provider: {}", provider))?;

    Ok(adapter_kind.is_supported_languages_batch(languages, model))
}

pub fn suggest_providers_for_languages_live(
    languages: &[syntheo_language::Language],
) -> Vec<String> {
    let all_providers = [AdapterKind::OpenAI, AdapterKind::Nvidia];

    let mut with_support: Vec<_> = all_providers
        .iter()
        .map(|kind| {
            let support = kind.language_support_live(languages, None);
            (*kind, support)
        })
        .filter(|(_, support)| support.is_supported())
        .collect();

    with_support.sort_by(|(_, s1), (_, s2)| s2.cmp(s1));

    with_support
        .into_iter()
        .map(|(kind, _)| kind.to_string())
        .collect()
}

pub fn suggest_providers_for_languages_batch(
    languages: &[syntheo_language::Language],
) -> Vec<String> {
    let all_providers = [AdapterKind::OpenAI];

    let mut with_support: Vec<_> = all_providers
        .iter()
        .map(|kind| {
            let support = kind.language_support_batch(languages, None);
            (*kind, support)
        })
        .filter(|(_, support)| support.is_supported())
        .collect();

    with_support.sort_by(|(_, s1), (_, s2)| s2.cmp(s1));

    with_support
        .into_iter()
        .map(|(kind, _)| kind.to_string())
        .collect()
}

pub fn list_documented_language_codes_batch() -> Vec<String> {
    owhisper_client::documented_language_codes_batch()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_support_by_on_prem_protocol() {
        let french = vec!["fr".parse().unwrap()];
        assert!(is_supported_languages_live("openai", Some("whisper-large-v3"), &french).unwrap());
        assert!(is_supported_languages_batch("openai", Some("whisper-large-v3"), &french).unwrap());
        assert!(!is_supported_languages_batch("nvidia", None, &french).unwrap());
        assert!(is_supported_languages_live("soniqo", None, &french).is_err());
    }

    #[test]
    fn openai_protocol_is_suggested_for_french() {
        let french = vec!["fr-FR".parse().unwrap()];

        assert!(suggest_providers_for_languages_live(&french).contains(&"openai".to_string()));
        assert!(suggest_providers_for_languages_batch(&french).contains(&"openai".to_string()));
    }
}
