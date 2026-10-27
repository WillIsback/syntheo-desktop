use crate::{
    HealthCheckOptions, InstallCliResponse, ProviderAuthStatus, ProviderHealth,
    ProviderHealthStatus, ProviderKind, UninstallCliResponse,
};

pub fn health(options: &HealthCheckOptions) -> ProviderHealth {
    let health = syntheo_codex::health_check_with_options(&syntheo_codex::CodexOptions {
        codex_path_override: options.codex_path_override.clone(),
        ..Default::default()
    });

    ProviderHealth {
        provider: ProviderKind::Codex,
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
    let config_path = syntheo_codex::config_path();
    let command = syntheo_codex::notify_command();

    let mut table = syntheo_codex::read_config(&config_path)?;

    if table.contains_key("notify") && !syntheo_codex::has_notify(&table, &command) {
        return Err(format!(
            "refusing to replace existing notify handler in {}",
            config_path.display()
        ));
    }

    syntheo_codex::set_notify(&mut table, command);
    syntheo_codex::write_config(&config_path, &table)?;

    Ok(InstallCliResponse {
        provider: ProviderKind::Codex,
        target_path: config_path.clone(),
        message: format!(
            "Installed char as Codex notify handler in {}",
            config_path.display()
        ),
    })
}

pub fn upgrade() {
    upgrade_at(&syntheo_codex::config_path());
}

fn upgrade_at(config_path: &std::path::Path) {
    let command = syntheo_codex::notify_command();
    let Ok(mut table) = syntheo_codex::read_config(config_path) else {
        return;
    };
    if !syntheo_codex::has_notify(&table, &command) {
        return;
    }
    syntheo_codex::set_notify(&mut table, command);
    let _ = syntheo_codex::write_config(config_path, &table);
}

pub fn uninstall_cli() -> Result<UninstallCliResponse, String> {
    let config_path = syntheo_codex::config_path();
    let command = syntheo_codex::notify_command();
    let mut table = syntheo_codex::read_config(&config_path)?;

    if table.contains_key("notify") && !syntheo_codex::has_notify(&table, &command) {
        return Err(format!(
            "refusing to remove existing notify handler in {}",
            config_path.display()
        ));
    }

    syntheo_codex::remove_notify(&mut table);
    syntheo_codex::write_config(&config_path, &table)?;

    Ok(UninstallCliResponse {
        provider: ProviderKind::Codex,
        target_path: config_path.clone(),
        message: format!(
            "Removed char as Codex notify handler from {}",
            config_path.display()
        ),
    })
}

fn integration_installed() -> Result<bool, String> {
    let config_path = syntheo_codex::config_path();
    let table = syntheo_codex::read_config(&config_path)?;
    Ok(syntheo_codex::has_notify(
        &table,
        &syntheo_codex::notify_command(),
    ))
}

impl From<syntheo_codex::HealthStatus> for ProviderHealthStatus {
    fn from(value: syntheo_codex::HealthStatus) -> Self {
        match value {
            syntheo_codex::HealthStatus::Ready => Self::Ready,
            syntheo_codex::HealthStatus::Warning => Self::Warning,
            syntheo_codex::HealthStatus::Error => Self::Error,
        }
    }
}

impl From<syntheo_codex::HealthAuthStatus> for ProviderAuthStatus {
    fn from(value: syntheo_codex::HealthAuthStatus) -> Self {
        match value {
            syntheo_codex::HealthAuthStatus::Authenticated => Self::Authenticated,
            syntheo_codex::HealthAuthStatus::Unauthenticated => Self::Unauthenticated,
            syntheo_codex::HealthAuthStatus::Unknown => Self::Unknown,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrade_is_a_noop_when_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        upgrade_at(&path);
        assert!(!path.exists());
        std::fs::write(&path, "").unwrap();

        upgrade_at(&path);

        let table = syntheo_codex::read_config(&path).unwrap();
        assert!(!syntheo_codex::has_notify(
            &table,
            &syntheo_codex::notify_command()
        ));
    }

    #[test]
    fn upgrade_refreshes_existing_hook() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let mut table = toml::Table::new();
        let command = syntheo_codex::notify_command();
        syntheo_codex::set_notify(&mut table, command.clone());
        syntheo_codex::write_config(&path, &table).unwrap();

        upgrade_at(&path);

        let table = syntheo_codex::read_config(&path).unwrap();
        assert!(syntheo_codex::has_notify(&table, &command));
    }
}
