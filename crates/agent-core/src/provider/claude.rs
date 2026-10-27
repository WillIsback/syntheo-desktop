use crate::{
    HealthCheckOptions, InstallCliResponse, ProviderAuthStatus, ProviderHealth,
    ProviderHealthStatus, ProviderKind, UninstallCliResponse,
};

const STOP_EVENT: &str = "Stop";
const COMMAND: &str = "char claude notify";

pub fn health(options: &HealthCheckOptions) -> ProviderHealth {
    let health = syntheo_claude::health_check_with_options(&syntheo_claude::ClaudeOptions {
        claude_path_override: options.claude_path_override.clone(),
        ..Default::default()
    });

    ProviderHealth {
        provider: ProviderKind::Claude,
        binary_path: health.binary_path,
        installed: health.installed,
        integration_installed: integration_installed().unwrap_or(false),
        version: health.version,
        status: health.status.into(),
        auth_status: health.auth_status.into(),
        message: health.message,
    }
}

pub fn install_cli() -> Result<InstallCliResponse, String> {
    let settings_path = syntheo_claude::settings_path();
    let mut settings = syntheo_claude::read_settings(&settings_path)?;

    syntheo_claude::upsert_command_hook(&mut settings, STOP_EVENT, COMMAND)?;
    syntheo_claude::write_settings(&settings_path, &settings)?;

    Ok(InstallCliResponse {
        provider: ProviderKind::Claude,
        target_path: settings_path.clone(),
        message: format!(
            "Installed char as Claude Code hook handler in {}",
            settings_path.display()
        ),
    })
}

pub fn upgrade() {
    upgrade_at(&syntheo_claude::settings_path());
}

fn upgrade_at(settings_path: &std::path::Path) {
    let Ok(mut settings) = syntheo_claude::read_settings(settings_path) else {
        return;
    };
    if !syntheo_claude::has_command_hook(&settings, STOP_EVENT, COMMAND) {
        return;
    }
    let _ = syntheo_claude::remove_command_hook(&mut settings, STOP_EVENT, COMMAND);
    let _ = syntheo_claude::upsert_command_hook(&mut settings, STOP_EVENT, COMMAND);
    let _ = syntheo_claude::write_settings(settings_path, &settings);
}

pub fn uninstall_cli() -> Result<UninstallCliResponse, String> {
    let settings_path = syntheo_claude::settings_path();
    let mut settings = syntheo_claude::read_settings(&settings_path)?;

    syntheo_claude::remove_command_hook(&mut settings, STOP_EVENT, COMMAND)?;
    syntheo_claude::write_settings(&settings_path, &settings)?;

    Ok(UninstallCliResponse {
        provider: ProviderKind::Claude,
        target_path: settings_path.clone(),
        message: format!(
            "Removed char as Claude Code hook handler from {}",
            settings_path.display()
        ),
    })
}

fn integration_installed() -> Result<bool, String> {
    let settings_path = syntheo_claude::settings_path();
    let settings = syntheo_claude::read_settings(&settings_path)?;
    Ok(syntheo_claude::has_command_hook(
        &settings, STOP_EVENT, COMMAND,
    ))
}

impl From<syntheo_claude::HealthStatus> for ProviderHealthStatus {
    fn from(value: syntheo_claude::HealthStatus) -> Self {
        match value {
            syntheo_claude::HealthStatus::Ready => Self::Ready,
            syntheo_claude::HealthStatus::Warning => Self::Warning,
            syntheo_claude::HealthStatus::Error => Self::Error,
        }
    }
}

impl From<syntheo_claude::HealthAuthStatus> for ProviderAuthStatus {
    fn from(value: syntheo_claude::HealthAuthStatus) -> Self {
        match value {
            syntheo_claude::HealthAuthStatus::Authenticated => Self::Authenticated,
            syntheo_claude::HealthAuthStatus::Unauthenticated => Self::Unauthenticated,
            syntheo_claude::HealthAuthStatus::Unknown => Self::Unknown,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrade_is_a_noop_when_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        upgrade_at(&path);
        assert!(!path.exists());
        std::fs::write(&path, "{}").unwrap();

        upgrade_at(&path);

        let settings = syntheo_claude::read_settings(&path).unwrap();
        assert!(!syntheo_claude::has_command_hook(
            &settings, STOP_EVENT, COMMAND
        ));
    }

    #[test]
    fn upgrade_refreshes_existing_hook() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let mut settings = serde_json::json!({});
        syntheo_claude::upsert_command_hook(&mut settings, STOP_EVENT, COMMAND).unwrap();
        syntheo_claude::write_settings(&path, &settings).unwrap();

        upgrade_at(&path);

        let settings = syntheo_claude::read_settings(&path).unwrap();
        assert!(syntheo_claude::has_command_hook(
            &settings, STOP_EVENT, COMMAND
        ));
    }
}
