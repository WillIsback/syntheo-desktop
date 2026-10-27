import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest s'exécute avec cwd = apps/desktop.
const globals = readFileSync(
  resolve(process.cwd(), "src/styles/globals.css"),
  "utf8",
);

describe("police Syntheo", () => {
  it("déclare la police Inter embarquée en tête de --font-sans", () => {
    expect(globals).toMatch(/--font-sans:\s*\n?\s*"Inter Variable",/);
  });

  it("importe la police via le paquet fontsource", () => {
    expect(globals).toMatch(/@import "@fontsource-variable\/inter";/);
  });

  it("supprime les anciens OTF SF Pro inutilisés", () => {
    expect(
      existsSync(
        resolve(process.cwd(), "public/fonts/SF-Pro-Text-Regular.otf"),
      ),
    ).toBe(false);
  });
});
