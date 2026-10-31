import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest s'exécute avec cwd = apps/desktop.
const globals = readFileSync(
  resolve(process.cwd(), "src/styles/globals.css"),
  "utf8",
);

describe("polices Syntheo « Thé vert »", () => {
  it("déclare Geist embarquée en tête de --font-sans", () => {
    expect(globals).toMatch(/--font-sans:\s*\n?\s*"Geist Variable",/);
  });

  it("déclare Newsreader embarquée en tête de --font-serif", () => {
    expect(globals).toMatch(/--font-serif:\s*\n?\s*"Newsreader Variable",/);
  });

  it("déclare le sous-ensemble Noto Serif JP en tête de --font-kanji", () => {
    expect(globals).toMatch(/--font-kanji:\s*\n?\s*"Syntheo Kanji",/);
  });

  it("importe Geist et Newsreader via les paquets fontsource", () => {
    expect(globals).toMatch(/@import "@fontsource-variable\/geist";/);
    expect(globals).toMatch(/@import "@fontsource-variable\/newsreader";/);
    expect(globals).not.toMatch(/@fontsource-variable\/inter/);
  });

  it("limite le sous-ensemble kanji aux idéogrammes 茶備聴結記", () => {
    const face = globals.match(/@font-face\s*\{[^}]*"Syntheo Kanji"[^}]*\}/);
    expect(face).not.toBeNull();
    expect(face![0]).toMatch(/url\("\.\/fonts\/noto-serif-jp-kanji\.woff2"\)/);
    expect(face![0]).toMatch(
      /unicode-range:\s*U\+8336,\s*U\+5099,\s*U\+8074,\s*U\+7D50,\s*U\+8A18;/,
    );
    expect(
      existsSync(
        resolve(process.cwd(), "src/styles/fonts/noto-serif-jp-kanji.woff2"),
      ),
    ).toBe(true);
  });

  it("n'appelle aucune police distante", () => {
    expect(globals).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it("supprime les anciens OTF SF Pro inutilisés", () => {
    expect(
      existsSync(
        resolve(process.cwd(), "public/fonts/SF-Pro-Text-Regular.otf"),
      ),
    ).toBe(false);
  });
});
