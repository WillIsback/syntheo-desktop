use std::time::Duration;

use tauri::Manager;

const DB_WAIT: Duration = Duration::from_secs(1);
const DB_ATTEMPTS: usize = 30;

/// Efface au démarrage les empreintes vocales laissées par Syntheo : les
/// secrets du trousseau d'abord, puis les tables qui les référencent.
pub(crate) fn spawn<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        for _ in 0..DB_ATTEMPTS {
            if let Some(pool) = app
                .try_state::<tauri_plugin_db::ManagedState>()
                .map(|state| state.pool().clone())
            {
                if let Err(error) = syntheo_db_app::purge_legacy_voiceprints(&pool, |scope, key| {
                    tauri_plugin_store2::delete_secret_blocking(&app, scope, key)
                })
                .await
                {
                    tracing::warn!(%error, "legacy_voiceprint_purge_failed");
                }
                return;
            }
            tokio::time::sleep(DB_WAIT).await;
        }
        tracing::warn!("legacy_voiceprint_purge_skipped_without_db");
    });
}
