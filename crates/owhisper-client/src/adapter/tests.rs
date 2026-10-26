use super::*;

#[test]
fn test_normalize_languages_deduplicates_same_base() {
    use anlg_language::{ISO639, Language};

    let en: Language = ISO639::En.into();
    let en_gb = Language::with_region(ISO639::En, "GB");
    let es: Language = ISO639::Es.into();

    let result = normalize_languages(&[en.clone(), en_gb.clone(), es.clone()]);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].iso639(), ISO639::En);
    assert_eq!(result[0].region(), None);
    assert_eq!(result[1].iso639(), ISO639::Es);
}

#[test]
fn test_normalize_languages_prefers_base_over_regional() {
    use anlg_language::{ISO639, Language};

    let en_gb = Language::with_region(ISO639::En, "GB");
    let en: Language = ISO639::En.into();

    let result = normalize_languages(&[en_gb.clone(), en.clone()]);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].iso639(), ISO639::En);
    assert_eq!(result[0].region(), None);
}

#[test]
fn test_normalize_languages_keeps_regional_if_no_base() {
    use anlg_language::{ISO639, Language};

    let en_gb = Language::with_region(ISO639::En, "GB");
    let es: Language = ISO639::Es.into();

    let result = normalize_languages(&[en_gb.clone(), es.clone()]);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].iso639(), ISO639::En);
    assert_eq!(result[0].region(), Some("GB"));
    assert_eq!(result[1].iso639(), ISO639::Es);
}

#[test]
fn test_normalize_languages_multiple_variants() {
    use anlg_language::{ISO639, Language};

    let en_us = Language::with_region(ISO639::En, "US");
    let en_gb = Language::with_region(ISO639::En, "GB");
    let en: Language = ISO639::En.into();

    let result = normalize_languages(&[en_us.clone(), en_gb.clone(), en.clone()]);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].iso639(), ISO639::En);
    assert_eq!(result[0].region(), None);
}

#[test]
fn test_documented_language_codes_are_menu_safe() {
    let result = documented_language_codes_live();

    assert!(result.contains(&"en".to_string()));
    assert!(result.contains(&"zh".to_string()));
    assert!(result.iter().all(|code| !code.contains("-")));
    assert!(!result.contains(&"jw".to_string()));
}

#[test]
fn test_has_live_mode() {
    for kind in [AdapterKind::OpenAI, AdapterKind::Nvidia] {
        assert!(kind.has_live_mode(), "{kind:?} should support live mode");
    }
}

#[test]
fn test_append_provider_param_replaces_existing() {
    let url = append_provider_param("https://api.anarlog.so/stt?provider=deepgram", "anarlog");
    assert!(
        url.contains("provider=anarlog"),
        "new provider value should be present: {url}"
    );
    assert!(
        !url.contains("provider=deepgram"),
        "old provider value should be removed: {url}"
    );
    assert_eq!(
        url.matches("provider=").count(),
        1,
        "exactly one provider param expected: {url}"
    );
}

#[test]
fn test_append_provider_param_preserves_other_params() {
    let url = append_provider_param(
        "https://api.anarlog.so/stt?model=cloud&provider=soniox&language=en",
        "anarlog",
    );
    assert!(
        url.contains("model=cloud"),
        "model should be preserved: {url}"
    );
    assert!(
        url.contains("language=en"),
        "language should be preserved: {url}"
    );
    assert!(url.contains("provider=anarlog"));
    assert!(!url.contains("provider=soniox"));
}

#[test]
fn test_append_provider_param_no_existing_provider() {
    let url = append_provider_param("https://api.anarlog.so/stt", "anarlog");
    assert!(url.contains("provider=anarlog"));
    assert_eq!(url.matches("provider=").count(), 1);
}

#[test]
fn openai_diarize_batch_limit_stays_under_api_duration_cap() {
    let diarize = AdapterKind::OpenAI
        .batch_upload_limit(Some("gpt-4o-transcribe-diarize"))
        .expect("openai has a batch upload limit");
    let transcribe = AdapterKind::OpenAI
        .batch_upload_limit(Some("gpt-4o-transcribe"))
        .expect("openai has a batch upload limit");

    assert_eq!(diarize.max_duration, Duration::from_secs(1390));
    assert!(diarize.max_duration < Duration::from_secs(1400));
    assert_eq!(transcribe.max_duration, Duration::from_secs(25 * 60));
    assert_eq!(diarize.max_bytes, transcribe.max_bytes);
}

#[test]
fn unknown_on_prem_host_falls_back_to_openai() {
    for url in [
        "http://192.168.1.87:8000/v1",
        "http://localhost:9000/v1/realtime",
    ] {
        assert_eq!(
            AdapterKind::from_url_and_languages(url, &[], None),
            AdapterKind::OpenAI,
            "{url}"
        );
    }
}

#[test]
fn provider_query_selects_openai_or_nvidia() {
    assert_eq!(
        AdapterKind::from_url_and_languages(
            "https://asr.example/v1/realtime?provider=nvidia",
            &[],
            None
        ),
        AdapterKind::Nvidia
    );
    assert_eq!(
        AdapterKind::from_url_and_languages("https://asr.example/v1?provider=openai", &[], None),
        AdapterKind::OpenAI
    );
}

#[test]
fn removed_provider_query_falls_back_to_openai() {
    assert_eq!(
        AdapterKind::from_url_and_languages("https://asr.example/v1?provider=deepgram", &[], None),
        AdapterKind::OpenAI
    );
}
