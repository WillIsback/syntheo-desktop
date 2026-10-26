use std::future::{Future, pending};
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use axum::{Router, extract::State, http::StatusCode};
use owhisper_client::BatchSttAdapter;
use owhisper_interface::batch::Response;
use tokio::sync::Notify;

/// Sample rate of the speech fixtures written by these tests.
const TARGET_SAMPLE_RATE: u32 = 16_000;

use super::super::BatchParams;
use super::super::upload::AudioInputRef;
use super::*;

fn path_input(path: &str) -> AudioInputRef<'_> {
    AudioInputRef::Path(path)
}

#[derive(Clone, Default)]
struct HangingHttpAdapter;

impl BatchSttAdapter for HangingHttpAdapter {
    fn provider_name(&self) -> &'static str {
        "hanging-http"
    }

    fn is_supported_languages(
        &self,
        _languages: &[anlg_language::Language],
        _model: Option<&str>,
    ) -> bool {
        true
    }

    fn transcribe_file<'a, P: AsRef<Path> + Send + 'a>(
        &'a self,
        client: &'a reqwest_middleware::ClientWithMiddleware,
        api_base: &'a str,
        _api_key: &'a str,
        _params: &'a owhisper_interface::ListenParams,
        _file_path: P,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<Response, owhisper_client::Error>> + Send + 'a>,
    > {
        Box::pin(async move {
            client.post(api_base).body("audio").send().await?;
            panic!("hanging provider unexpectedly responded");
        })
    }
}

static SEGMENT_UPLOADS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[derive(Clone, Default)]
struct RecordingAdapter;

impl BatchSttAdapter for RecordingAdapter {
    fn provider_name(&self) -> &'static str {
        "recording"
    }

    fn is_supported_languages(
        &self,
        _languages: &[anlg_language::Language],
        _model: Option<&str>,
    ) -> bool {
        true
    }

    fn transcribe_file<'a, P: AsRef<Path> + Send + 'a>(
        &'a self,
        _client: &'a reqwest_middleware::ClientWithMiddleware,
        _api_base: &'a str,
        _api_key: &'a str,
        _params: &'a owhisper_interface::ListenParams,
        file_path: P,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<Response, owhisper_client::Error>> + Send + 'a>,
    > {
        let path = file_path.as_ref().to_path_buf();
        Box::pin(async move {
            let mut uploads = SEGMENT_UPLOADS.lock().unwrap();
            let index = uploads.len();
            uploads.push(path.to_string_lossy().into_owned());

            Ok(Response {
                metadata: serde_json::json!({ "provider": "recording" }),
                results: owhisper_interface::batch::Results {
                    channels: vec![owhisper_interface::batch::Channel {
                        alternatives: vec![owhisper_interface::batch::Alternatives {
                            transcript: format!("segment {index}"),
                            confidence: 1.0,
                            words: vec![owhisper_interface::batch::Word {
                                word: format!("segment{index}"),
                                start: 0.25,
                                end: 0.75,
                                confidence: 1.0,
                                channel: 0,
                                speaker: None,
                                punctuated_word: None,
                            }],
                        }],
                    }],
                },
            })
        })
    }

    /// Les segments découpés arrivent en mémoire : on enregistre leur nom pour
    /// vérifier qu'aucun fichier n'a été écrit.
    fn transcribe_bytes<'a>(
        &'a self,
        _client: &'a reqwest_middleware::ClientWithMiddleware,
        _api_base: &'a str,
        _api_key: &'a str,
        _params: &'a owhisper_interface::ListenParams,
        audio: Vec<u8>,
        file_name: String,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<Response, owhisper_client::Error>> + Send + 'a>,
    > {
        Box::pin(async move {
            let index = {
                let mut uploads = SEGMENT_UPLOADS.lock().unwrap();
                let index = uploads.len();
                uploads.push(file_name);
                index
            };
            assert!(!audio.is_empty(), "a segment was uploaded empty");

            Ok(segment_response(index))
        })
    }
}

fn segment_response(index: usize) -> Response {
    Response {
        metadata: serde_json::json!({ "provider": "recording" }),
        results: owhisper_interface::batch::Results {
            channels: vec![owhisper_interface::batch::Channel {
                alternatives: vec![owhisper_interface::batch::Alternatives {
                    transcript: format!("segment {index}"),
                    confidence: 1.0,
                    words: vec![owhisper_interface::batch::Word {
                        word: format!("segment{index}"),
                        start: 0.25,
                        end: 0.75,
                        confidence: 1.0,
                        channel: 0,
                        speaker: None,
                        punctuated_word: None,
                    }],
                }],
            }],
        },
    }
}

static RATE_LIMITED_CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
const RATE_LIMITED_FAILURES: usize = 2;

#[derive(Clone, Default)]
struct RateLimitedAdapter;

impl BatchSttAdapter for RateLimitedAdapter {
    fn provider_name(&self) -> &'static str {
        "rate-limited"
    }

    fn is_supported_languages(
        &self,
        _languages: &[anlg_language::Language],
        _model: Option<&str>,
    ) -> bool {
        true
    }

    fn transcribe_file<'a, P: AsRef<Path> + Send + 'a>(
        &'a self,
        _client: &'a reqwest_middleware::ClientWithMiddleware,
        _api_base: &'a str,
        _api_key: &'a str,
        _params: &'a owhisper_interface::ListenParams,
        _file_path: P,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<Response, owhisper_client::Error>> + Send + 'a>,
    > {
        Box::pin(async move {
            let call = RATE_LIMITED_CALLS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if call < RATE_LIMITED_FAILURES {
                return Err(owhisper_client::Error::UnexpectedStatus {
                    status: reqwest_middleware::reqwest::StatusCode::TOO_MANY_REQUESTS,
                    body: r#"{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"7s"}]}}"#.to_string(),
                });
            }

            Ok(Response {
                metadata: serde_json::json!({ "provider": "rate-limited" }),
                results: owhisper_interface::batch::Results {
                    channels: vec![owhisper_interface::batch::Channel {
                        alternatives: vec![owhisper_interface::batch::Alternatives {
                            transcript: "recovered".to_string(),
                            confidence: 1.0,
                            words: vec![],
                        }],
                    }],
                },
            })
        })
    }
}

#[derive(Clone)]
struct HangingProviderState {
    request_started: Arc<Notify>,
    request_cancelled: Arc<Notify>,
}

struct NotifyOnDrop(Arc<Notify>);

impl Drop for NotifyOnDrop {
    fn drop(&mut self) {
        self.0.notify_one();
    }
}

async fn hanging_provider(State(state): State<HangingProviderState>) -> StatusCode {
    let _cancelled = NotifyOnDrop(state.request_cancelled.clone());
    state.request_started.notify_one();
    pending::<()>().await;
    StatusCode::OK
}

fn write_test_wav(path: &Path) {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec).unwrap();
    writer.write_sample(0.0f32).unwrap();
    writer.finalize().unwrap();
}

fn write_test_wav_samples(path: &Path, samples: usize) {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec).unwrap();
    for _ in 0..samples {
        writer.write_sample(0.0f32).unwrap();
    }
    writer.finalize().unwrap();
}

#[test]
fn direct_timeout_scales_with_audio_duration_and_is_bounded() {
    assert_eq!(
        direct_batch_timeout_for_audio(None),
        DIRECT_BATCH_TIMEOUT_FLOOR
    );
    assert_eq!(
        direct_batch_timeout_for_audio(Some(Duration::from_secs(60 * 60))),
        Duration::from_secs(2 * 60 * 60 + 5 * 60)
    );
    assert_eq!(
        direct_batch_timeout_for_audio(Some(Duration::from_secs(24 * 60 * 60))),
        DIRECT_BATCH_TIMEOUT_CEILING
    );
}

#[test]
fn segments_only_when_a_provider_limit_is_exceeded() {
    let source = tempfile::Builder::new().suffix(".wav").tempfile().unwrap();
    write_test_wav_samples(source.path(), TARGET_SAMPLE_RATE as usize);
    let path = source.path().to_str().unwrap();
    let size = std::fs::metadata(source.path()).unwrap().len();
    let limit = |max_bytes, max_duration| {
        Some(owhisper_client::BatchUploadLimit {
            max_bytes,
            max_duration,
        })
    };

    assert_eq!(segment_plan(&path_input(path), None, None), None);
    assert_eq!(
        segment_plan(
            &path_input(path),
            None,
            limit(size, Duration::from_secs(60))
        ),
        None
    );
    assert_eq!(
        segment_plan(
            &path_input(path),
            None,
            limit(size - 1, Duration::from_secs(60))
        ),
        Some(Duration::from_secs(60))
    );
    assert_eq!(
        segment_plan(
            &path_input(path),
            Some(Duration::from_secs(61)),
            limit(size, Duration::from_secs(60))
        ),
        Some(Duration::from_secs(60))
    );
}

#[test]
fn openai_diarize_splits_below_the_shared_openai_duration_cap() {
    let source = tempfile::Builder::new().suffix(".wav").tempfile().unwrap();
    write_test_wav_samples(source.path(), TARGET_SAMPLE_RATE as usize);
    let path = source.path().to_str().unwrap();
    let size = std::fs::metadata(source.path()).unwrap().len();
    let diarize = owhisper_client::AdapterKind::OpenAI
        .batch_upload_limit(Some("gpt-4o-transcribe-diarize"))
        .unwrap();
    let transcribe = owhisper_client::AdapterKind::OpenAI
        .batch_upload_limit(Some("gpt-4o-transcribe"))
        .unwrap();
    let meeting = Some(Duration::from_secs_f64(1500.012));

    assert!(
        size < transcribe.max_bytes,
        "fixture must be size-eligible so duration is the trigger"
    );
    assert_eq!(
        segment_plan(
            &path_input(path),
            Some(Duration::from_secs(1450)),
            Some(transcribe)
        ),
        None
    );
    assert_eq!(
        segment_plan(
            &path_input(path),
            Some(Duration::from_secs(1450)),
            Some(diarize)
        ),
        Some(diarize.max_duration)
    );
    assert_eq!(
        segment_plan(&path_input(path), meeting, Some(diarize)),
        Some(diarize.max_duration)
    );
    assert!(diarize.max_duration < Duration::from_secs(1400));
}

#[test]
fn merges_segment_transcripts_onto_a_single_timeline() {
    let segment = |transcript: &str, start: f64| Response {
        metadata: serde_json::json!({ "provider": "openai" }),
        results: owhisper_interface::batch::Results {
            channels: vec![owhisper_interface::batch::Channel {
                alternatives: vec![owhisper_interface::batch::Alternatives {
                    transcript: transcript.to_string(),
                    confidence: 1.0,
                    words: vec![owhisper_interface::batch::Word {
                        word: transcript.to_string(),
                        start,
                        end: start + 0.5,
                        confidence: 1.0,
                        channel: 0,
                        speaker: None,
                        punctuated_word: None,
                    }],
                }],
            }],
        },
    };

    let merged = merge_segment_responses(
        vec![segment("first", 1.0), segment("second", 2.0)],
        Duration::from_secs(600),
    );

    let alternative = &merged.results.channels[0].alternatives[0];
    assert_eq!(alternative.transcript, "first second");
    assert_eq!(alternative.words[0].start, 1.0);
    assert_eq!(alternative.words[1].start, 602.0);
    assert_eq!(alternative.words[1].end, 602.5);
    assert_eq!(merged.metadata["provider"], "openai");
}

#[test]
fn keeps_diarized_segment_speakers_distinct() {
    let segment = |label: &str, speaker: usize, start: f64| Response {
        metadata: serde_json::json!({
            "speaker_labels": [label],
            "speaker_segments": [{
                "speaker": label,
                "start": start,
                "end": start + 0.5,
            }],
        }),
        results: owhisper_interface::batch::Results {
            channels: vec![owhisper_interface::batch::Channel {
                alternatives: vec![owhisper_interface::batch::Alternatives {
                    transcript: label.to_string(),
                    confidence: 1.0,
                    words: vec![owhisper_interface::batch::Word {
                        word: label.to_string(),
                        start,
                        end: start + 0.5,
                        confidence: 1.0,
                        channel: 0,
                        speaker: Some(speaker),
                        punctuated_word: None,
                    }],
                }],
            }],
        },
    };

    let merged = merge_segment_responses(
        vec![segment("speaker_a", 0, 1.0), segment("speaker_b", 0, 2.0)],
        Duration::from_secs(600),
    );

    let alternative = &merged.results.channels[0].alternatives[0];
    assert_eq!(alternative.words[0].speaker, Some(0));
    assert_eq!(alternative.words[1].speaker, Some(1));
    assert_eq!(
        merged.metadata["speaker_labels"],
        serde_json::json!(["speaker_a", "speaker_b"])
    );
    assert_eq!(merged.metadata["speaker_segments"][0]["start"], 1.0);
    assert_eq!(merged.metadata["speaker_segments"][1]["start"], 602.0);
}

#[tokio::test]
async fn oversized_audio_is_uploaded_one_segment_at_a_time() {
    SEGMENT_UPLOADS.lock().unwrap().clear();
    let source = tempfile::Builder::new().suffix(".wav").tempfile().unwrap();
    write_test_wav_samples(source.path(), TARGET_SAMPLE_RATE as usize * 3);
    let size = std::fs::metadata(source.path()).unwrap().len();

    let params = BatchParams {
        session_id: "segment-test".to_string(),
        provider: super::super::BatchProvider::OpenAI,
        file_path: source.path().to_string_lossy().into_owned(),
        audio: None,
        model: None,
        base_url: "http://192.168.1.87:8000/v1".to_string(),
        api_key: "test".to_string(),
        languages: vec![anlg_language::ISO639::En.into()],
        keywords: vec![],
        num_speakers: None,
        min_speakers: None,
        max_speakers: None,
    };

    let output = run_direct_batch::<RecordingAdapter>(
        "recording",
        params,
        owhisper_interface::ListenParams::default(),
        Some(owhisper_client::BatchUploadLimit {
            max_bytes: size - 1,
            max_duration: Duration::from_secs(1),
        }),
    )
    .await
    .unwrap();

    let uploads = SEGMENT_UPLOADS.lock().unwrap().clone();
    assert_eq!(uploads.len(), 3, "3s of audio in 1s segments");
    for upload in &uploads {
        assert!(upload.ends_with(".mp3"), "segment was not re-encoded");
        assert!(!std::path::Path::new(upload).exists(), "segment leaked");
    }

    let alternative = &output.response.results.channels[0].alternatives[0];
    assert_eq!(alternative.transcript, "segment 0 segment 1 segment 2");
    assert_eq!(alternative.words[0].start, 0.25);
    assert_eq!(alternative.words[2].start, 2.25);
    assert!(source.path().exists());
}

#[tokio::test]
async fn direct_provider_timeout_cancels_non_responding_request() {
    let request_started = Arc::new(Notify::new());
    let request_cancelled = Arc::new(Notify::new());
    let state = HangingProviderState {
        request_started: request_started.clone(),
        request_cancelled: request_cancelled.clone(),
    };
    let app = Router::new().fallback(hanging_provider).with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let audio = tempfile::Builder::new().suffix(".wav").tempfile().unwrap();
    write_test_wav(audio.path());
    let params = BatchParams {
        session_id: "timeout-test".to_string(),
        provider: super::super::BatchProvider::OpenAI,
        file_path: audio.path().to_string_lossy().into_owned(),
        audio: None,
        model: Some("whisper-1".to_string()),
        base_url: format!("http://{address}/v1"),
        api_key: "test".to_string(),
        languages: vec![anlg_language::ISO639::En.into()],
        keywords: vec![],
        num_speakers: None,
        min_speakers: None,
        max_speakers: None,
    };
    let request = tokio::spawn(run_direct_batch_with_timeout::<HangingHttpAdapter>(
        "hanging-http",
        params,
        owhisper_interface::ListenParams {
            model: Some("whisper-1".to_string()),
            channels: 1,
            sample_rate: TARGET_SAMPLE_RATE,
            languages: vec![anlg_language::ISO639::En.into()],
            ..Default::default()
        },
        Duration::from_secs(5),
    ));

    tokio::time::timeout(Duration::from_secs(6), request_started.notified())
        .await
        .expect("provider did not receive the request");
    let error = request
        .await
        .expect("batch task panicked")
        .expect_err("non-responding provider should time out");

    match error {
        crate::Error::BatchFailed(failure) => {
            assert_eq!(failure.code(), crate::BatchErrorCode::TimedOut);
            assert!(matches!(
                failure,
                crate::BatchFailure::DirectRequestTimedOut { .. }
            ));
        }
        other => panic!("unexpected timeout error: {other:?}"),
    }
    tokio::time::timeout(Duration::from_secs(2), request_cancelled.notified())
        .await
        .expect("provider request was not cancelled");

    server.abort();
}

#[tokio::test(start_paused = true)]
async fn rate_limited_direct_request_is_retried_until_it_succeeds() {
    RATE_LIMITED_CALLS.store(0, std::sync::atomic::Ordering::SeqCst);
    let audio = tempfile::Builder::new().suffix(".wav").tempfile().unwrap();
    write_test_wav(audio.path());
    let params = BatchParams {
        session_id: "rate-limit-test".to_string(),
        provider: super::super::BatchProvider::OpenAI,
        file_path: audio.path().to_string_lossy().into_owned(),
        audio: None,
        model: None,
        base_url: "http://192.168.1.87:8000/v1".to_string(),
        api_key: "test".to_string(),
        languages: vec![anlg_language::ISO639::En.into()],
        keywords: vec![],
        num_speakers: None,
        min_speakers: None,
        max_speakers: None,
    };

    let started = tokio::time::Instant::now();
    let output = run_direct_batch_with_timeout::<RateLimitedAdapter>(
        "rate-limited",
        params,
        owhisper_interface::ListenParams::default(),
        DIRECT_BATCH_TIMEOUT_FLOOR,
    )
    .await
    .unwrap();

    assert_eq!(
        RATE_LIMITED_CALLS.load(std::sync::atomic::Ordering::SeqCst),
        RATE_LIMITED_FAILURES + 1
    );
    assert_eq!(
        output.response.results.channels[0].alternatives[0].transcript,
        "recovered"
    );
    assert_eq!(
        started.elapsed(),
        Duration::from_secs(7 * RATE_LIMITED_FAILURES as u64),
        "waits the server-provided retryDelay before each retry"
    );
}

#[test]
fn rate_limit_retry_delay_backs_off_and_honors_server_hint() {
    let rate_limited = |body: &str| owhisper_client::Error::UnexpectedStatus {
        status: reqwest_middleware::reqwest::StatusCode::TOO_MANY_REQUESTS,
        body: body.to_string(),
    };

    assert_eq!(
        rate_limit_retry_delay(&rate_limited("slow down"), 0),
        Some(RATE_LIMIT_BASE_DELAY)
    );
    assert_eq!(
        rate_limit_retry_delay(&rate_limited("slow down"), 1),
        Some(RATE_LIMIT_BASE_DELAY * 2)
    );
    assert_eq!(
        rate_limit_retry_delay(&rate_limited("slow down"), 2),
        Some(RATE_LIMIT_BASE_DELAY * 4)
    );
    assert_eq!(
        rate_limit_retry_delay(&rate_limited("slow down"), 10),
        Some(RATE_LIMIT_MAX_DELAY)
    );
    assert_eq!(
        rate_limit_retry_delay(
            &rate_limited(r#"{"error":{"details":[{"retryDelay":"42.5s"}]}}"#),
            0
        ),
        Some(Duration::from_secs_f64(42.5))
    );
    assert_eq!(
        rate_limit_retry_delay(
            &rate_limited(r#"{"error":{"details":[{"retryDelay":"600s"}]}}"#),
            0
        ),
        Some(RATE_LIMIT_MAX_DELAY)
    );
    assert_eq!(
        rate_limit_retry_delay(
            &owhisper_client::Error::provider_failure_with_status(
                reqwest_middleware::reqwest::StatusCode::TOO_MANY_REQUESTS,
                "quota",
                true,
            ),
            0
        ),
        Some(RATE_LIMIT_BASE_DELAY)
    );
    assert_eq!(
        rate_limit_retry_delay(
            &owhisper_client::Error::UnexpectedStatus {
                status: reqwest_middleware::reqwest::StatusCode::BAD_REQUEST,
                body: "rate limit".to_string(),
            },
            0
        ),
        None
    );
    assert_eq!(
        rate_limit_retry_delay(&owhisper_client::Error::AudioProcessing("429".into()), 0),
        None
    );
}
