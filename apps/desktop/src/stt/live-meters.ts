import { useListener } from "./contexts";

export function combineLiveAmplitude(amplitude: {
  mic: number;
  speaker: number;
}): number {
  return Math.min(Math.hypot(amplitude.mic, amplitude.speaker), 1);
}

/**
 * Niveau sonore de l'écoute en cours, 0 si `sessionId` n'est pas la session
 * écoutée. Il change dix fois par seconde (`audio_amplitude`) : ne l'appeler
 * que dans le composant qui le dessine, jamais dans un parent.
 */
export function useLiveAmplitude(sessionId: string): number {
  return useListener((state) =>
    state.live.sessionId === sessionId
      ? combineLiveAmplitude(state.live.amplitude)
      : 0,
  );
}

/** Secondes d'écoute de `sessionId` (0 si elle n'est pas écoutée). */
export function useLiveSeconds(sessionId: string): number {
  return useListener((state) =>
    state.live.sessionId === sessionId ? state.live.seconds : 0,
  );
}
