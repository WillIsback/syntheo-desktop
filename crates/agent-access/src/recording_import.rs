use crate::{Error, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// The desktop renews its import-worker heartbeat every 30 s (a sparse SQLite
/// write, issue #271); three missed beats mean the app is gone.
const DESKTOP_WORKER_FRESHNESS_SECS: i64 = 90;

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct ImportRecordingInput {
    pub file_path: String,
    pub title: Option<String>,
    pub folder_path: Option<String>,
    /// Reuse this key when retrying submission. A different request needs a new key.
    pub request_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, sqlx::FromRow)]
pub struct RecordingImport {
    pub job_id: String,
    pub meeting_id: String,
    pub processing_status: String,
    pub summary_status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct GetRecordingImportInput {
    pub job_id: String,
}

fn database(source: sqlx::Error) -> Error {
    Error::Database {
        action: "recording import (open the updated desktop app first)",
        source,
    }
}
fn file_error(error: std::io::Error) -> Error {
    Error::Invalid(format!("Recording file: {error}"))
}

pub async fn get_recording_import(pool: &SqlitePool, job_id: &str) -> Result<RecordingImport> {
    sqlx::query_as("SELECT id AS job_id, meeting_id, processing_status, summary_status, error FROM local_recording_import_jobs WHERE id = ?")
        .bind(job_id).fetch_optional(pool).await.map_err(database)?
        .ok_or_else(|| Error::NotFound("recording import".into()))
}

pub async fn import_recording(
    pool: &SqlitePool,
    input: ImportRecordingInput,
) -> Result<RecordingImport> {
    if let Some(key) = &input.request_key {
        if key.is_empty() || key.len() > 200 {
            return Err(Error::Invalid(
                "request_key must contain 1–200 bytes".into(),
            ));
        }
        if let Some(id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM local_recording_import_jobs WHERE request_key = ?",
        )
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(database)?
        {
            return get_recording_import(pool, &id).await;
        }
    }
    let disabled: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM managed_app_settings WHERE id = 'intelligence_disabled' AND value_json = 'true')")
        .fetch_one(pool).await.map_err(database)?;
    if disabled {
        return Err(Error::Invalid(
            "Recording import is unavailable while managed intelligence is disabled".into(),
        ));
    }
    let vault: Option<String> = sqlx::query_scalar("SELECT vault_path FROM local_recording_import_worker WHERE updated_at > unixepoch() - ? AND vault_path != '' ORDER BY updated_at DESC LIMIT 1")
        .bind(DESKTOP_WORKER_FRESHNESS_SECS)
        .fetch_optional(pool).await.map_err(database)?;
    if vault.is_none() {
        return Err(Error::Invalid(
            "Open the updated Syntheo desktop app before importing recordings".into(),
        ));
    }
    let source = tokio::fs::canonicalize(&input.file_path)
        .await
        .map_err(file_error)?;
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["wav", "mp3", "ogg", "mp4", "m4a", "flac", "webm", "aac"].contains(&extension.as_str()) {
        return Err(Error::Invalid("Unsupported recording format".into()));
    }
    let metadata = tokio::fs::metadata(&source).await.map_err(file_error)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(Error::Invalid(
            "Recording must be a nonempty regular file".into(),
        ));
    }
    let folder = input.folder_path.unwrap_or_default();
    if !folder.is_empty() {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM folders WHERE path = ? AND deleted_at IS NULL)",
        )
        .bind(&folder)
        .fetch_one(pool)
        .await
        .map_err(database)?;
        if !exists {
            return Err(Error::Invalid(
                "Folder does not exist; use meetings folders to choose an existing folder".into(),
            ));
        }
    }
    // No copy: the recording is transcribed from its original location, and the
    // job stores that path so the audio never touches the app's data directory.
    let id = uuid::Uuid::new_v4().to_string();
    let title = input.title.unwrap_or_else(|| {
        source
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let result = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(database)?;
        if let Some(key) = &input.request_key
            && let Some(existing) = sqlx::query_scalar::<_, String>("SELECT id FROM local_recording_import_jobs WHERE request_key = ?")
                .bind(key).fetch_optional(&mut *tx).await.map_err(database)? {
                tx.rollback().await.map_err(database)?;
                return Ok(existing);
        }
        let now: String = sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").fetch_one(&mut *tx).await.map_err(database)?;
        syntheo_db_app::insert_session(&mut tx, &id, &title, "", "", &folder, &now).await.map_err(database)?;
        syntheo_db_app::insert_empty_session_note(&mut tx, &id, "", &now).await.map_err(database)?;
        syntheo_db_app::upsert_session_owner_human(&mut tx, &id, &now).await.map_err(database)?;
        syntheo_db_app::insert_owner_session_participant(&mut tx, &uuid::Uuid::new_v4().to_string(), &id, &now).await.map_err(database)?;
        sqlx::query("INSERT INTO local_recording_import_jobs (id, meeting_id, request_key, file_path, updated_at) VALUES (?, ?, ?, ?, unixepoch())")
            .bind(&id).bind(&id).bind(&input.request_key).bind(source.to_string_lossy().as_ref()).execute(&mut *tx).await.map_err(database)?;
        tx.commit().await.map_err(database)?;
        Ok::<_, Error>(id.clone())
    }.await;
    get_recording_import(pool, &result?).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn worker_vault(db: &syntheo_db_core::Db, vault: &str) {
        sqlx::query("INSERT INTO local_recording_import_worker (id, vault_path, updated_at) VALUES ('desktop', ?, unixepoch())")
            .bind(vault)
            .execute(db.pool())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn concurrent_retries_create_one_meeting_without_copying_the_recording() {
        let dir = tempfile::tempdir().unwrap();
        let db = syntheo_db_core::Db::connect_local_plain(dir.path().join("app.db"))
            .await
            .unwrap();
        syntheo_db_app::prepare_schema(&db).await.unwrap();
        worker_vault(&db, dir.path().to_string_lossy().as_ref()).await;
        sqlx::query("INSERT INTO folders (id, path) VALUES ('research', 'Research')")
            .execute(db.pool())
            .await
            .unwrap();
        let file = dir.path().join("Recording.wav");
        tokio::fs::write(&file, b"recording content").await.unwrap();
        let input = ImportRecordingInput {
            file_path: file.to_string_lossy().into_owned(),
            title: Some("Imported meeting".into()),
            folder_path: Some("Research".into()),
            request_key: Some("pipeline-1".into()),
        };
        let (a, b) = tokio::join!(
            import_recording(db.pool(), input.clone()),
            import_recording(db.pool(), input)
        );
        let a = a.unwrap();
        assert_eq!(a.job_id, b.unwrap().job_id);
        assert_eq!(a.processing_status, "queued");
        let meeting = crate::get_meeting(
            db.pool(),
            crate::GetMeetingInput {
                meeting_id: a.meeting_id.clone(),
            },
        )
        .await
        .unwrap();
        assert_eq!(meeting.title, "Imported meeting");
        assert!(meeting.note.is_some());
        assert_eq!(meeting.folder_path.as_deref(), Some("Research"));
        let local = local_meeting(db.pool(), meeting).await.unwrap();
        assert_eq!(local.processing_status.as_deref(), Some("queued"));
        assert_eq!(local.recording_import.unwrap().job_id, a.job_id);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count, 1);

        // The job points at the user's original file; nothing was copied.
        let stored: String =
            sqlx::query_scalar("SELECT file_path FROM local_recording_import_jobs")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(stored, file.canonicalize().unwrap().to_string_lossy());
        assert_eq!(std::fs::read(&file).unwrap(), b"recording content");
        // No staging directory is created: nothing was copied.
        assert!(!dir.path().join("recording-imports").exists());
        db.pool().close().await;
    }

    #[tokio::test]
    async fn desktop_worker_stays_available_between_sparse_heartbeats() {
        let dir = tempfile::tempdir().unwrap();
        let db = syntheo_db_core::Db::connect_local_plain(dir.path().join("app.db"))
            .await
            .unwrap();
        syntheo_db_app::prepare_schema(&db).await.unwrap();
        let file = dir.path().join("meeting.wav");
        tokio::fs::write(&file, b"audio").await.unwrap();
        let input = || ImportRecordingInput {
            file_path: file.to_string_lossy().into_owned(),
            title: None,
            folder_path: None,
            request_key: None,
        };
        sqlx::query("INSERT INTO local_recording_import_worker (id, vault_path, updated_at) VALUES ('desktop', ?, unixepoch() - 45)")
            .bind(dir.path().to_string_lossy().as_ref())
            .execute(db.pool())
            .await
            .unwrap();
        assert_eq!(
            import_recording(db.pool(), input())
                .await
                .unwrap()
                .processing_status,
            "queued"
        );

        sqlx::query("UPDATE local_recording_import_worker SET updated_at = unixepoch() - 120")
            .execute(db.pool())
            .await
            .unwrap();
        assert!(
            import_recording(db.pool(), input())
                .await
                .unwrap_err()
                .to_string()
                .contains("desktop")
        );
        db.pool().close().await;
    }

    #[tokio::test]
    async fn unavailable_worker_and_invalid_files_leave_no_meetings() {
        let dir = tempfile::tempdir().unwrap();
        let db = syntheo_db_core::Db::connect_local_plain(dir.path().join("app.db"))
            .await
            .unwrap();
        syntheo_db_app::prepare_schema(&db).await.unwrap();
        let file = dir.path().join("empty.wav");
        tokio::fs::write(&file, b"").await.unwrap();
        let input = ImportRecordingInput {
            file_path: file.to_string_lossy().into_owned(),
            title: None,
            folder_path: None,
            request_key: None,
        };
        assert!(
            import_recording(db.pool(), input.clone())
                .await
                .unwrap_err()
                .to_string()
                .contains("desktop")
        );
        worker_vault(&db, dir.path().to_string_lossy().as_ref()).await;
        assert!(
            import_recording(db.pool(), input)
                .await
                .unwrap_err()
                .to_string()
                .contains("nonempty")
        );
        tokio::fs::write(&file, b"audio").await.unwrap();
        sqlx::query("INSERT INTO managed_app_settings (id, value_json) VALUES ('intelligence_disabled', 'true')").execute(db.pool()).await.unwrap();
        assert!(
            import_recording(
                db.pool(),
                ImportRecordingInput {
                    file_path: file.to_string_lossy().into_owned(),
                    title: None,
                    folder_path: None,
                    request_key: None
                }
            )
            .await
            .unwrap_err()
            .to_string()
            .contains("managed intelligence")
        );
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count, 0);
        db.pool().close().await;
    }
}

/// Local-only execution metadata is not part of hosted meeting snapshots.
#[derive(Debug, Serialize, JsonSchema)]
pub struct LocalMeeting {
    #[serde(flatten)]
    pub meeting: crate::Meeting,
    pub processing_status: Option<String>,
    pub recording_import: Option<RecordingImport>,
}

pub async fn local_meeting(pool: &SqlitePool, meeting: crate::Meeting) -> Result<LocalMeeting> {
    let available: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_recording_import_jobs')")
        .fetch_one(pool).await.map_err(database)?;
    let job = if available {
        sqlx::query_as::<_, RecordingImport>("SELECT id AS job_id, meeting_id, processing_status, summary_status, error FROM local_recording_import_jobs WHERE meeting_id = ? ORDER BY updated_at DESC LIMIT 1")
            .bind(&meeting.id).fetch_optional(pool).await.map_err(database)?
    } else {
        None
    };
    Ok(LocalMeeting {
        processing_status: job.as_ref().map(|job| job.processing_status.clone()),
        meeting,
        recording_import: job,
    })
}
