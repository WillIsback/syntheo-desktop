//! Identité Syntheo des configurations Tauri (dev et release).

use serde_json::{Value, json};

fn read(name: &str) -> Value {
    let raw = std::fs::read_to_string(name).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[test]
fn syntheo_configs_have_syntheo_identity() {
    let dev = read("tauri.conf.json");
    assert_eq!(dev["identifier"], "fr.willisback.syntheo.dev");
    assert_eq!(dev["productName"], "Syntheo Dev");
    assert_eq!(dev["mainBinaryName"], "syntheo-dev");
    assert_eq!(
        dev["plugins"]["deep-link"]["desktop"]["schemes"],
        json!(["syntheo-dev"])
    );
    assert_eq!(dev["bundle"]["createUpdaterArtifacts"], false);

    let rel = read("tauri.conf.syntheo.json");
    assert_eq!(rel["identifier"], "fr.willisback.syntheo");
    assert_eq!(
        rel["plugins"]["deep-link"]["desktop"]["schemes"],
        json!(["syntheo"])
    );
    assert!(
        rel["bundle"]["icon"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p.as_str().unwrap().starts_with("icons/syntheo/"))
    );
}

#[test]
fn no_fastrepl_channel_configs_remain() {
    for f in ["stable", "staging", "nightly", "flatpak", "app-store"] {
        assert!(
            !std::path::Path::new(&format!("tauri.conf.{f}.json")).exists(),
            "tauri.conf.{f}.json"
        );
    }
}
