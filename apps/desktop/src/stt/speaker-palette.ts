// Palette Syntheo des locuteurs (s1–s4) : bleu, vert, orange, violet.
export const SPEAKER_PALETTE = [
  "#1a73e8",
  "#0f9d58",
  "#e37400",
  "#a142f4",
] as const;

/** Couleur stable et cyclique pour l'index d'un locuteur. */
export function speakerColor(index: number): string {
  if (!Number.isFinite(index)) {
    return SPEAKER_PALETTE[0];
  }
  const size = SPEAKER_PALETTE.length;
  const normalized = ((Math.trunc(index) % size) + size) % size;
  return SPEAKER_PALETTE[normalized];
}
