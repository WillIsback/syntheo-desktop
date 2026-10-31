import { DesignColors } from "@syntheo/design-system";
import type { FloatingBarState } from "@syntheo/plugin-windows";

// Les fenêtres flottantes (barre d'écoute, sous-titres, dictée) reçoivent leur
// thème par `colorScheme` plutôt que par la classe `.dark` du document : on
// dérive donc leurs couleurs des jetons TypeScript (DesignColors, alignés sur
// tokens.css) au lieu de valeurs en dur.

export type FloatingColorScheme = FloatingBarState["colorScheme"];

export function tokensFor(colorScheme: FloatingColorScheme) {
  return colorScheme === "dark" ? DesignColors.dark : DesignColors.light;
}

/** Applique une transparence à un jeton (pourcentage d'opacité, 0 à 100). */
export function withAlpha(color: string, percent: number): string {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return `color-mix(in srgb, ${color} ${Math.round(clamped * 100) / 100}%, transparent)`;
}
