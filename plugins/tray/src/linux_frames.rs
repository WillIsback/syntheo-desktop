//! Animation de l'icône d'enregistrement sous Linux.
//!
//! À chaque `set_icon`, tray-icon (backend appindicator) réencode l'image en
//! PNG dans un nouveau fichier temporaire, puis donne son chemin à
//! l'appindicator. Pour l'animation, on écrit une seule fois les PNG embarqués
//! dans le même dossier et on ne change plus que le chemin d'icône.

use std::{
    ffi::{CStr, CString},
    fs, io,
    os::unix::ffi::OsStringExt,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use tauri::{Result, Wry, tray::TrayIcon};

use crate::tray_icon::RECORDING_FRAMES;

const ICON_DESCRIPTION: &CStr = c"tray icon";

static PREPARED_FRAMES: OnceLock<Option<Vec<CString>>> = OnceLock::new();

// `libappindicator::AppIndicator` n'a qu'un champ, le pointeur GObject : à
// taille égale, ce champ est forcément à l'offset 0.
const _: () = assert!(
    std::mem::size_of::<libappindicator::AppIndicator>()
        == std::mem::size_of::<*mut libappindicator::_AppIndicator>()
);

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

fn prepared_frames() -> Option<&'static [CString]> {
    PREPARED_FRAMES
        .get_or_init(|| match prepare_frames(&frames_dir(), RECORDING_FRAMES) {
            Ok(paths) => paths
                .into_iter()
                .map(|path| CString::new(path.into_os_string().into_vec()).ok())
                .collect(),
            Err(error) => {
                tracing::warn!(%error, "tray: images d'enregistrement non préparées");
                None
            }
        })
        .as_deref()
}

/// Affiche l'image `frame` sans passer par `TrayIcon::set_icon`. Renvoie
/// `false` si les fichiers n'ont pas pu être préparés : l'appelant retombe
/// alors sur `set_icon`.
pub fn show_frame(tray: &TrayIcon<Wry>, frame: usize) -> Result<bool> {
    let Some(paths) = prepared_frames() else {
        return Ok(false);
    };
    let path = paths[frame % paths.len()].clone();
    tray.with_inner_tray_icon(move |inner| set_indicator_icon(inner, &path))?;
    Ok(true)
}

fn set_indicator_icon(tray: &tray_icon::TrayIcon, icon_path: &CStr) {
    // SAFETY: appelé sur le thread principal depuis `with_inner_tray_icon`,
    // pendant que `tray` est vivant et sans autre emprunt de son état interne.
    // Le type annoté ne compile plus si tray-icon change de version de
    // libappindicator.
    let indicator: *const libappindicator::AppIndicator = unsafe { tray.app_indicator() };
    // SAFETY: voir l'assertion de taille plus haut. On lit le pointeur sans
    // créer de référence mutable.
    let raw = unsafe {
        indicator
            .cast::<*mut libappindicator::_AppIndicator>()
            .read()
    };
    // SAFETY: `raw` est l'indicateur GObject possédé par tray-icon ; les deux
    // chaînes sont terminées par NUL et vivent pendant l'appel. C'est l'appel
    // que fait tray-icon dans son propre `set_icon`.
    unsafe {
        libappindicator::app_indicator_set_icon_full(
            raw,
            icon_path.as_ptr(),
            ICON_DESCRIPTION.as_ptr(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("syntheo-tray-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
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
}
