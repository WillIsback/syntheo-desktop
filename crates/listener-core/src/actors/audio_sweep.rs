//! Startup sweep for audio left behind by older versions of the app.
//!
//! Syntheo Desktop no longer writes capture audio to disk (the recorder actor
//! was removed), but an interrupted session from a previous version could still
//! hold `audio-recovery/` chunks or an `audio.mp3`. This module keeps the
//! startup safety net that purges that legacy audio, plus the helpers the
//! desktop app needs to list and acknowledge recovered chunks.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use syntheo_audio_utils::Source;

const RECOVERY_DIR: &str = "audio-recovery";
pub const DELETE_ON_STOP: &str = ".delete-audio-on-stop";

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RecoveryAudioChunk {
    pub id: String,
    pub path: String,
    pub capture_started_at: u64,
    pub start_ms: u64,
    pub audio_start_ms: u64,
    pub end_ms: u64,
}

/// Finds a session directory beneath the vault, following nested folders.
pub fn find_session_dir(sessions_base: &Path, session_id: &str) -> PathBuf {
    if let Some(found) = find_session_dir_recursive(sessions_base, session_id) {
        return found;
    }
    sessions_base.join(session_id)
}

/// The primary audio artifact a legacy session may still hold, if any.
pub fn resolve_final_audio_path(sessions_base: &Path, session_id: &str) -> Option<PathBuf> {
    let session_dir = find_session_dir(sessions_base, session_id);
    for name in ["audio.mp3", "audio.wav", "audio.ogg"] {
        let path = session_dir.join(name);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn find_session_dir_recursive(dir: &Path, session_id: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = path.file_name()?.to_str()?;

        if name == session_id {
            return Some(path);
        }

        if uuid::Uuid::try_parse(name).is_err()
            && let Some(found) = find_session_dir_recursive(&path, session_id)
        {
            return Some(found);
        }
    }

    None
}

pub fn list_recovery_chunks(session_dir: &Path) -> std::io::Result<Vec<RecoveryAudioChunk>> {
    let dir = session_dir.join(RECOVERY_DIR);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut chunks = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        let Some(stem) = id.strip_suffix(".mp3") else {
            continue;
        };
        let parts: Vec<_> = stem.split('-').collect();
        if parts.len() != 4 {
            continue;
        }
        let (Ok(capture_started_at), Ok(start_ms), Ok(end_ms), Ok(audio_start_ms)) = (
            parts[0].parse::<u64>(),
            parts[1].parse::<u64>(),
            parts[2].parse::<u64>(),
            parts[3].parse::<u64>(),
        ) else {
            continue;
        };
        chunks.push(RecoveryAudioChunk {
            id,
            path: entry.path().to_string_lossy().into_owned(),
            capture_started_at,
            start_ms,
            end_ms,
            audio_start_ms,
        });
        // A caller fetches only a bounded page of metadata, never the audio.
        chunks.sort_unstable_by_key(|chunk| (chunk.capture_started_at, chunk.start_ms));
        chunks.truncate(128);
    }
    Ok(chunks)
}

pub fn acknowledge_recovery_chunk(session_dir: &Path, id: &str) -> std::io::Result<()> {
    if !id.ends_with(".mp3")
        || !id
            .bytes()
            .all(|c| c.is_ascii_digit() || matches!(c, b'-' | b'.' | b'm' | b'p'))
    {
        return Err(std::io::Error::other("Invalid recovery chunk"));
    }
    match std::fs::remove_file(session_dir.join(RECOVERY_DIR).join(id)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

pub fn delete_capture_audio(session_dir: &Path) -> std::io::Result<()> {
    if !session_dir.try_exists()? {
        return Ok(());
    }
    for entry in std::fs::read_dir(session_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == RECOVERY_DIR {
            std::fs::remove_dir_all(entry.path())?;
        } else if (matches!(name.as_ref(), "audio.mp3.tmp" | "audio.wav.tmp")
            || ((name.starts_with("audio.") || name.starts_with("audio_"))
                && matches!(
                    entry.path().extension().and_then(|ext| ext.to_str()),
                    Some("wav" | "mp3" | "ogg" | "opus" | "m4a" | "flac")
                )))
            && entry.file_type()?.is_file()
        {
            std::fs::remove_file(entry.path())?;
        }
    }
    match std::fs::remove_file(session_dir.join(DELETE_ON_STOP)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

/// Deletes leftover audio only after every recovery chunk was acknowledged.
/// Returns `false` while chunks still wait for transcription.
pub fn delete_transcribed_capture_audio(session_dir: &Path) -> std::io::Result<bool> {
    recover_partial_chunks(session_dir)?;
    if has_pending_recovery_audio(session_dir)? {
        return Ok(false);
    }
    delete_capture_audio(session_dir)?;
    Ok(true)
}

/// Published chunks or unfinished audio that could not be decoded yet.
fn has_pending_recovery_audio(session_dir: &Path) -> std::io::Result<bool> {
    if !list_recovery_chunks(session_dir)?.is_empty() {
        return Ok(true);
    }
    let entries = match std::fs::read_dir(session_dir.join(RECOVERY_DIR)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && is_recovery_partial_name(&entry.file_name().to_string_lossy())
            && entry.metadata()?.len() > 0
            && partial_is_unreadable(&entry.path())
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn is_recovery_partial_name(name: &str) -> bool {
    name.strip_suffix(".part").is_some_and(|stem| {
        let parts: Vec<_> = stem.split('-').collect();
        parts.len() == 3 && parts.iter().all(|part| part.parse::<u64>().is_ok())
    })
}

fn partial_is_unreadable(path: &Path) -> bool {
    syntheo_audio_utils::source_from_path(path).is_err()
}

// Call only during application startup. Active `.part` files must stay
// invisible until their writer closes them.
fn recover_partial_chunks(session_dir: &Path) -> std::io::Result<()> {
    let dir = session_dir.join(RECOVERY_DIR);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(stem) = name.strip_suffix(".part") else {
            continue;
        };
        let parts: Vec<_> = stem.split('-').collect();
        let [capture, start, audio_start] = parts.as_slice() else {
            continue;
        };
        let (Ok(capture), Ok(start), Ok(audio_start)) = (
            capture.parse::<u64>(),
            start.parse::<u64>(),
            audio_start.parse::<u64>(),
        ) else {
            continue;
        };
        let source = match syntheo_audio_utils::source_from_path(entry.path()) {
            Ok(source) => source,
            Err(error) => {
                tracing::warn!(?error, path = ?entry.path(), "partial_audio_unreadable");
                continue;
            }
        };
        let rate = u32::from(source.sample_rate()) as u64;
        let channels = u16::from(source.channels()) as u64;
        // Decode a stream to measure its playable tail without loading it into RAM.
        let end = audio_start.saturating_add(source.count() as u64 * 1000 / rate / channels);
        if end <= start {
            continue;
        }
        std::fs::rename(
            entry.path(),
            dir.join(format!("{capture}-{start}-{end}-{audio_start}.mp3")),
        )?;
    }
    Ok(())
}

pub fn recover_interrupted_captures(sessions_dir: &Path) -> std::io::Result<()> {
    recover_interrupted_captures_except(sessions_dir, &HashSet::new(), &mut |_, _, _| {})
        .map(|_| ())
}

pub(crate) fn recover_interrupted_captures_except(
    sessions_dir: &Path,
    active_sessions: &HashSet<String>,
    on_cleanup: &mut impl FnMut(&str, bool, &std::io::Result<()>),
) -> std::io::Result<bool> {
    if !sessions_dir.try_exists()? {
        return Ok(false);
    }
    let mut first_error = None;
    let mut deferred = false;
    for entry in std::fs::read_dir(sessions_dir)? {
        let result = (|| {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                return Ok(());
            }
            let dir = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if active_sessions.contains(&name) {
                deferred |= dir.join(DELETE_ON_STOP).try_exists()?;
                return Ok(());
            }
            if dir.join(DELETE_ON_STOP).try_exists()? {
                let result = delete_transcribed_capture_audio(&dir);
                let deleting = !matches!(result, Ok(false));
                let result = result.map(|_| ());
                on_cleanup(&name, deleting, &result);
                result
            } else if uuid::Uuid::parse_str(&name).is_ok() {
                let result = recover_partial_chunks(&dir);
                on_cleanup(&name, false, &result);
                result
            } else {
                deferred |= recover_interrupted_captures_except(&dir, active_sessions, on_cleanup)?;
                Ok(())
            }
        })();
        if let Err(error) = result {
            tracing::warn!(?error, "interrupted_capture_cleanup_failed");
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(deferred), Err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_chunk(session_dir: &Path, id: &str, bytes: &[u8]) {
        let dir = session_dir.join(RECOVERY_DIR);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(id), bytes).unwrap();
    }

    #[test]
    fn list_recovery_chunks_parses_and_sorts_ids() {
        let temp = tempfile::tempdir().unwrap();
        write_chunk(temp.path(), "200-60000-120000-58000.mp3", b"a");
        write_chunk(temp.path(), "100-0-60000-0.mp3", b"b");
        write_chunk(temp.path(), "ignored.part", b"c");

        let chunks = list_recovery_chunks(temp.path()).unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].capture_started_at, 100);
        assert_eq!(
            (
                chunks[1].start_ms,
                chunks[1].end_ms,
                chunks[1].audio_start_ms
            ),
            (60_000, 120_000, 58_000)
        );
    }

    #[test]
    fn acknowledge_and_delete_remove_leftover_audio() {
        let temp = tempfile::tempdir().unwrap();
        write_chunk(temp.path(), "100-0-60000-0.mp3", b"a");
        let chunks = list_recovery_chunks(temp.path()).unwrap();
        acknowledge_recovery_chunk(temp.path(), &chunks[0].id).unwrap();
        assert!(list_recovery_chunks(temp.path()).unwrap().is_empty());

        std::fs::write(temp.path().join("audio.mp3"), b"old").unwrap();
        std::fs::write(temp.path().join("note.md"), b"keep").unwrap();
        delete_capture_audio(temp.path()).unwrap();
        assert!(!temp.path().join("audio.mp3").exists());
        assert!(!temp.path().join(RECOVERY_DIR).exists());
        assert!(temp.path().join("note.md").exists());
    }

    #[test]
    fn delete_transcribed_capture_audio_waits_for_unreadable_partials() {
        let temp = tempfile::tempdir().unwrap();
        write_chunk(temp.path(), "100-0-60000-0.mp3", b"a");
        assert!(!delete_transcribed_capture_audio(temp.path()).unwrap());
        acknowledge_recovery_chunk(temp.path(), "100-0-60000-0.mp3").unwrap();
        // An unreadable, non-empty `.part` keeps the session pending.
        write_chunk(temp.path(), "100-60000-60000.part", b"unpublished");
        assert!(!delete_transcribed_capture_audio(temp.path()).unwrap());
        std::fs::write(
            temp.path().join(RECOVERY_DIR).join("100-60000-60000.part"),
            b"",
        )
        .unwrap();
        assert!(delete_transcribed_capture_audio(temp.path()).unwrap());
        assert!(!temp.path().join(RECOVERY_DIR).exists());
    }

    #[test]
    fn partial_recovery_failure_reports_its_session() {
        let root = tempfile::tempdir().unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let dir = root.path().join(&session_id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(RECOVERY_DIR), b"not a directory").unwrap();
        let mut failures = Vec::new();
        assert!(
            recover_interrupted_captures_except(
                root.path(),
                &HashSet::new(),
                &mut |id, deleting, result| {
                    assert!(!deleting);
                    if result.is_err() {
                        failures.push(id.to_string());
                    }
                },
            )
            .is_err()
        );
        assert_eq!(failures, vec![session_id]);
    }

    #[test]
    fn cleanup_continues_after_a_session_cannot_be_deleted() {
        let root = tempfile::tempdir().unwrap();
        let broken = root.path().join(uuid::Uuid::new_v4().to_string());
        let zero = root.path().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(broken.join(DELETE_ON_STOP)).unwrap();
        std::fs::create_dir_all(&zero).unwrap();
        std::fs::write(zero.join(DELETE_ON_STOP), b"").unwrap();
        std::fs::write(zero.join("audio.mp3"), b"private").unwrap();
        assert!(recover_interrupted_captures(root.path()).is_err());
        assert!(!zero.join("audio.mp3").exists());
        assert!(broken.join(DELETE_ON_STOP).exists());
    }

    #[test]
    fn startup_removes_only_interrupted_zero_retention_recordings() {
        let dir = tempfile::tempdir().unwrap();
        let zero = dir.path().join(uuid::Uuid::new_v4().to_string());
        let retained = dir.path().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(zero.join(RECOVERY_DIR)).unwrap();
        std::fs::create_dir_all(&retained).unwrap();
        std::fs::write(zero.join(DELETE_ON_STOP), b"").unwrap();
        std::fs::write(
            zero.join(RECOVERY_DIR).join("unfinished.part"),
            b"private audio",
        )
        .unwrap();
        std::fs::write(retained.join("audio.mp3"), b"keep").unwrap();
        recover_interrupted_captures(dir.path()).unwrap();
        assert!(!zero.join(RECOVERY_DIR).exists());
        assert_eq!(std::fs::read(retained.join("audio.mp3")).unwrap(), b"keep");
    }

    #[test]
    fn find_session_dir_walks_nested_folders() {
        let root = tempfile::tempdir().unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let nested = root.path().join("projects").join(&session_id);
        std::fs::create_dir_all(&nested).unwrap();
        assert_eq!(find_session_dir(root.path(), &session_id), nested);
        std::fs::write(nested.join("audio.mp3"), b"x").unwrap();
        assert_eq!(
            resolve_final_audio_path(root.path(), &session_id),
            Some(nested.join("audio.mp3"))
        );
    }
}
