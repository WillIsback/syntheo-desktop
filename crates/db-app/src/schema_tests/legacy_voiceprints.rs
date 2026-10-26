use super::*;

async fn insert_legacy_voiceprints(db: &Db) {
    sqlx::raw_sql(
        "PRAGMA ignore_check_constraints = ON;
         INSERT INTO voiceprint_exemplars (id, keyring_key) VALUES ('exemplar-1', 'exemplar-1');
         INSERT INTO voiceprint_candidates (id, keyring_key) VALUES ('candidate-1', 'candidate-1');
         PRAGMA ignore_check_constraints = OFF;",
    )
    .execute(db.pool())
    .await
    .unwrap();
}

async fn table_exists(db: &Db, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?")
        .bind(name)
        .fetch_one(db.pool())
        .await
        .unwrap()
        > 0
}

#[tokio::test]
async fn legacy_voiceprints_are_purged_with_their_secrets() {
    let db = test_db().await;
    insert_legacy_voiceprints(&db).await;

    let mut deleted = Vec::new();
    purge_legacy_voiceprints(db.pool(), |scope, key| {
        deleted.push(format!("{scope}:{key}"));
        Ok(())
    })
    .await
    .unwrap();

    deleted.sort();
    assert_eq!(
        deleted,
        [
            "voiceprint_candidates:candidate-1",
            "voiceprint_exemplars:exemplar-1"
        ]
    );
    assert!(!table_exists(&db, "voiceprint_exemplars").await);
    assert!(!table_exists(&db, "voiceprint_candidates").await);

    // Idempotent once the tables are gone.
    purge_legacy_voiceprints(db.pool(), |_, _| panic!("no secret left"))
        .await
        .unwrap();
}

#[tokio::test]
async fn legacy_voiceprints_are_kept_while_a_secret_cannot_be_deleted() {
    let db = test_db().await;
    insert_legacy_voiceprints(&db).await;

    let result = purge_legacy_voiceprints(db.pool(), |_, _| Err("keychain locked".into())).await;

    assert!(result.is_err());
    // The coordinates stay so the next launch can retry.
    assert!(table_exists(&db, "voiceprint_exemplars").await);
    assert!(table_exists(&db, "voiceprint_candidates").await);
}

#[tokio::test]
async fn sessions_can_still_be_purged_once_legacy_voiceprints_are_gone() {
    let db = test_db().await;
    purge_legacy_voiceprints(db.pool(), |_, _| Ok(()))
        .await
        .unwrap();
    sqlx::raw_sql(
        "INSERT INTO app_settings (id, value_json) VALUES ('cloud_sync_enabled', 'false');
         INSERT INTO sessions (id, workspace_id, title) VALUES ('session-1', 'workspace-1', 'Revue');",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let mut tx = db.pool().begin().await.unwrap();
    purge_local_session(&mut tx, "session-1").await.unwrap();
    tx.commit().await.unwrap();
}
