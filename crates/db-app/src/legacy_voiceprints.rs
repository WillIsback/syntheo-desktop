//! Syntheo ne calcule plus d'empreintes vocales. Les versions héritées
//! d'Anarlog ont pu en enregistrer : les vecteurs sont des secrets du
//! trousseau, ces tables n'en gardent que les coordonnées.

use sqlx::SqlitePool;

/// (table, lecture des coordonnées, suppression)
const LEGACY_TABLES: [(&str, &str, &str); 2] = [
    (
        "voiceprint_exemplars",
        "SELECT keyring_scope, keyring_key FROM voiceprint_exemplars",
        "DROP TABLE IF EXISTS voiceprint_exemplars",
    ),
    (
        "voiceprint_candidates",
        "SELECT keyring_scope, keyring_key FROM voiceprint_candidates",
        "DROP TABLE IF EXISTS voiceprint_candidates",
    ),
];

/// Supprime chaque secret référencé, puis les tables. Si un secret résiste,
/// les tables restent pour que le prochain lancement réessaie.
pub async fn purge_legacy_voiceprints(
    pool: &SqlitePool,
    mut delete_secret: impl FnMut(&str, &str) -> Result<(), String>,
) -> Result<(), String> {
    for (table, select, _) in LEGACY_TABLES {
        let exists: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?")
                .bind(table)
                .fetch_one(pool)
                .await
                .map_err(|error| error.to_string())?;
        if exists == 0 {
            continue;
        }
        let secrets: Vec<(String, String)> = sqlx::query_as(select)
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?;
        for (scope, key) in &secrets {
            delete_secret(scope, key)?;
        }
    }
    for (_, _, drop) in LEGACY_TABLES {
        sqlx::query(drop)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
