import {
  type CompletionSound,
  commands as sfxCommands,
} from "@syntheo/plugin-sfx";

import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";

const COMPLETION_SOUND_NAMES = [
  "ready",
  "success",
  "chime",
  "sparkle",
  "bloom",
] as const satisfies readonly CompletionSound[];

export type CompletionSoundName = (typeof COMPLETION_SOUND_NAMES)[number];

const DEFAULT_COMPLETION_SOUND: CompletionSoundName = "ready";
const COMPLETION_SOUND_VOLUME = 0.7;

export function normalizeCompletionSoundName(
  value: string,
): CompletionSoundName {
  return COMPLETION_SOUND_NAMES.includes(value as CompletionSoundName)
    ? (value as CompletionSoundName)
    : DEFAULT_COMPLETION_SOUND;
}

// Joué par Rust (plugin sfx, rodio) : l'audio Web de WebKitGTK passe par
// GStreamer, absent de l'AppImage (issue 317). Rust associe chaque nom à son fichier
// (chime et sparkle jouent success, bloom joue open) et journalise un échec de
// lecture en debug, sans erreur visible.
async function playSound(sound: CompletionSoundName): Promise<void> {
  try {
    await sfxCommands.playCompletionSound(sound, COMPLETION_SOUND_VOLUME);
  } catch (error) {
    console.debug("[completion-sound] playback failed", error);
  }
}

export function previewCompletionSound(sound: CompletionSoundName): void {
  void playSound(sound);
}

export async function playCompletionSound(): Promise<void> {
  try {
    const stored = await getStoredSettingValues();
    if (
      resolveConfigValue("notification_disabled", stored) ||
      !resolveConfigValue("notification_completion_sound", stored)
    ) {
      return;
    }

    await playSound(
      normalizeCompletionSoundName(
        resolveConfigValue("notification_completion_sound_name", stored),
      ),
    );
  } catch (error) {
    console.error("[completion-sound] failed to play completion sound", error);
  }
}
