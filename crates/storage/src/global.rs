use std::path::{Path, PathBuf};

pub const VAULT_CONFIG_FILENAME: &str = "global.json";

pub fn compute_vault_config_path(base: &Path) -> PathBuf {
    base.join(VAULT_CONFIG_FILENAME)
}

pub fn compute_default_base(bundle_id: &str) -> Option<PathBuf> {
    let data_dir = dirs::data_dir()?;
    let app_folder = resolve_app_folder(&data_dir, bundle_id, cfg!(debug_assertions));
    Some(data_dir.join(app_folder))
}

// This base holds settings, the store, and the vault config. Debug builds keep
// their bundle id folder; release always uses Syntheo's own folder and never
// reads an Anarlog/Hyprnote installation.
fn resolve_app_folder<'a>(_data_dir: &Path, bundle_id: &'a str, is_debug: bool) -> &'a str {
    if is_debug {
        bundle_id
    } else {
        anlg_brand::APP_DATA_FOLDER
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_app_folder_uses_syntheo_for_release() {
        let temp = tempdir().unwrap();
        assert_eq!(
            resolve_app_folder(temp.path(), anlg_brand::STABLE_BUNDLE_ID, false),
            "syntheo"
        );
    }

    #[test]
    fn resolve_app_folder_ignores_existing_anarlog_data() {
        let temp = tempdir().unwrap();
        for legacy in ["anarlog", "hyprnote"] {
            std::fs::create_dir_all(temp.path().join(legacy)).unwrap();
            std::fs::write(temp.path().join(legacy).join("app.db"), b"x").unwrap();
        }
        assert_eq!(
            resolve_app_folder(temp.path(), anlg_brand::STABLE_BUNDLE_ID, false),
            "syntheo"
        );
    }

    #[test]
    fn resolve_app_folder_uses_bundle_id_in_debug() {
        let temp = tempdir().unwrap();
        assert_eq!(
            resolve_app_folder(temp.path(), anlg_brand::DEV_BUNDLE_ID, true),
            anlg_brand::DEV_BUNDLE_ID
        );
    }
}
