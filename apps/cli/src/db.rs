use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::{Args, Error, Result};

pub async fn open(args: &Args) -> Result<syntheo_db_core::Db> {
    let path = resolve_path(args)?;
    if !path.is_file() {
        return Err(Error::DatabaseNotFound(path));
    }

    syntheo_db_core::Db::connect_local_read_only(&path)
        .await
        .map_err(|error| Error::operation("open database", error.to_string()))
}

pub async fn open_write(args: &Args) -> Result<syntheo_db_core::Db> {
    let path = resolve_path(args)?;
    if !path.is_file() {
        return Err(Error::DatabaseNotFound(path));
    }

    syntheo_db_core::Db::connect_local_read_write(&path)
        .await
        .map_err(|error| Error::operation("open database for writes", error.to_string()))
}

pub(crate) fn resolve_path(args: &Args) -> Result<PathBuf> {
    if let Some(path) = &args.db_path {
        return Ok(path.clone());
    }
    if let Some(base) = &args.base {
        return Ok(base.join("app.db"));
    }

    let data_dir = dirs::data_dir().ok_or_else(|| {
        Error::operation("resolve database path", "data directory is unavailable")
    })?;
    Ok(resolve_default_path(&data_dir))
}

fn resolve_default_path(data_dir: &Path) -> PathBuf {
    let command_name = std::env::args_os()
        .next()
        .and_then(|path| Path::new(&path).file_name().map(|name| name.to_owned()));
    resolve_default_path_for_command(data_dir, command_name.as_deref())
}

fn resolve_default_path_for_command(data_dir: &Path, command_name: Option<&OsStr>) -> PathBuf {
    let command_name = command_name
        .and_then(OsStr::to_str)
        .and_then(|name| Path::new(name).file_stem())
        .and_then(OsStr::to_str);
    // Même résolution que l'app Syntheo : jamais la base d'une installation Syntheo.
    if command_name == Some("syntheo-dev") {
        return data_dir.join("fr.willisback.syntheo.dev").join("app.db");
    }

    let current = data_dir.join("syntheo").join("app.db");
    if current.is_file() {
        return current;
    }

    let identifier = data_dir.join("fr.willisback.syntheo").join("app.db");
    if identifier.is_file() {
        return identifier;
    }

    current
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_path_is_syntheo_and_ignores_other_databases() {
        let dir = tempfile::tempdir().unwrap();
        for other in ["unrelated", "com.example.app"] {
            std::fs::create_dir_all(dir.path().join(other)).unwrap();
            std::fs::write(dir.path().join(other).join("app.db"), b"x").unwrap();
        }
        std::fs::create_dir_all(dir.path().join("syntheo")).unwrap();
        std::fs::write(dir.path().join("syntheo").join("app.db"), b"x").unwrap();
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("syntheo"))),
            dir.path().join("syntheo/app.db")
        );
    }

    #[test]
    fn default_path_falls_back_to_the_stable_identifier_folder() {
        let dir = tempfile::tempdir().unwrap();
        let identifier = dir.path().join("fr.willisback.syntheo/app.db");
        std::fs::create_dir_all(identifier.parent().unwrap()).unwrap();
        std::fs::write(&identifier, b"x").unwrap();
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("syntheo"))),
            identifier
        );
    }

    #[test]
    fn dev_command_targets_the_dev_database() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("syntheo-dev"))),
            dir.path().join("fr.willisback.syntheo.dev/app.db")
        );
    }
}
