const COMMANDS: &[&str] = &["play", "stop", "set_volume", "play_completion_sound"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
