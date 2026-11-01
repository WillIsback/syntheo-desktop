import { useSyncExternalStore } from "react";

import {
  DEFAULT_PALETTE,
  isPaletteId,
  type PaletteId,
} from "@syntheo/design-system";

// Palette de couleurs (Paramètres › Apparence), indépendante du mode
// clair / sombre : Thé vert = pas d'attribut (`:root` / `.dark` de tokens.css),
// Glycine et Laque et encre = `data-palette="fuji|enji"` sur <html>.
// `public/theme-boot.js` applique la valeur stockée avant React (pas de flash) ;
// garder sa logique alignée sur normalizePalette + applyDocumentPalette.

export type { PaletteId };

export const PALETTE_STORAGE_KEY = "syntheo-palette";

export function normalizePalette(value: unknown): PaletteId {
  return isPaletteId(value) ? value : DEFAULT_PALETTE;
}

export function applyDocumentPalette(palette: PaletteId): void {
  const root = document.documentElement;
  if (palette === DEFAULT_PALETTE) {
    root.removeAttribute("data-palette");
  } else {
    root.setAttribute("data-palette", palette);
  }
}

export function readDocumentPalette(): PaletteId {
  if (typeof document === "undefined") {
    return DEFAULT_PALETTE;
  }
  return normalizePalette(
    document.documentElement.getAttribute("data-palette"),
  );
}

export function readStoredPalette(): PaletteId {
  try {
    return normalizePalette(localStorage.getItem(PALETTE_STORAGE_KEY));
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function writeStoredPalette(palette: PaletteId): void {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // Stockage indisponible (tests, webview restreinte) : sans conséquence.
  }
}

function subscribeDocumentPalette(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-palette"],
  });
  return () => observer.disconnect();
}

/** Palette active du document, mise à jour quand `data-palette` change. */
export function useDocumentPalette(): PaletteId {
  return useSyncExternalStore(
    subscribeDocumentPalette,
    readDocumentPalette,
    () => DEFAULT_PALETTE,
  );
}
