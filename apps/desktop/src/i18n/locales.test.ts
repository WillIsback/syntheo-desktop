import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SOURCE_LOCALE, SUPPORTED_DISPLAY_LOCALES } from "./locales";

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
