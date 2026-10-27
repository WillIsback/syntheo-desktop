import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SOURCE_LOCALE,
  SUPPORTED_DISPLAY_LOCALES,
  resolveDisplayLocale,
} from "./locales";

describe("locales supportées", () => {
  it("se limite à en et fr", () => {
    expect([...SUPPORTED_DISPLAY_LOCALES].sort()).toEqual(["en", "fr"]);
  });

  it("n'a que les dossiers de catalogue en et fr", () => {
    const dirs = readdirSync(resolve(process.cwd(), "src/i18n/locales")).sort();
    expect(dirs).toEqual(["en", "fr"]);
  });

  it("garde l'anglais comme source", () => {
    expect(SOURCE_LOCALE).toBe("en");
  });
});

describe("resolveDisplayLocale", () => {
  it("français par défaut quand aucune langue n'est choisie", () => {
    expect(resolveDisplayLocale(null)).toBe("fr");
    expect(resolveDisplayLocale(undefined)).toBe("fr");
  });

  it("anglais seulement si la langue de base est en", () => {
    expect(resolveDisplayLocale("en")).toBe("en");
    expect(resolveDisplayLocale("en-US")).toBe("en");
  });

  it("français pour les autres langues de transcription", () => {
    expect(resolveDisplayLocale("de")).toBe("fr");
    expect(resolveDisplayLocale("fr")).toBe("fr");
    expect(resolveDisplayLocale("xx-invalid")).toBe("fr");
  });
});
