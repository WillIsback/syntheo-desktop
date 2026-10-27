import { describe, expect, it } from "vitest";

import {
  hasDarkAppIconVariant,
  normalizeAppIconPreference,
  resolveAppIconName,
  resolveDockIconName,
} from "./icon";

describe("app icon preference", () => {
  it("falls back to the default icon for unknown values", () => {
    expect(normalizeAppIconPreference(undefined)).toBe("default");
    expect(normalizeAppIconPreference("unknown")).toBe("default");
    expect(normalizeAppIconPreference("dev")).toBe("dev");
    expect(normalizeAppIconPreference("staging")).toBe("staging");
    expect(normalizeAppIconPreference("journal")).toBe("journal");
    expect(normalizeAppIconPreference("notepad")).toBe("notepad");
    expect(normalizeAppIconPreference("stone")).toBe("stone");
    expect(normalizeAppIconPreference("typewriter-key")).toBe("typewriter-key");
    expect(normalizeAppIconPreference("walnut")).toBe("walnut");
  });

  it("resolves the default icon from the app channel", () => {
    expect(resolveAppIconName("default", "com.syntheo.stable")).toBe("stable");
    expect(resolveAppIconName("default", "com.syntheo.nightly")).toBe(
      "staging",
    );
    expect(resolveAppIconName("default", "com.syntheo.staging")).toBe(
      "staging",
    );
    expect(resolveAppIconName("default", "com.syntheo.dev")).toBe("dev");
  });

  it("follows the system appearance for the system theme", () => {
    expect(
      resolveDockIconName("anagram", "system", false, "com.syntheo.dev"),
    ).toBe("anagram");
    expect(
      resolveDockIconName("anagram", "system", true, "com.syntheo.dev"),
    ).toBe("anagram-dark");
    expect(
      resolveDockIconName("staging", "system", true, "com.syntheo.stable"),
    ).toBe("staging-dark");
  });

  it("overrides the system appearance with an explicit theme", () => {
    expect(
      resolveDockIconName("anagram", "dark", false, "com.syntheo.dev"),
    ).toBe("anagram-dark");
    expect(
      resolveDockIconName("anagram", "light", true, "com.syntheo.dev"),
    ).toBe("anagram");
    expect(
      resolveDockIconName("default", "dark", false, "com.syntheo.stable"),
    ).toBe("stable-dark");
  });

  it("keeps theme-independent icons unchanged", () => {
    expect(
      resolveDockIconName("journal", "system", true, "com.syntheo.stable"),
    ).toBe("journal");
    expect(
      resolveDockIconName("stone", "dark", false, "com.syntheo.stable"),
    ).toBe("stone");
    expect(hasDarkAppIconVariant("anagram")).toBe(true);
    expect(hasDarkAppIconVariant("walnut")).toBe(false);
  });
});
