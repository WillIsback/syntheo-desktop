use super::*;
use owhisper_interface::{ListenParams, stream::StreamResponse};
use syntheo_ws_client::client::Message;

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

fn json_of(message: &Message) -> serde_json::Value {
    match message {
        Message::Text(text) => serde_json::from_str(text).expect("valid JSON"),
        _ => panic!("expected text message"),
    }
}

#[test]
fn nvidia_final_segment_keeps_word_alignment() {
    // NIM reports word offsets in milliseconds (NVIDIA's reference realtime
    // client prints them as "Start (ms)" / "End (ms)").
    let adapter = NvidiaAdapter::default();
    let _ = adapter.audio_to_message(bytes::Bytes::from(vec![0; 2 * 16_000 * 2]));
    let result = adapter.parse_response(r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Hello","words_info":{"words":[{"word":"Hello","start_time":1000,"end_time":1500,"speaker_tag":3,"confidence":0.9}]}}"#);
    assert_eq!(result.len(), 1);
    assert_eq!(transcript(&result[0]), ("Hello", true, 1.0, 0.5));
    match &result[0] {
        StreamResponse::TranscriptResponse { channel, .. } => {
            assert_eq!(channel.alternatives[0].words[0].speaker, Some(3))
        }
        _ => unreachable!(),
    }
}

#[test]
fn nvidia_word_offsets_in_seconds_are_kept() {
    // A deployment already reporting seconds stays within the audio sent.
    let adapter = NvidiaAdapter::default();
    let _ = adapter.audio_to_message(bytes::Bytes::from(vec![0; 2 * 16_000 * 2]));
    let result = adapter.parse_response(r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Hello","words_info":{"words":[{"word":"Hello","start_time":1.0,"end_time":1.5}]}}"#);
    assert_eq!(transcript(&result[0]), ("Hello", true, 1.0, 0.5));
}

#[test]
fn nvidia_partial_after_a_final_follows_it_on_the_audio_timeline() {
    // Read as seconds, a word ending at "4800" pushed the cursor 80 min ahead:
    // every later partial collapsed onto that instant and was discarded as
    // already transcribed (issue #268).
    let adapter = NvidiaAdapter::default();
    let _ = adapter.audio_to_message(bytes::Bytes::from(vec![0; 5 * 16_000 * 2]));
    adapter.parse_response(r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Bonjour à tous.","words_info":{"words":[{"word":"Bonjour","start_time":300,"end_time":900},{"word":"tous.","start_time":4200,"end_time":4800}]}}"#);
    let _ = adapter.audio_to_message(bytes::Bytes::from(vec![0; 16_000 * 2]));
    let partial = adapter.parse_response(
        r#"{"type":"conversation.item.input_audio_transcription.delta","delta":"Et ensuite"}"#,
    );
    let (text, is_final, start, duration) = transcript(&partial[0]);
    assert_eq!((text, is_final), ("Et ensuite", false));
    assert!((start - 4.8).abs() < 1e-9, "start = {start}");
    assert!((duration - 1.2).abs() < 1e-9, "duration = {duration}");
}

#[test]
fn nvidia_last_result_is_a_drain_marker_only() {
    // The end-of-stream result replays the whole session; only the stop signal
    // must survive, otherwise every segment is delivered twice.
    let adapter = NvidiaAdapter::default();
    let result = adapter.parse_response(
        r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Hello world","is_last_result":true}"#,
    );
    assert_eq!(result.len(), 1);
    assert_eq!(transcript(&result[0]), ("", true, 0.0, 0.0));
    assert!(matches!(
        result[0],
        StreamResponse::TranscriptResponse {
            from_finalize: true,
            ..
        }
    ));
}

#[test]
fn nvidia_delta_replaces_the_open_segment_hypothesis() {
    // Riva repeats the whole hypothesis on each delta; the partial must be the
    // full current segment, not an accumulation.
    let adapter = NvidiaAdapter::default();
    let first = adapter.parse_response(
        r#"{"type":"conversation.item.input_audio_transcription.delta","delta":"Bon"}"#,
    );
    let second = adapter.parse_response(
        r#"{"type":"conversation.item.input_audio_transcription.delta","delta":"Bonjour"}"#,
    );
    assert_eq!(transcript(&first[0]).0, "Bon");
    assert_eq!(transcript(&second[0]).0, "Bonjour");
}

#[test]
fn nvidia_normalizes_language_and_boosts_at_rnnt_scale() {
    let params = ListenParams {
        languages: vec!["fr".parse().unwrap()],
        keywords: vec![
            "Participants".to_string(),
            "  étape ".to_string(),
            "".to_string(),
        ],
        ..Default::default()
    };
    let initial = NvidiaAdapter::default()
        .initial_message(None, &params, 1)
        .expect("initial message");
    let session = json_of(&initial)["session"].clone();
    assert_eq!(session["input_audio_transcription"]["language"], "fr-FR");
    let boosting = &session["word_boosting"];
    assert_eq!(boosting["enable_word_boosting"], true);
    let contexts = boosting["word_boosting_list"].as_array().unwrap();
    assert_eq!(contexts.len(), 1);
    assert_eq!(
        contexts[0]["phrases"],
        serde_json::json!(["Participants", "étape"])
    );
    assert_eq!(contexts[0]["boost"], 1.0);
}

#[test]
fn nvidia_without_keywords_disables_boosting() {
    let params = ListenParams {
        languages: vec!["fr".parse().unwrap()],
        ..Default::default()
    };
    let initial = NvidiaAdapter::default()
        .initial_message(None, &params, 1)
        .expect("initial message");
    let boosting = json_of(&initial)["session"]["word_boosting"].clone();
    assert_eq!(boosting["enable_word_boosting"], false);
    assert_eq!(boosting["word_boosting_list"], serde_json::json!([]));
}

#[test]
fn nvidia_flushes_with_a_commit_after_each_append() {
    let messages =
        NvidiaAdapter::default().audio_messages(bytes::Bytes::from_static(b"\x00\x01\x02\x03"));
    assert_eq!(messages.len(), 2);
    assert_eq!(json_of(&messages[0])["type"], "input_audio_buffer.append");
    assert_eq!(json_of(&messages[1])["type"], "input_audio_buffer.commit");
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
