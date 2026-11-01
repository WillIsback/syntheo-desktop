//! Animation de l'icône d'enregistrement sous Linux.
//!
//! À chaque `set_icon(Some(image))`, tray-icon (backend appindicator) réencode
//! l'image en PNG dans `<dossier>/tray-icon-<id>-<n>.png`, où `n` augmente de 1
//! à chaque appel, et supprime le fichier précédent. `set_icon(None)` suit le
//! même chemin sans rien écrire : l'appindicator reçoit le nom du fichier
//! suivant.
//!
//! On donne donc à tray-icon un dossier qui n'appartient qu'à ce processus et
//! où il ne laisse que l'icône affichée. Pour chaque image de l'animation, on
//! crée au nom suivant un lien physique vers le PNG embarqué, écrit une seule
//! fois, puis on appelle `set_icon(None)`. Si tray-icon n'a pas supprimé le
//! fichier attendu, on retire le lien et l'appelant retombe sur
//! `set_icon(Some(image))`, dans le même tour de boucle : rien ne s'affiche
//! entre les deux.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use tauri::{Result, Wry, tray::TrayIcon};

use crate::tray_icon::RECORDING_FRAMES;

const TRAY_ICON_PREFIX: &str = "tray-icon-";
const PNG_SUFFIX: &str = ".png";

struct PreparedFrames {
    /// Dossier donné à tray-icon, propre à ce processus.
    icons_dir: PathBuf,
    /// PNG embarqués, écrits une fois.
    frames: Vec<PathBuf>,
}

static PREPARED_FRAMES: OnceLock<Option<PreparedFrames>> = OnceLock::new();

/// Même dossier que celui de tray-icon : `$XDG_RUNTIME_DIR/tray-icon`, sinon
/// `$TMPDIR/tray-icon`.
fn frames_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .unwrap_or_else(std::env::temp_dir)
        .join("tray-icon")
}

/// Écrit chaque image dans `dir`, sous un nom qui dépend de son contenu, et
/// renvoie les chemins. Un fichier déjà identique n'est pas réécrit.
fn prepare_frames(dir: &Path, frames: &[&[u8]]) -> io::Result<Vec<PathBuf>> {
    fs::create_dir_all(dir)?;
    frames
        .iter()
        .enumerate()
        .map(|(index, bytes)| {
            let name = format!("syntheo-recording-{:016x}-{index}.png", content_hash(bytes));
            let path = dir.join(&name);
            if fs::read(&path).ok().as_deref() != Some(*bytes) {
                // Écriture puis renommage : le panneau ne lit jamais un PNG à moitié écrit.
                let partial = dir.join(format!(".{name}.{}.tmp", std::process::id()));
                fs::write(&partial, bytes)?;
                fs::rename(&partial, &path)?;
            }
            Ok(path)
        })
        .collect()
}

fn content_hash(bytes: &[u8]) -> u64 {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Crée le dossier d'icônes du processus, vidé des fichiers de tray-icon
/// qu'un ancien processus de même PID aurait laissés.
fn prepare_icons_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if parse_icon_name(&entry.file_name().to_string_lossy()).is_some() {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn prepared_frames() -> Option<&'static PreparedFrames> {
    PREPARED_FRAMES
        .get_or_init(|| {
            let base = frames_dir();
            let icons_dir = base.join(format!("syntheo-{}", std::process::id()));
            let prepared = prepare_frames(&base, RECORDING_FRAMES).and_then(|frames| {
                prepare_icons_dir(&icons_dir)?;
                Ok(PreparedFrames { icons_dir, frames })
            });
            prepared
                .inspect_err(|error| {
                    tracing::warn!(%error, "tray: images d'enregistrement non préparées");
                })
                .ok()
        })
        .as_ref()
}

/// Découpe `tray-icon-<id>-<n>.png` en (`tray-icon-<id>`, `n`).
fn parse_icon_name(name: &str) -> Option<(&str, u32)> {
    if !name.starts_with(TRAY_ICON_PREFIX) {
        return None;
    }
    let (prefix, counter) = name.strip_suffix(PNG_SUFFIX)?.rsplit_once('-')?;
    Some((prefix, counter.parse().ok()?))
}

/// Icône affichée par tray-icon dans `dir` et son successeur, si `dir` n'en
/// contient qu'une.
fn current_and_next_icon(dir: &Path) -> io::Result<Option<(PathBuf, PathBuf)>> {
    let mut found = None;
    for entry in fs::read_dir(dir)? {
        let Ok(name) = entry?.file_name().into_string() else {
            continue;
        };
        let Some((prefix, counter)) = parse_icon_name(&name) else {
            continue;
        };
        let Some(next_counter) = counter.checked_add(1) else {
            return Ok(None);
        };
        if found.is_some() {
            return Ok(None);
        }
        found = Some((
            dir.join(&name),
            dir.join(format!("{prefix}-{next_counter}{PNG_SUFFIX}")),
        ));
    }
    Ok(found)
}

/// Fait pointer le prochain fichier d'icône de tray-icon vers `frame`, puis
/// appelle `advance` (`set_icon(None)`). Renvoie `false`, sans rien laisser
/// dans `dir`, si tray-icon n'a pas consommé le fichier attendu.
fn show_prepared_frame(
    dir: &Path,
    frame: &Path,
    advance: impl FnOnce() -> io::Result<()>,
) -> io::Result<bool> {
    let Some((current, next)) = current_and_next_icon(dir)? else {
        return Ok(false);
    };
    let _ = fs::remove_file(&next);
    if fs::hard_link(frame, &next).is_err() {
        fs::copy(frame, &next)?;
    }
    let advanced = advance();
    if advanced.is_ok() && !current.exists() && next.exists() {
        return Ok(true);
    }
    let _ = fs::remove_file(&next);
    advanced.map(|()| false)
}

/// Affiche l'image `frame` sans réencoder de PNG. Renvoie `false` si l'image
/// n'a pas pu être affichée ainsi : l'appelant retombe alors sur `set_icon`,
/// qui écrit lui aussi dans le dossier du processus.
pub fn show_frame(tray: &TrayIcon<Wry>, frame: usize) -> Result<bool> {
    let Some(prepared) = prepared_frames() else {
        return Ok(false);
    };
    let icons_dir = prepared.icons_dir.clone();
    let frame_path = prepared.frames[frame % prepared.frames.len()].clone();
    let shown = tray.with_inner_tray_icon(move |inner| {
        inner.set_temp_dir_path(Some(&icons_dir));
        show_prepared_frame(&icons_dir, &frame_path, || {
            inner.set_icon(None).map_err(io::Error::other)
        })
    })?;
    Ok(shown.unwrap_or_else(|error| {
        tracing::warn!(%error, "tray: image d'enregistrement non affichée");
        false
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("syntheo-tray-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// Ce que fait `set_icon(None)` de tray-icon 0.25 : supprimer le fichier
    /// courant et passer au compteur suivant sans rien écrire.
    fn tray_icon_set_none(current: &Path) -> impl FnOnce() -> io::Result<()> + '_ {
        move || {
            let _ = fs::remove_file(current);
            Ok(())
        }
    }

    #[test]
    fn frames_are_written_once_with_their_original_bytes() {
        let dir = scratch_dir("frames");
        let paths = prepare_frames(&dir, RECORDING_FRAMES).unwrap();

        assert_eq!(paths.len(), RECORDING_FRAMES.len());
        for (path, bytes) in paths.iter().zip(RECORDING_FRAMES) {
            assert_eq!(fs::read(path).unwrap(), *bytes);
        }
        let mut unique = paths.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), paths.len());

        let modified: Vec<_> = paths
            .iter()
            .map(|path| fs::metadata(path).unwrap().modified().unwrap())
            .collect();
        assert_eq!(prepare_frames(&dir, RECORDING_FRAMES).unwrap(), paths);
        for (path, before) in paths.iter().zip(modified) {
            assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), before);
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), paths.len());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_stale_frame_file_is_rewritten() {
        let dir = scratch_dir("stale");
        let paths = prepare_frames(&dir, RECORDING_FRAMES).unwrap();
        fs::write(&paths[0], b"tronque").unwrap();

        prepare_frames(&dir, RECORDING_FRAMES).unwrap();
        assert_eq!(fs::read(&paths[0]).unwrap(), RECORDING_FRAMES[0]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn icon_names_are_parsed_like_tray_icon_writes_them() {
        assert_eq!(
            parse_icon_name("tray-icon-syntheo-tray-12.png"),
            Some(("tray-icon-syntheo-tray", 12))
        );
        assert_eq!(parse_icon_name("tray-icon-syntheo-tray-x.png"), None);
        assert_eq!(parse_icon_name("syntheo-recording-00-0.png"), None);
        assert_eq!(parse_icon_name("tray-icon-syntheo-tray-3.svg"), None);
    }

    #[test]
    fn frames_follow_tray_icon_counter_without_copying() {
        let base = scratch_dir("follow");
        let frames = prepare_frames(&base, RECORDING_FRAMES).unwrap();
        let icons = base.join("icons");
        prepare_icons_dir(&icons).unwrap();

        // Sans icône de tray-icon dans le dossier, l'appelant passe par `set_icon`.
        assert!(!show_prepared_frame(&icons, &frames[0], || unreachable!()).unwrap());

        fs::write(icons.join("tray-icon-syntheo-tray-4.png"), b"encode").unwrap();
        for (step, frame) in frames.iter().cycle().take(7).enumerate() {
            let current = icons.join(format!("tray-icon-syntheo-tray-{}.png", 4 + step));
            let next = icons.join(format!("tray-icon-syntheo-tray-{}.png", 5 + step));
            assert!(show_prepared_frame(&icons, frame, tray_icon_set_none(&current)).unwrap());
            assert_eq!(fs::read(&next).unwrap(), fs::read(frame).unwrap());
            assert_eq!(fs::read_dir(&icons).unwrap().count(), 1);
        }

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn an_unexpected_tray_icon_behaviour_falls_back_cleanly() {
        let base = scratch_dir("fallback");
        let frames = prepare_frames(&base, RECORDING_FRAMES).unwrap();
        let icons = base.join("icons");
        prepare_icons_dir(&icons).unwrap();
        let current = icons.join("tray-icon-syntheo-tray-0.png");
        fs::write(&current, b"encode").unwrap();

        // tray-icon ne supprime pas le fichier attendu : on ne sait plus quel
        // chemin l'appindicator a reçu.
        assert!(!show_prepared_frame(&icons, &frames[1], || Ok(())).unwrap());
        assert!(
            show_prepared_frame(&icons, &frames[1], || Err(io::Error::other("échec"))).is_err()
        );
        let left: Vec<_> = fs::read_dir(&icons)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(left, vec![current.clone()]);

        // Deux icônes de tray-icon : on ne devine pas laquelle est affichée.
        fs::write(icons.join("tray-icon-syntheo-tray-9.png"), b"autre").unwrap();
        assert!(!show_prepared_frame(&icons, &frames[1], || unreachable!()).unwrap());

        // Un fichier laissé par un ancien processus de même PID est retiré.
        prepare_icons_dir(&icons).unwrap();
        assert_eq!(fs::read_dir(&icons).unwrap().count(), 0);

        fs::remove_dir_all(&base).unwrap();
    }
}
