use super::*;
use serde_json::Value;
use syntheo_db_core::Db;

mod documents;
mod importer;
mod transcripts;

async fn test_db() -> Db {
    let db = Db::connect_memory_plain().await.unwrap();
    syntheo_db_app::prepare_schema(&db).await.unwrap();
    db
}

async fn row_count(db: &Db, query: &'static str) -> i64 {
    sqlx::query_scalar::<_, i64>(query)
        .fetch_one(db.pool())
        .await
        .unwrap()
}
