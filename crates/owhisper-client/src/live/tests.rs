use std::time::Duration;

use anlg_ws_client::client::Message;
use bytes::Bytes;

use super::{ListenClientDualInput, TransformedInput, forward_dual_to_single, mic_stream_params};
use crate::{AnarlogAdapter, ListenClient, OpenAIAdapter, RealtimeSttAdapter};

#[derive(Clone, Default)]
struct TestAdapter;

impl RealtimeSttAdapter for TestAdapter {
    fn provider_name(&self) -> &'static str {
        "test"
    }

    fn is_supported_languages(
        &self,
        _languages: &[anlg_language::Language],
        _model: Option<&str>,
    ) -> bool {
        true
    }

    fn supports_native_multichannel(&self) -> bool {
        false
    }

    fn build_ws_url(
        &self,
        api_base: &str,
        _params: &owhisper_interface::ListenParams,
        _channels: u8,
    ) -> url::Url {
        api_base.parse().expect("invalid test url")
    }

    fn build_auth_header(&self, _api_key: Option<&str>) -> Option<(&'static str, String)> {
        None
    }

    fn keep_alive_message(&self) -> Option<Message> {
        None
    }

    fn finalize_message(&self) -> Message {
        Message::Text("finalize".into())
    }

    fn parse_response(&self, _raw: &str) -> Vec<owhisper_interface::stream::StreamResponse> {
        Vec::new()
    }
}

#[tokio::test]
async fn malformed_custom_endpoint_returns_provider_configuration_error() {
    let api_base = format!("{}://custom.example/listen", "a".repeat(65));
    let error = ListenClient::builder()
        .adapter::<TestAdapter>()
        .api_base(api_base)
        .build_single()
        .await
        .err()
        .expect("an oversized URI scheme should be rejected");

    assert!(matches!(
        error,
        crate::Error::ProviderConfiguration { provider, .. } if provider == "test"
    ));
}

#[tokio::test]
async fn malformed_direct_endpoint_returns_provider_configuration_error() {
    let api_base = format!("http://192.168.1.87:8000/v1?pad={}", "a".repeat(70 * 1024));
    let error = ListenClient::builder()
        .adapter::<OpenAIAdapter>()
        .api_base(api_base)
        .build_single()
        .await
        .err()
        .expect("an oversized direct endpoint should be rejected");

    assert!(matches!(
        error,
        crate::Error::ProviderConfiguration { provider, .. } if provider == "openai"
    ));
}

#[tokio::test]
async fn valid_proxy_and_direct_endpoints_still_build() {
    for api_base in [
        "http://192.168.1.87:8000/v1",
        "http://localhost:3001/stt?provider=openai",
    ] {
        ListenClient::builder()
            .adapter::<OpenAIAdapter>()
            .api_base(api_base)
            .build_single()
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn split_dual_builds_a_dedicated_mic_request() {
    let client = ListenClient::builder()
        .adapter::<OpenAIAdapter>()
        .api_base("http://192.168.1.87:8000/v1")
        .api_key("test-key")
        .params(owhisper_interface::ListenParams {
            mic_num_speakers: Some(1),
            ..Default::default()
        })
        .build_dual()
        .await
        .unwrap();

    assert!(
        client.mic_request.is_some(),
        "split sessions should build a dedicated mic request"
    );
}

#[tokio::test]
async fn native_multichannel_dual_does_not_build_mic_request() {
    let client = ListenClient::builder()
        .adapter::<AnarlogAdapter>()
        .api_base("http://localhost:3001/stt")
        .api_key("test-key")
        .params(owhisper_interface::ListenParams {
            mic_num_speakers: Some(1),
            ..Default::default()
        })
        .build_dual()
        .await
        .unwrap();

    assert!(client.mic_request.is_none());
}

#[tokio::test]
async fn forward_dual_to_single_forwards_all_audio_without_dropping() {
    let stream = futures_util::stream::iter(vec![
        ListenClientDualInput::Audio((Bytes::from_static(b"mic-1"), Bytes::from_static(b"spk-1"))),
        ListenClientDualInput::Audio((Bytes::from_static(b"mic-2"), Bytes::from_static(b"spk-2"))),
    ]);
    let (mic_tx, mut mic_rx) = tokio::sync::mpsc::channel(1);
    let (spk_tx, mut spk_rx) = tokio::sync::mpsc::channel(1);

    let task = tokio::spawn(forward_dual_to_single(
        stream,
        mic_tx,
        spk_tx,
        TestAdapter,
        TestAdapter,
    ));

    let Some(TransformedInput::Audio(Message::Binary(first_mic))) = mic_rx.recv().await else {
        panic!("missing first mic frame");
    };
    let Some(TransformedInput::Audio(Message::Binary(first_spk))) = spk_rx.recv().await else {
        panic!("missing first speaker frame");
    };
    let Some(TransformedInput::Audio(Message::Binary(second_mic))) =
        tokio::time::timeout(Duration::from_secs(1), mic_rx.recv())
            .await
            .expect("timed out waiting for second mic frame")
    else {
        panic!("missing second mic frame");
    };
    let Some(TransformedInput::Audio(Message::Binary(second_spk))) =
        tokio::time::timeout(Duration::from_secs(1), spk_rx.recv())
            .await
            .expect("timed out waiting for second speaker frame")
    else {
        panic!("missing second speaker frame");
    };

    assert_eq!(first_mic.as_ref(), b"mic-1");
    assert_eq!(first_spk.as_ref(), b"spk-1");
    assert_eq!(second_mic.as_ref(), b"mic-2");
    assert_eq!(second_spk.as_ref(), b"spk-2");

    let _: () = task.await.expect("forward task panicked");
}

#[test]
fn mic_stream_params_overrides_speaker_counts_for_the_mic_stream() {
    let params = owhisper_interface::ListenParams {
        mic_num_speakers: Some(1),
        ..Default::default()
    };

    let mic_params = mic_stream_params(&params);

    assert_eq!(mic_params.num_speakers, Some(1));
    assert_eq!(mic_params.max_speakers, Some(1));
    assert_eq!(params.num_speakers, None, "shared params stay untouched");
}

#[test]
fn mic_stream_params_clamps_min_speakers_below_the_mic_count() {
    let params = owhisper_interface::ListenParams {
        mic_num_speakers: Some(1),
        min_speakers: Some(3),
        ..Default::default()
    };

    let mic_params = mic_stream_params(&params);

    assert_eq!(mic_params.num_speakers, Some(1));
    assert_eq!(mic_params.max_speakers, Some(1));
    assert_eq!(mic_params.min_speakers, Some(1));
}

#[test]
fn mic_stream_params_without_mic_count_keeps_shared_expectation() {
    let params = owhisper_interface::ListenParams {
        num_speakers: Some(4),
        ..Default::default()
    };

    let mic_params = mic_stream_params(&params);

    assert_eq!(mic_params.num_speakers, Some(4));
    assert_eq!(mic_params.mic_num_speakers, None);
}

#[tokio::test]
async fn nvidia_dual_capture_authenticates_each_stream_with_its_own_token() {
    use std::collections::BTreeSet;
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let minted = Arc::new(AtomicUsize::new(0));
    let tokens = Arc::new(Mutex::new(BTreeSet::new()));
    let seen = tokens.clone();
    let server = tokio::spawn(async move {
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let minted = minted.clone();
            let seen = seen.clone();
            tasks.push(tokio::spawn(async move {
                let mut peek = [0; 4096];
                let n = socket.peek(&mut peek).await.unwrap();
                if peek[..n].starts_with(b"POST ") {
                    let mut request = Vec::new();
                    loop {
                        let byte = socket.read_u8().await.unwrap();
                        request.push(byte);
                        if request.ends_with(b"\r\n\r\n") { break; }
                    }
                    assert!(String::from_utf8_lossy(&request).starts_with("POST /v1/realtime/transcription_sessions "));
                    let number = minted.fetch_add(1, Ordering::SeqCst) + 1;
                    let body = format!(r#"{{"client_secret":{{"value":"token-{number}"}}}}"#);
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
                } else {
                    let mut ws = tokio_tungstenite::accept_hdr_async(socket, |request: &Request, mut response: Response| {
                        let protocols = request.headers().get("sec-websocket-protocol").unwrap().to_str().unwrap();
                        let token = protocols.split(", ").find_map(|p| p.strip_prefix("realtime-token.")).unwrap();
                        assert!(matches!(token, "token-1" | "token-2"));
                        assert!(seen.lock().unwrap().insert(token.to_owned()), "each handshake needs a distinct token");
                        response.headers_mut().insert("sec-websocket-protocol", "realtime".parse().unwrap());
                        Ok(response)
                    }).await.unwrap();
                    use futures_util::StreamExt;
                    assert!(ws.next().await.unwrap().is_ok());
                }
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
    });
    let client = ListenClient::builder()
        .adapter::<crate::NvidiaAdapter>()
        .api_base(base)
        .api_key("mint-key")
        .build_dual()
        .await
        .unwrap();
    let (_output, _handle) = client
        .from_realtime_audio(futures_util::stream::pending())
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(tokens.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn empty_endpoint_is_rejected_instead_of_a_cloud_default() {
    let error = ListenClient::builder()
        .adapter::<OpenAIAdapter>()
        .api_base("")
        .build_single()
        .await
        .err()
        .expect("an empty endpoint must not fall back to a cloud host");

    assert!(matches!(
        error,
        crate::Error::ProviderConfiguration { provider, .. } if provider == "openai"
    ));
}
