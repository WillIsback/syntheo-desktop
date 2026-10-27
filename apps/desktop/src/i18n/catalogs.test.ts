import { i18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { createI18n, getCatalogLocalesForDisplayLocale } from "./catalogs";

describe("i18n catalogs", () => {
  it("loads the active locale with English as its fallback", () => {
    expect(getCatalogLocalesForDisplayLocale("en")).toEqual(["en"]);
    expect(getCatalogLocalesForDisplayLocale("fr")).toEqual(["en", "fr"]);
  });

  it("caches and activates dynamically imported catalogs", async () => {
    const first = await createI18n("fr");
    const second = await createI18n("fr");

    expect(first).toBe(i18n);
    expect(first.locale).toBe("fr");
    expect(second.locale).toBe("fr");
  });

  it("does not let a slower catalog overwrite a newer locale", async () => {
    const stale = createI18n("fr");
    const latest = createI18n("en");

    await latest;
    expect(i18n.locale).toBe("en");

    await stale;
    expect(i18n.locale).toBe("en");
  });
});
