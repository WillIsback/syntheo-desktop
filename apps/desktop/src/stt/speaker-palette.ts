import { DesignColors } from "@syntheo/design-system";

// Palette Syntheo des locuteurs (s1–s4) : 藍, 千歳緑, 山吹, 江戸紫, reprise des
// jetons chart-* (DesignColors, alignés sur tokens.css) en clair et en sombre.
const SPEAKER_TOKENS = ["chart2", "chart1", "chart3", "chart4"] as const;

export const SPEAKER_PALETTE = SPEAKER_TOKENS.map(
  (token) => DesignColors.light[token],
);

export const SPEAKER_PALETTE_DARK = SPEAKER_TOKENS.map(
  (token) => DesignColors.dark[token],
);

function paletteIndex(index: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }
  const size = SPEAKER_TOKENS.length;
  return ((Math.trunc(index) % size) + size) % size;
}

/** Couleur stable et cyclique pour l'index d'un locuteur (thème clair). */
export function speakerColor(index: number): string {
  return SPEAKER_PALETTE[paletteIndex(index)];
}

/** Même locuteur, variante du thème sombre. */
export function speakerColorDark(index: number): string {
  return SPEAKER_PALETTE_DARK[paletteIndex(index)];
}
