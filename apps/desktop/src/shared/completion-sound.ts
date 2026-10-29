import { play, type SoundName } from "cuelume";

import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";

const COMPLETION_SOUND_NAMES = [
  "ready",
  "success",
  "chime",
  "sparkle",
  "bloom",
] as const;

export type CompletionSoundName = (typeof COMPLETION_SOUND_NAMES)[number];

// cuelume 0.2.8 a remplacé ces cues par des noms canoniques ; les anciens noms
// restent des alias. On mappe explicitement pour garder les préférences
// existantes tout en jouant un cue valide.
const PLAYED_SOUNDS: Record<CompletionSoundName, SoundName> = {
  ready: "ready",
  success: "success",
  chime: "success",
  sparkle: "success",
  bloom: "open",
};

const DEFAULT_COMPLETION_SOUND: CompletionSoundName = "ready";
const COMPLETION_SOUND_VOLUME = 0.7;

export function normalizeCompletionSoundName(
  value: string,
): CompletionSoundName {
  return COMPLETION_SOUND_NAMES.includes(value as CompletionSoundName)
    ? (value as CompletionSoundName)
    : DEFAULT_COMPLETION_SOUND;
}

export function previewCompletionSound(sound: CompletionSoundName): void {
  play(PLAYED_SOUNDS[sound], { volume: COMPLETION_SOUND_VOLUME });
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

    previewCompletionSound(
      normalizeCompletionSoundName(
        resolveConfigValue("notification_completion_sound_name", stored),
      ),
    );
  } catch (error) {
    console.error("[completion-sound] failed to play completion sound", error);
  }
}
