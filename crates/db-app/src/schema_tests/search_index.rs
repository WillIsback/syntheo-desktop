use super::*;

#[test]
fn search_index_trigger_migrations_are_cloudsync_guarded() {
    let queue_step = APP_MIGRATION_STEPS
        .iter()
        .find(|step| step.id == "20260714120000_search_index_queue")
        .unwrap();
    assert_eq!(queue_step.scope, syntheo_db_migrate::MigrationScope::Plain);
    let acknowledgement_step = APP_MIGRATION_STEPS
        .iter()
        .find(|step| step.id == "20260815100200_search_index_acknowledgements")
        .unwrap();
    assert_eq!(
        acknowledgement_step.scope,
        syntheo_db_migrate::MigrationScope::Plain
    );

    for (id, table_name) in [
        ("20260714120100_search_index_sessions_triggers", "sessions"),
        (
            "20260714120200_search_index_session_documents_triggers",
            "session_documents",
        ),
        (
            "20260714120300_search_index_transcripts_triggers",
            "transcripts",
        ),
        ("20260714120400_search_index_humans_triggers", "humans"),
        (
            "20260714120500_search_index_organizations_triggers",
            "organizations",
        ),
    ] {
        let step = APP_MIGRATION_STEPS
            .iter()
            .find(|step| step.id == id)
            .unwrap();
        assert_eq!(
            step.scope,
            syntheo_db_migrate::MigrationScope::CloudsyncAlter { table_name }
        );
    }
}

#[tokio::test]
async fn acknowledged_search_generations_remain_monotonic() {
    let db = test_db().await;
    sqlx::query("INSERT INTO sessions (id, title) VALUES ('session-1', 'One')")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query(
        "UPDATE search_index_dirty
         SET acknowledged_generation = generation
         WHERE entity_type = 'session' AND entity_id = 'session-1'",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query("UPDATE sessions SET title = 'Two' WHERE id = 'session-1'")
        .execute(db.pool())
        .await
        .unwrap();

    let (generation, acknowledged_generation): (i64, i64) = sqlx::query_as(
        "SELECT generation, acknowledged_generation
         FROM search_index_dirty
         WHERE entity_type = 'session' AND entity_id = 'session-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(generation, 2);
    assert_eq!(acknowledged_generation, 1);
}

#[tokio::test]
async fn active_transcript_journal_defers_search_until_final_compaction() {
    let db = test_db().await;
    sqlx::query("INSERT INTO sessions (id, title) VALUES ('session-1', 'One')")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO transcripts (id, session_id, words_json)
         VALUES ('transcript-1', 'session-1', '[]')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE search_index_dirty
         SET acknowledged_generation = generation
         WHERE entity_type = 'session' AND entity_id = 'session-1'",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let baseline_generation: i64 = sqlx::query_scalar(
        "SELECT generation FROM search_index_dirty
         WHERE entity_type = 'session' AND entity_id = 'session-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();

    let mut transaction = db.pool().begin().await.unwrap();
    sqlx::query(
        "INSERT INTO transcript_live_state (transcript_id, next_sequence)
         VALUES ('transcript-1', 120)",
    )
    .execute(&mut *transaction)
    .await
    .unwrap();
    for sequence in 0..120 {
        sqlx::query(
            "INSERT INTO transcript_live_deltas (id, transcript_id, sequence)
             VALUES (?, 'transcript-1', ?)",
        )
        .bind(format!("delta-{sequence}"))
        .bind(sequence)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }
    transaction.commit().await.unwrap();

    let generation_during_capture: i64 = sqlx::query_scalar(
        "SELECT generation FROM search_index_dirty
         WHERE entity_type = 'session' AND entity_id = 'session-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(generation_during_capture, baseline_generation);

    sqlx::query(
        "UPDATE transcripts
         SET words_json = '[{\"text\":\"final\"}]', content_revision = content_revision + 1
         WHERE id = 'transcript-1'",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let (final_generation, acknowledged_generation): (i64, i64) = sqlx::query_as(
        "SELECT generation, acknowledged_generation
         FROM search_index_dirty
         WHERE entity_type = 'session' AND entity_id = 'session-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(final_generation, baseline_generation + 1);
    assert_eq!(acknowledged_generation, baseline_generation);
}

#[tokio::test]
async fn search_index_queue_coalesces_changes_and_tracks_session_moves() {
    let db = test_db().await;

    sqlx::query(
        "INSERT INTO sessions (id, title) VALUES ('session-1', 'One'), ('session-2', 'Two')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query("DELETE FROM search_index_dirty")
        .execute(db.pool())
        .await
        .unwrap();

    sqlx::query(
            "INSERT INTO session_documents (id, session_id, body) VALUES ('document-1', 'session-1', 'one')",
        )
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE session_documents SET body = 'two' WHERE id = 'document-1'")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE session_documents SET session_id = 'session-2' WHERE id = 'document-1'")
        .execute(db.pool())
        .await
        .unwrap();

    sqlx::query(
            "INSERT INTO transcripts (id, session_id, words_json) VALUES ('transcript-1', 'session-1', '[]')",
        )
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE transcripts SET session_id = 'session-2' WHERE id = 'transcript-1'")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM transcripts WHERE id = 'transcript-1'")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM session_documents WHERE id = 'document-1'")
        .execute(db.pool())
        .await
        .unwrap();

    let rows = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT entity_type, entity_id, generation
             FROM search_index_dirty
             ORDER BY entity_type, entity_id",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();

    assert_eq!(
        rows,
        vec![
            ("session".to_string(), "session-1".to_string(), 5),
            ("session".to_string(), "session-2".to_string(), 4),
        ]
    );
}

#[tokio::test]
async fn search_index_queue_tracks_entity_lifecycle_and_starts_unversioned() {
    let db = test_db().await;

    let projection_version: i64 = sqlx::query_scalar(
        "SELECT projection_version FROM search_index_state WHERE id = 'default'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(projection_version, 0);

    sqlx::query("INSERT INTO sessions (id, title) VALUES ('session-1', 'One')")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO humans (id, name) VALUES ('human-1', 'Ada')")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO organizations (id, name) VALUES ('organization-1', 'Acme')")
        .execute(db.pool())
        .await
        .unwrap();

    sqlx::query("UPDATE sessions SET deleted_at = '2026-07-14T00:00:00Z' WHERE id = 'session-1'")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE humans SET memo = 'Updated' WHERE id = 'human-1'")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM organizations WHERE id = 'organization-1'")
        .execute(db.pool())
        .await
        .unwrap();

    let rows = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT entity_type, entity_id, generation
             FROM search_index_dirty
             ORDER BY entity_type, entity_id",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();

    assert_eq!(
        rows,
        vec![
            ("human".to_string(), "human-1".to_string(), 2),
            ("organization".to_string(), "organization-1".to_string(), 2,),
            ("session".to_string(), "session-1".to_string(), 2),
        ]
    );
}

async fn session_search_generation(db: &Db) -> i64 {
    sqlx::query_scalar(
        "SELECT generation FROM search_index_dirty
         WHERE entity_type = 'session' AND entity_id = 'session-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap()
}

/// One speaker-context observation, as the desktop writes it every 5 s while listening.
async fn write_speaker_context_observation(db: &Db, tick: i64) {
    sqlx::query(
        "UPDATE sessions
         SET metadata_json = json_set(metadata_json, '$.speaker_context', json(?)),
             updated_at = ?
         WHERE id = 'session-1'",
    )
    .bind(format!(
        r#"{{"intervals":[{{"start_ms":0,"end_ms":{},"active_call":false}}]}}"#,
        tick * 5_000
    ))
    .bind(format!("2026-10-31T23:13:{:02}.000Z", tick % 60))
    .execute(db.pool())
    .await
    .unwrap();
}

// Pendant une écoute, la capture du contexte des locuteurs réécrit
// `metadata_json` toutes les 5 s. Le document de recherche n'en dépend pas :
// ces écritures ne doivent pas réindexer la note en boucle (issue #271).
#[tokio::test]
async fn session_bookkeeping_updates_do_not_requeue_search_indexing() {
    let db = test_db().await;
    sqlx::query("INSERT INTO sessions (id, title) VALUES ('session-1', 'Réunion')")
        .execute(db.pool())
        .await
        .unwrap();
    let baseline = session_search_generation(&db).await;

    // Huit minutes d'écoute : une observation toutes les 5 s.
    for tick in 0..96 {
        write_speaker_context_observation(&db, tick).await;
    }
    let reindexes_during_capture = session_search_generation(&db).await - baseline;
    assert_eq!(
        reindexes_during_capture, 0,
        "speaker context bookkeeping queued {reindexes_during_capture} reindexes"
    );

    // Every column the search projection reads still requeues the note.
    for statement in [
        "UPDATE sessions SET title = 'Réunion budget' WHERE id = 'session-1'",
        "UPDATE sessions SET event_json = '{\"started_at\":\"2026-10-31T23:13:00Z\"}' WHERE id = 'session-1'",
        "UPDATE sessions SET source_apps_json = '[{\"app\":\"zoom\"}]' WHERE id = 'session-1'",
        "UPDATE sessions SET locked = 1 WHERE id = 'session-1'",
        "UPDATE sessions SET created_at = '2026-10-31T23:12:00.000Z' WHERE id = 'session-1'",
        "UPDATE sessions SET deleted_at = '2026-10-31T23:30:00.000Z' WHERE id = 'session-1'",
    ] {
        let before = session_search_generation(&db).await;
        sqlx::query(statement).execute(db.pool()).await.unwrap();
        assert_eq!(
            session_search_generation(&db).await,
            before + 1,
            "{statement} must requeue the note exactly once"
        );
    }
}

// Mesure le journal WAL écrit par une observation du contexte des locuteurs.
#[tokio::test]
async fn speaker_context_observation_wal_volume_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(syntheo_db_core::DbOpenOptions {
        storage: syntheo_db_core::DbStorage::Local(&dir.path().join("app.db")),
        journal_mode_wal: true,
        foreign_keys: true,
        max_connections: Some(1),
    })
    .await
    .unwrap();
    prepare_schema(&db).await.unwrap();
    sqlx::query("INSERT INTO sessions (id, title) VALUES ('session-1', 'Réunion')")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(db.pool())
        .await
        .unwrap();

    const OBSERVATIONS: i64 = 12;
    for tick in 0..OBSERVATIONS {
        write_speaker_context_observation(&db, tick).await;
    }
    let (_, wal_frames, _): (i64, i64, i64) = sqlx::query_as("PRAGMA wal_checkpoint(PASSIVE)")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let page_size: i64 = sqlx::query_scalar("PRAGMA page_size")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let frames_per_observation = wal_frames as f64 / OBSERVATIONS as f64;
    println!(
        "wal: {frames_per_observation:.1} pages ({:.1} Kio) par observation",
        frames_per_observation * page_size as f64 / 1024.0
    );
    // The session row and its encryption queue entry; the search queue page is
    // no longer rewritten (3 pages, 12 Kio, before issue #271).
    assert!(
        frames_per_observation <= 2.0,
        "each observation wrote {frames_per_observation:.1} WAL pages"
    );
}
