import { type DesignColorSet, DesignPalettes } from "@syntheo/design-system";
import type { FloatingBarState } from "@syntheo/plugin-windows";

import { type PaletteId, readDocumentPalette } from "~/shared/theme/palette";

// Les fenêtres flottantes (barre d'écoute, sous-titres, dictée) reçoivent leur
// thème par `colorScheme` plutôt que par la classe `.dark` du document : on
// dérive donc leurs couleurs des jetons TypeScript (DesignPalettes, alignés sur
// tokens.css) au lieu de valeurs en dur. La palette (Thé vert, Glycine, Laque
// et encre) est celle du document : `data-palette`, posé par theme-boot.js puis
// tenu à jour par AppThemeProvider dans chaque fenêtre ; les écrans flottants
// se re-rendent quand elle change (useDocumentPalette).

export type FloatingColorScheme = FloatingBarState["colorScheme"];

export function tokensFor(
  colorScheme: FloatingColorScheme,
  palette: PaletteId = readDocumentPalette(),
): DesignColorSet {
  const set = DesignPalettes[palette];
  return colorScheme === "dark" ? set.dark : set.light;
}

/** Applique une transparence à un jeton (pourcentage d'opacité, 0 à 100). */
export function withAlpha(color: string, percent: number): string {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return `color-mix(in srgb, ${color} ${Math.round(clamped * 100) / 100}%, transparent)`;
}
