import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest s'exécute avec cwd = apps/desktop.
const globals = readFileSync(
  resolve(process.cwd(), "src/styles/globals.css"),
  "utf8",
);
const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");

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

  // Importées depuis le JS pour que Vite réécrive les url(./files/…) de
  // fontsource ; via @import dans globals.css, Tailwind les recopie telles
  // quelles et les .woff2 manquent dans dist.
  it("importe Geist et Newsreader via fontsource depuis main.tsx", () => {
    expect(main).toMatch(/import "@fontsource-variable\/geist";/);
    expect(main).toMatch(/import "@fontsource-variable\/newsreader";/);
    expect(globals).not.toMatch(/@import "@fontsource/);
    expect(main).not.toMatch(/@fontsource-variable\/inter/);
  });

  // 茶備聴結記 : ornements de Thé vert ; 藤 紅 : filigranes de Glycine et de
  // Laque et encre ; 緑 臙 脂 : noms 緑茶 / 臙脂 du sélecteur de palette.
  it("limite le sous-ensemble kanji aux idéogrammes 茶備聴結記藤紅緑臙脂", () => {
    const face = globals.match(/@font-face\s*\{[^}]*"Syntheo Kanji"[^}]*\}/);
    expect(face).not.toBeNull();
    expect(face![0]).toMatch(/url\("\.\/fonts\/noto-serif-jp-kanji\.woff2"\)/);
    expect(face![0]).toMatch(
      /unicode-range:\s*U\+8336,\s*U\+5099,\s*U\+8074,\s*U\+7D50,\s*U\+8A18,\s*U\+85E4,\s*U\+7D05,\s*U\+7DD1,\s*U\+81D9,\s*U\+8102;/,
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
