use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use sqlx::SqlitePool;
use tauri::Manager;
use tauri_plugin_fs_sync::FsSyncPluginExt;
use tauri_specta::Event;

use crate::{BatchSessionRegistry, ListenerPluginExt};

const SWEEP_INTERVAL: Duration = Duration::from_secs(60);
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

const AUDIO_RETENTION_SETTING_ID: &str = "audio_retention";
const SAVE_RECORDINGS_SETTING_ID: &str = "save_recordings";
const LEGACY_SETTINGS_ID: &str = "legacy_settings_document";
const LEGACY_MAIN_VALUES_ID: &str = "legacy_main_values_document";

// Réglage hérité d'Anarlog, ignoré par Syntheo (rétention toujours « aucune ») ;
// supprimé avec le reste du balayage au ménage 04c-B.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioRetentionPolicy {
    None,
    OneDay,
    ThreeDays,
    OneWeek,
    OneMonth,
    Forever,
}

// Réglage hérité d'Anarlog, ignoré par Syntheo (rétention toujours « aucune ») ;
// supprimé avec le reste du balayage au ménage 04c-B.
#[allow(dead_code)]
impl AudioRetentionPolicy {
    fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::Bool(false) => Some(Self::None),
            Value::Bool(true) => Some(Self::Forever),
            Value::String(value) => match value.as_str() {
                "none" => Some(Self::None),
                "oneDay" => Some(Self::OneDay),
                "threeDays" => Some(Self::ThreeDays),
                "oneWeek" => Some(Self::OneWeek),
                "oneMonth" => Some(Self::OneMonth),
                "forever" => Some(Self::Forever),
                _ => None,
            },
            _ => None,
        }
    }

    fn duration_ms(self) -> Option<i64> {
        match self {
            Self::None => Some(0),
            Self::OneDay => Some(DAY_MS),
            Self::ThreeDays => Some(3 * DAY_MS),
            Self::OneWeek => Some(7 * DAY_MS),
            Self::OneMonth => Some(30 * DAY_MS),
            Self::Forever => None,
        }
    }
}

// Réglage hérité d'Anarlog, ignoré par Syntheo (rétention toujours « aucune ») ;
// supprimé avec le reste du balayage au ménage 04c-B.
#[allow(dead_code)]
#[derive(Debug, Default)]
struct StoredRetentionSettings {
    audio_retention: Option<String>,
    save_recordings: Option<String>,
    legacy_settings: Option<String>,
    legacy_main_values: Option<String>,
}

/// Règle audio de Syntheo : la rétention est toujours « aucune ». Les réglages
/// hérités (`audio_retention`, `save_recordings`, documents legacy) sont ignorés ;
/// le balayage reste actif comme filet de sécurité pour l'audio hérité.
fn resolve_policy(_stored: &StoredRetentionSettings) -> AudioRetentionPolicy {
    AudioRetentionPolicy::None
}

async fn load_policy(pool: &SqlitePool) -> Result<AudioRetentionPolicy, sqlx::Error> {
    let get = |id| anlg_db_app::get_app_setting_json(pool, id);
    Ok(resolve_policy(&StoredRetentionSettings {
        audio_retention: get(AUDIO_RETENTION_SETTING_ID).await?,
        save_recordings: get(SAVE_RECORDINGS_SETTING_ID).await?,
        legacy_settings: get(LEGACY_SETTINGS_ID).await?,
        legacy_main_values: get(LEGACY_MAIN_VALUES_ID).await?,
    }))
}

fn is_expired(created_at_ms: Option<i64>, policy: AudioRetentionPolicy, now_ms: i64) -> bool {
    match (policy, policy.duration_ms(), created_at_ms) {
        (AudioRetentionPolicy::None, _, _) => true,
        (_, Some(duration), Some(created_at)) => now_ms >= created_at.saturating_add(duration),
        _ => false,
    }
}

fn retention_expired(
    candidate: &anlg_db_app::SessionAudioRetentionCandidate,
    policy: AudioRetentionPolicy,
    now_ms: i64,
) -> bool {
    if policy == AudioRetentionPolicy::None && !candidate.has_words {
        return false;
    }
    is_expired(candidate.created_at_ms, policy, now_ms)
}

async fn session_audio_is_expired(pool: &SqlitePool, session_id: &str) -> Result<bool, String> {
    let policy = load_policy(pool).await.map_err(|e| e.to_string())?;
    let candidate = anlg_db_app::get_session_audio_retention_candidate(pool, session_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(candidate.is_some_and(|candidate| {
        retention_expired(&candidate, policy, chrono::Utc::now().timestamp_millis())
    }))
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionAudioRetentionPhase {
    Deleting,
    Deleted,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, specta::Type, tauri_specta::Event)]
pub struct SessionAudioRetentionEvent {
    pub session_id: String,
    pub phase: SessionAudioRetentionPhase,
}

fn db_pool<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<SqlitePool> {
    app.try_state::<tauri_plugin_db::ManagedState>()
        .map(|state| state.pool().clone())
}

fn batch_session_belongs_to(batch_session_id: &str, session_id: &str) -> bool {
    batch_session_id
        .strip_prefix(session_id)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(':'))
}

/// Conservative: any uncertainty about capture or batch state keeps the audio.
async fn session_audio_is_idle<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    session_id: &str,
) -> bool {
    let Ok(snapshot) = app.listener().get_capture_snapshot().await else {
        return false;
    };
    if snapshot.active_session_id.as_deref() == Some(session_id)
        || snapshot
            .finalizing_session_ids
            .iter()
            .any(|id| id == session_id)
    {
        return false;
    }

    let registry = app.state::<Arc<BatchSessionRegistry>>();
    registry.sessions.lock().is_ok_and(|sessions| {
        !sessions
            .keys()
            .any(|id| batch_session_belongs_to(id, session_id))
    })
}

#[derive(Clone, Copy)]
enum Eligibility {
    Expired,
    Processed,
    LogicallyDeleted,
}

async fn delete_local_audio<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    pool: &SqlitePool,
    session_id: &str,
    eligibility: Eligibility,
) -> Result<bool, String> {
    let _guard = app.fs_sync().lock_session_audio(session_id).await;
    if !session_audio_is_idle(app, session_id).await {
        return Ok(false);
    }
    let eligible = match eligibility {
        Eligibility::Expired => session_audio_is_expired(pool, session_id).await?,
        Eligibility::Processed => anlg_db_app::session_audio_is_processed(pool, session_id)
            .await
            .map_err(|e| e.to_string())?,
        Eligibility::LogicallyDeleted => {
            anlg_db_app::session_audio_is_logically_deleted(pool, session_id)
                .await
                .map_err(|e| e.to_string())?
        }
    };
    if !eligible {
        return Ok(false);
    }

    let emit = |phase| {
        let _ = SessionAudioRetentionEvent {
            session_id: session_id.to_string(),
            phase,
        }
        .emit(app);
    };
    emit(SessionAudioRetentionPhase::Deleting);
    let deleted = app.fs_sync().delete_session_audio_locked(session_id)?;
    anlg_db_app::mark_session_audio_absent(pool, session_id)
        .await
        .map_err(|e| e.to_string())?;
    if deleted {
        emit(SessionAudioRetentionPhase::Deleted);
    }
    Ok(deleted)
}

async fn sweep<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    pool: &SqlitePool,
) -> Result<(), String> {
    let logically_deleted = anlg_db_app::list_logically_deleted_session_audio(pool)
        .await
        .map_err(|e| e.to_string())?;
    for session_id in logically_deleted {
        if let Err(error) =
            delete_local_audio(app, pool, &session_id, Eligibility::LogicallyDeleted).await
        {
            tracing::warn!(%session_id, %error, "deleted_session_audio_cleanup_failed");
        }
    }

    let policy = load_policy(pool).await.map_err(|e| e.to_string())?;
    if policy == AudioRetentionPolicy::Forever {
        return Ok(());
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let candidates = anlg_db_app::list_session_audio_retention_candidates(pool)
        .await
        .map_err(|e| e.to_string())?;
    for candidate in candidates {
        if !retention_expired(&candidate, policy, now_ms) {
            continue;
        }
        let session_id = candidate.session_id;
        if let Err(error) = delete_local_audio(app, pool, &session_id, Eligibility::Expired).await {
            tracing::warn!(%session_id, %error, "expired_session_audio_cleanup_failed");
        }
    }
    Ok(())
}

pub(crate) fn spawn<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(SWEEP_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Some(pool) = db_pool(&app) else {
                continue;
            };
            if let Err(error) = sweep(&app, &pool).await {
                tracing::warn!(%error, "audio_retention_sweep_failed");
            }
        }
    });
}

/// Deletes local audio right after processing when the retention policy is `none`.
#[tauri::command]
#[specta::specta]
pub async fn delete_processed_session_audio<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    session_id: String,
) -> Result<bool, String> {
    let pool = db_pool(&app).ok_or_else(|| "database is not ready yet".to_string())?;
    if load_policy(&pool).await.map_err(|e| e.to_string())? != AudioRetentionPolicy::None {
        return Ok(false);
    }
    delete_local_audio(&app, &pool, &session_id, Eligibility::Processed).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(
        audio_retention: Option<&str>,
        save_recordings: Option<&str>,
        legacy_settings: Option<&str>,
        legacy_main_values: Option<&str>,
    ) -> StoredRetentionSettings {
        StoredRetentionSettings {
            audio_retention: audio_retention.map(str::to_string),
            save_recordings: save_recordings.map(str::to_string),
            legacy_settings: legacy_settings.map(str::to_string),
            legacy_main_values: legacy_main_values.map(str::to_string),
        }
    }

    // Règle audio de Syntheo : la rétention est toujours « aucune », quel que
    // soit le réglage hérité stocké.
    #[test]
    fn retention_policy_is_always_none() {
        for stored_value in [r#""forever""#, r#""oneWeek""#, r#""none""#] {
            assert_eq!(
                resolve_policy(&stored(Some(stored_value), None, None, None)),
                AudioRetentionPolicy::None
            );
        }
        assert_eq!(
            resolve_policy(&stored(None, None, None, None)),
            AudioRetentionPolicy::None
        );
    }

    #[test]
    fn legacy_session_audio_is_swept_under_forced_none() {
        let policy = resolve_policy(&stored(Some(r#""forever""#), None, None, None));
        let candidate = anlg_db_app::SessionAudioRetentionCandidate {
            session_id: "legacy".to_string(),
            created_at_ms: Some(1_000),
            has_words: true,
        };
        assert!(retention_expired(&candidate, policy, 1_000));
    }

    #[test]
    fn retention_window_starts_at_session_creation() {
        let created = Some(1_000);
        assert!(!is_expired(
            created,
            AudioRetentionPolicy::OneDay,
            1_000 + DAY_MS - 1
        ));
        assert!(is_expired(
            created,
            AudioRetentionPolicy::OneDay,
            1_000 + DAY_MS
        ));
        assert!(!is_expired(None, AudioRetentionPolicy::OneMonth, i64::MAX));
        assert!(!is_expired(
            created,
            AudioRetentionPolicy::Forever,
            i64::MAX
        ));
        assert!(is_expired(None, AudioRetentionPolicy::None, 0));
    }

    #[test]
    fn batch_sessions_match_their_capture_session_only() {
        assert!(batch_session_belongs_to("s1", "s1"));
        assert!(batch_session_belongs_to("s1:recovery", "s1"));
        assert!(!batch_session_belongs_to("s10", "s1"));
    }
}
