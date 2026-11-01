use crate::{AppSounds, CompletionSound, SfxPluginExt};

#[tauri::command]
#[specta::specta]
pub async fn play<R: tauri::Runtime>(app: tauri::AppHandle<R>, sfx: AppSounds) {
    app.sfx().play(sfx)
}

#[tauri::command]
#[specta::specta]
pub async fn stop<R: tauri::Runtime>(app: tauri::AppHandle<R>, sfx: AppSounds) {
    app.sfx().stop(sfx)
}

#[tauri::command]
#[specta::specta]
pub async fn set_volume<R: tauri::Runtime>(app: tauri::AppHandle<R>, sfx: AppSounds, volume: f32) {
    app.sfx().set_volume(sfx, volume)
}

#[tauri::command]
#[specta::specta]
pub async fn play_completion_sound(sound: CompletionSound, volume: f32) {
    crate::play_completion_sound(sound, volume)
}
