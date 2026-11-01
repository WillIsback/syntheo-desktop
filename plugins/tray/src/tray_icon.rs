use std::sync::OnceLock;

use tauri::{Result, Wry, image::Image, tray::TrayIcon};

pub enum TrayIconState {
    Default,
    Degraded,
}

pub const RECORDING_FRAMES: &[&[u8]] = &[
    include_bytes!("../icons/tray_recording_0.png"),
    include_bytes!("../icons/tray_recording_1.png"),
    include_bytes!("../icons/tray_recording_2.png"),
];

static DECODED_RECORDING_FRAMES: OnceLock<Vec<Image<'static>>> = OnceLock::new();

impl TrayIconState {
    pub fn to_image(&self) -> Result<Image<'static>> {
        match self {
            TrayIconState::Default => {
                Image::from_bytes(include_bytes!("../icons/tray_default.png"))
            }
            TrayIconState::Degraded => {
                Image::from_bytes(include_bytes!("../icons/tray_degraded.png"))
            }
        }
    }
}

/// Image de l'animation d'enregistrement. Les PNG ne sont décodés qu'une fois
/// par processus ; l'image renvoyée emprunte les pixels du cache.
pub fn recording_frame(frame: usize) -> Result<Image<'static>> {
    let frames = match DECODED_RECORDING_FRAMES.get() {
        Some(frames) => frames,
        None => {
            let decoded = RECORDING_FRAMES
                .iter()
                .map(|bytes| Image::from_bytes(bytes))
                .collect::<Result<Vec<_>>>()?;
            DECODED_RECORDING_FRAMES.get_or_init(|| decoded)
        }
    };
    let image = &frames[frame % frames.len()];
    Ok(Image::new(image.rgba(), image.width(), image.height()))
}

/// Affiche une image de l'animation d'enregistrement. À appeler sur le thread
/// principal.
pub fn show_recording_frame(tray: &TrayIcon<Wry>, frame: usize) -> Result<()> {
    #[cfg(target_os = "linux")]
    if crate::linux_frames::show_frame(tray, frame)? {
        return Ok(());
    }
    tray.set_icon(Some(recording_frame(frame)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_frames_are_decoded_once() {
        for frame in 0..RECORDING_FRAMES.len() {
            let first = recording_frame(frame).unwrap();
            let second = recording_frame(frame).unwrap();
            assert_eq!(first.rgba().as_ptr(), second.rgba().as_ptr());
            assert_eq!(
                first.rgba().len(),
                (first.width() * first.height() * 4) as usize
            );
        }
        let wrapped = recording_frame(RECORDING_FRAMES.len()).unwrap();
        assert_eq!(
            wrapped.rgba().as_ptr(),
            recording_frame(0).unwrap().rgba().as_ptr()
        );
    }
}
