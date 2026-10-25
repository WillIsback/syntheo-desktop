use super::*;
use owhisper_interface::{ListenParams, stream::StreamResponse};

fn transcript(response: &StreamResponse) -> (&str, bool, f64, f64) {
    match response {
        StreamResponse::TranscriptResponse {
            channel,
            is_final,
            start,
            duration,
            ..
        } => (
            &channel.alternatives[0].transcript,
            *is_final,
            *start,
            *duration,
        ),
        _ => panic!("expected transcript"),
    }
}

#[test]
fn nvidia_preserves_word_alignment_and_final_drain_marker() {
    let adapter = NvidiaAdapter::default();
    let result = adapter.parse_response(r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Hello","words_info":{"words":[{"word":"Hello","start_time":1.0,"end_time":1.5,"speaker_tag":3,"confidence":0.9}]},"is_last_result":true}"#);
    assert_eq!(transcript(&result[0]), ("Hello", true, 1.0, 0.5));
    assert!(matches!(
        result[1],
        StreamResponse::TranscriptResponse {
            from_finalize: true,
            ..
        }
    ));
    match &result[0] {
        StreamResponse::TranscriptResponse { channel, .. } => {
            assert_eq!(channel.alternatives[0].words[0].speaker, Some(3))
        }
        _ => unreachable!(),
    }
}

#[test]
fn provider_selection_survives_custom_and_loopback_endpoints() {
    for (provider, expected) in [
        ("nvidia", AdapterKind::Nvidia),
        ("openai", AdapterKind::OpenAI),
    ] {
        assert_eq!(
            AdapterKind::from_url_and_languages(
                &format!("http://localhost:9000?provider={provider}"),
                &[],
                None
            ),
            expected
        );
    }
    assert_eq!(
        AdapterKind::from_url_and_languages(
            "https://api.anarlog.so/stt?provider=nvidia",
            &[],
            None
        ),
        AdapterKind::Anarlog
    );
    let url = NvidiaAdapter::default().build_ws_url(
        "http://localhost:9000?provider=nvidia",
        &ListenParams::default(),
        1,
    );
    assert_eq!(
        url.as_str(),
        "ws://localhost:9000/v1/realtime?intent=transcription"
    );
}

#[tokio::test]
async fn nvidia_mints_a_fresh_handshake_token_for_each_audio_channel() {
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/realtime/transcription_sessions"))
        .and(header("authorization", "Bearer mint-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "client_secret":{"value":"ephemeral"}
        })))
        .mount(&server)
        .await;
    let adapter = NvidiaAdapter::default();
    let url = adapter
        .build_ws_url_with_api_key(&server.uri(), &ListenParams::default(), 1, Some("mint-key"))
        .await
        .unwrap();
    assert!(!url.as_str().contains("ephemeral"));
    assert_eq!(
        adapter.build_auth_header(Some("mint-key")),
        Some((
            "Sec-WebSocket-Protocol",
            "realtime, realtime-token.ephemeral".into()
        ))
    );
    Mock::given(method("POST"))
        .and(path("/v1/realtime/transcription_sessions"))
        .and(header("authorization", "Bearer mic-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "client_secret":{"value":"mic-ephemeral"}
        })))
        .mount(&server)
        .await;
    let mic = adapter.fork_session();
    assert!(mic.build_auth_header(None).is_none());
    mic.build_ws_url_with_api_key(&server.uri(), &ListenParams::default(), 1, Some("mic-key"))
        .await
        .unwrap();
    assert_eq!(
        mic.build_auth_header(Some("mic-key")),
        Some((
            "Sec-WebSocket-Protocol",
            "realtime, realtime-token.mic-ephemeral".into()
        ))
    );
}
