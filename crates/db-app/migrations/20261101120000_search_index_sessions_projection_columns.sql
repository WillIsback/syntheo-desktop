-- Only the columns the session search document reads requeue the note. Every
-- other session write (speaker context in metadata_json, updated_at, deletion
-- bookkeeping) used to reindex it, every 5 s while listening (issue #271).
-- Older builds keep their broader trigger: they reindex more, never less.

DROP TRIGGER search_index_sessions_update;
CREATE TRIGGER IF NOT EXISTS search_index_sessions_update
AFTER UPDATE ON sessions
WHEN NEW.deleted_at IS NOT OLD.deleted_at
  OR NEW.title IS NOT OLD.title
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.event_json IS NOT OLD.event_json
  OR NEW.source_apps_json IS NOT OLD.source_apps_json
  OR NEW.locked IS NOT OLD.locked
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.id IS NOT OLD.id
BEGIN
  INSERT INTO search_index_dirty (entity_type, entity_id)
  VALUES ('session', OLD.id)
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    generation = search_index_dirty.generation + 1,
    queued_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

  INSERT INTO search_index_dirty (entity_type, entity_id)
  SELECT 'session', NEW.id
  WHERE NEW.id <> OLD.id
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    generation = search_index_dirty.generation + 1,
    queued_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
