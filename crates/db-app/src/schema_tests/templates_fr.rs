use super::test_db;

#[tokio::test]
async fn syntheo_templates_are_pinned_and_french() {
    let db = test_db().await;

    let syntheo: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT id, title, pinned, pin_order FROM templates
         WHERE id LIKE 'syntheo-%' ORDER BY pin_order",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();

    assert_eq!(
        syntheo
            .iter()
            .map(|(id, ..)| id.as_str())
            .collect::<Vec<_>>(),
        [
            "syntheo-general",
            "syntheo-compliance",
            "syntheo-project",
            "syntheo-standup"
        ]
    );
    assert!(
        syntheo.iter().all(|(_, _, pinned, _)| *pinned == 1),
        "les templates Syntheo doivent être épinglés"
    );

    let board: String =
        sqlx::query_scalar("SELECT title FROM templates WHERE id = 'default-board-meeting'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(board, "Conseil d'administration");

    let english: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM templates
         WHERE title IN ('Board meeting', 'Brainstorming session', 'Sales discovery call')",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(english, 0, "aucun libellé anglais résiduel");
}
