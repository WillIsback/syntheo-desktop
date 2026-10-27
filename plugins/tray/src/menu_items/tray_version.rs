use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};

use super::MenuItemHandler;

pub struct TrayVersion;

impl TrayVersion {
    fn get_channel(identifier: &str, _app_name: &str) -> &'static str {
        if identifier == syntheo_brand::STABLE_BUNDLE_ID {
            "stable"
        } else {
            "dev"
        }
    }
}

impl MenuItemHandler for TrayVersion {
    const ID: &'static str = "syntheo_tray_version";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let identifier = &app.config().identifier;
        let app_name = &app.package_info().name;
        let app_version = app.package_info().version.to_string();
        let channel = Self::get_channel(identifier, app_name);

        let text = format!("v{} ({})", app_version, channel);
        let item = MenuItem::with_id(app, Self::ID, text, false, None::<&str>)?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(_app: &AppHandle<tauri::Wry>) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_channel_maps_syntheo_identifiers() {
        assert_eq!(
            TrayVersion::get_channel("fr.willisback.syntheo", "Syntheo"),
            "stable"
        );
        assert_eq!(
            TrayVersion::get_channel("fr.willisback.syntheo.dev", "Syntheo Dev"),
            "dev"
        );
        assert_eq!(
            TrayVersion::get_channel("com.syntheo.stable", "Syntheo"),
            "dev"
        );
    }
}
