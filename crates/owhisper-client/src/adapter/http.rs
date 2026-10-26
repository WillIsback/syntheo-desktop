use std::path::Path;

use reqwest::Response;
use reqwest::multipart::Part;

use crate::error::Error;

const MAX_ERROR_BODY_BYTES: usize = 64 * 1024;

pub async fn ensure_success(response: Response) -> Result<Response, Error> {
    let status = response.status();
    if status.is_success() {
        Ok(response)
    } else {
        let body = error_body(response).await;
        Err(Error::UnexpectedStatus { status, body })
    }
}

pub async fn error_body(response: Response) -> String {
    error_body_with_limit(response, MAX_ERROR_BODY_BYTES).await
}

async fn error_body_with_limit(mut response: Response, limit: usize) -> String {
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or_default()
            .min(limit),
    );
    let mut truncated = response
        .content_length()
        .is_some_and(|length| length > limit as u64);

    while let Ok(Some(chunk)) = response.chunk().await {
        let remaining = limit.saturating_sub(body.len());
        let keep = remaining.min(chunk.len());
        body.extend_from_slice(&chunk[..keep]);
        if keep < chunk.len() {
            truncated = true;
            break;
        }
        if body.len() == limit {
            if let Ok(Some(_)) = response.chunk().await {
                truncated = true;
            }
            break;
        }
    }

    let mut body = String::from_utf8_lossy(&body).into_owned();
    if truncated {
        body.push_str("\n[response body truncated]");
    }
    body
}

pub fn mime_type_from_extension(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("mp3") => "audio/mpeg",
        Some("mp4") => "audio/mp4",
        Some("m4a") => "audio/mp4",
        Some("wav") => "audio/wav",
        Some("webm") => "audio/webm",
        Some("ogg") => "audio/ogg",
        Some("flac") => "audio/flac",
        _ => "application/octet-stream",
    }
}

pub async fn streaming_file_body(file_path: &Path) -> Result<(reqwest::Body, u64), Error> {
    let file = tokio::fs::File::open(file_path)
        .await
        .map_err(|e| Error::AudioProcessing(e.to_string()))?;
    let length = file
        .metadata()
        .await
        .map_err(|e| Error::AudioProcessing(e.to_string()))?
        .len();

    Ok((reqwest::Body::from(file), length))
}

/// Construit une partie multipart à partir d'un tampon audio en mémoire. Les
/// chemins qui ne doivent rien écrire sur disque (dictée, imports) passent par
/// ici plutôt que par un fichier.
pub fn streaming_bytes_part(
    data: Vec<u8>,
    file_name: &str,
    mime_type: &str,
) -> Result<Part, Error> {
    let length = data.len() as u64;
    Part::stream_with_length(reqwest::Body::from(data), length)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|e| Error::AudioProcessing(e.to_string()))
}

/// Source audio d'un envoi batch : un fichier existant, ou un tampon en mémoire
/// quand l'audio ne doit jamais toucher le disque.
#[derive(Debug, Clone)]
pub(crate) enum AudioBody {
    Path(std::path::PathBuf),
    Bytes { data: Vec<u8>, file_name: String },
}

impl AudioBody {
    pub(crate) async fn to_part(&self) -> Result<Part, Error> {
        match self {
            AudioBody::Path(path) => streaming_file_part(path).await,
            AudioBody::Bytes { data, file_name } => {
                let mime = mime_type_from_extension(Path::new(file_name));
                streaming_bytes_part(data.clone(), file_name, mime)
            }
        }
    }
}

pub async fn streaming_file_part(file_path: &Path) -> Result<Part, Error> {
    let fallback_name = match file_path.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("audio.{}", ext),
        None => "audio".to_string(),
    };

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or(fallback_name);

    let (body, length) = streaming_file_body(file_path).await?;
    let mime_type = mime_type_from_extension(file_path);

    Part::stream_with_length(body, length)
        .file_name(file_name)
        .mime_str(mime_type)
        .map_err(|e| Error::AudioProcessing(e.to_string()))
}

#[cfg(test)]
mod tests {
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers::path};

    use super::{error_body_with_limit, streaming_bytes_part};

    #[tokio::test]
    async fn error_body_is_capped_and_marked() {
        let server = MockServer::start().await;
        Mock::given(path("/error"))
            .respond_with(ResponseTemplate::new(500).set_body_bytes(vec![b'x'; 17]))
            .mount(&server)
            .await;
        let response = reqwest::get(format!("{}/error", server.uri()))
            .await
            .unwrap();

        let body = error_body_with_limit(response, 16).await;
        assert_eq!(
            body,
            format!("{}\n[response body truncated]", "x".repeat(16))
        );
    }

    #[tokio::test]
    async fn in_memory_audio_is_sent_as_a_multipart_file_part() {
        let server = MockServer::start().await;
        Mock::given(path("/v1/audio/transcriptions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .expect(1)
            .mount(&server)
            .await;

        let part = streaming_bytes_part(b"abc".to_vec(), "dictation.wav", "audio/wav").unwrap();
        let form = reqwest::multipart::Form::new().part("file", part);
        reqwest::Client::new()
            .post(format!("{}/v1/audio/transcriptions", server.uri()))
            .multipart(form)
            .send()
            .await
            .unwrap();

        let requests = server.received_requests().await.unwrap();
        let body = String::from_utf8_lossy(&requests[0].body).into_owned();
        assert!(body.contains("filename=\"dictation.wav\""), "{body:.300}");
        assert!(body.contains("Content-Type: audio/wav"), "{body:.300}");
        assert!(body.contains("abc"), "{body:.300}");
    }
}
