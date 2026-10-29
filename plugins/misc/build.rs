const COMMANDS: &[&str] = &[
    "get_git_hash",
    "get_device_info",
    "get_process_memory_bytes",
    "opinionated_md_to_html",
    "delete_session_folder",
    "audio_open",
    "audio_exist",
    "audio_delete",
    "audio_path",
    "audio_import",
    "reveal_session_in_finder",
];

fn main() {
    let gitcl = vergen_gix::Gix::all().sha(false).build();
    vergen_gix::Emitter::default()
        .add_instructions(&gitcl)
        .unwrap()
        .emit()
        .unwrap();

    tauri_plugin::Builder::new(COMMANDS).build();
}
