//! Son de fin de traitement, joué depuis Rust.
//!
//! Les sons viennent de `cuelume` 0.2.8 (MIT, voir `sounds/completion/LICENSE`),
//! rendus hors ligne au volume 1 : le volume est appliqué ici, à la lecture.
//! Les jouer depuis Rust évite l'audio Web de WebKitGTK, muet dans l'AppImage
//! faute de plugins GStreamer (#317).

/// Son de fin choisi dans les réglages. Les noms sont ceux qui sont enregistrés
/// dans `notification_completion_sound_name`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CompletionSound {
    Ready,
    Success,
    Chime,
    Sparkle,
    Bloom,
}

/// Fichier réellement joué : `cuelume` 0.2.8 avait fait de `chime` et `sparkle`
/// des alias de `success`, et de `bloom` un alias de `open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompletionCue {
    Ready,
    Success,
    Open,
}

impl CompletionSound {
    pub(crate) fn cue(self) -> CompletionCue {
        match self {
            CompletionSound::Ready => CompletionCue::Ready,
            CompletionSound::Success | CompletionSound::Chime | CompletionSound::Sparkle => {
                CompletionCue::Success
            }
            CompletionSound::Bloom => CompletionCue::Open,
        }
    }
}

impl CompletionCue {
    pub(crate) fn bytes(self) -> &'static [u8] {
        match self {
            CompletionCue::Ready => include_bytes!("../sounds/completion/ready.flac"),
            CompletionCue::Success => include_bytes!("../sounds/completion/success.flac"),
            CompletionCue::Open => include_bytes!("../sounds/completion/open.flac"),
        }
    }
}

fn clamp_volume(volume: f32) -> f32 {
    if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        1.0
    }
}

/// Joue le son dans un thread dédié, sans bloquer l'appelant. Un échec (pas de
/// sortie audio, son illisible) est seulement journalisé en debug.
pub fn play_completion_sound(sound: CompletionSound, volume: f32) {
    let bytes = sound.cue().bytes();
    let volume = clamp_volume(volume);
    let spawned = std::thread::Builder::new()
        .name("sfx-completion".into())
        .spawn(move || {
            if let Err(error) = play_blocking(bytes, volume) {
                tracing::debug!(?sound, %error, "completion_sound_playback_failed");
            }
        });
    if let Err(error) = spawned {
        tracing::debug!(%error, "completion_sound_thread_spawn_failed");
    }
}

/// Ouvre la sortie par défaut, joue le son jusqu'au bout, puis la referme : aucun
/// flux de sortie ne reste ouvert entre deux sons.
fn play_blocking(bytes: &'static [u8], volume: f32) -> Result<(), String> {
    let source =
        rodio::Decoder::try_from(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let sink = syntheo_audio_utils::open_default_playback_sink().map_err(|e| e.to_string())?;
    let player = rodio::Player::connect_new(sink.mixer());
    player.set_volume(volume);
    player.append(source);
    player.sleep_until_end();
    drop(player);
    drop(sink);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;

    const ALL: [CompletionSound; 5] = [
        CompletionSound::Ready,
        CompletionSound::Success,
        CompletionSound::Chime,
        CompletionSound::Sparkle,
        CompletionSound::Bloom,
    ];

    #[test]
    fn maps_setting_names_to_cues() {
        assert_eq!(CompletionSound::Ready.cue(), CompletionCue::Ready);
        assert_eq!(CompletionSound::Success.cue(), CompletionCue::Success);
        assert_eq!(CompletionSound::Chime.cue(), CompletionCue::Success);
        assert_eq!(CompletionSound::Sparkle.cue(), CompletionCue::Success);
        assert_eq!(CompletionSound::Bloom.cue(), CompletionCue::Open);
    }

    #[test]
    fn deserializes_setting_names() {
        for (name, sound) in ["ready", "success", "chime", "sparkle", "bloom"]
            .into_iter()
            .zip(ALL)
        {
            let parsed: CompletionSound = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(parsed, sound);
        }
        assert!(serde_json::from_value::<CompletionSound>(serde_json::json!("open")).is_err());
    }

    #[test]
    fn embedded_sounds_decode_as_short_clips() {
        for cue in [
            CompletionCue::Ready,
            CompletionCue::Success,
            CompletionCue::Open,
        ] {
            let decoder = rodio::Decoder::try_from(std::io::Cursor::new(cue.bytes()))
                .unwrap_or_else(|e| panic!("{cue:?}: {e}"));
            assert_eq!(decoder.sample_rate().get(), 48_000, "{cue:?}");
            assert_eq!(decoder.channels().get(), 2, "{cue:?}");
            let samples: Vec<f32> = decoder.collect();
            let seconds = samples.len() as f32 / (48_000.0 * 2.0);
            assert!((0.3..1.5).contains(&seconds), "{cue:?}: {seconds} s");
            let peak = samples.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));
            assert!(peak > 0.05 && peak < 0.7, "{cue:?}: crête {peak}");
        }
    }

    #[test]
    fn clamps_volume() {
        assert_eq!(clamp_volume(0.7), 0.7);
        assert_eq!(clamp_volume(2.0), 1.0);
        assert_eq!(clamp_volume(-1.0), 0.0);
        assert_eq!(clamp_volume(f32::NAN), 1.0);
    }
}
