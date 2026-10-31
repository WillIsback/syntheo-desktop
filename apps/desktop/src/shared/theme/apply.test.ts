import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getStoredSettingValues = vi.hoisted(() => vi.fn());

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues,
}));

import {
  bootstrapThemeFromSettings,
  normalizeThemePreference,
  readStoredThemePreference,
  resolveBootIsDark,
} from "./apply";

function mockSystemTheme(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: prefersDark,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  getStoredSettingValues.mockReset();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-palette");
  mockSystemTheme(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("normalizeThemePreference", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    ["invalid", "system"],
  ])("normalizes %s to %s", (preference, expected) => {
    expect(normalizeThemePreference(preference)).toBe(expected);
  });
});

describe("readStoredThemePreference", () => {
  it("lit la nouvelle clé Syntheo", () => {
    localStorage.setItem("syntheo-theme", "dark");

    expect(readStoredThemePreference()).toBe("dark");
  });

  it("conserve le repli depuis l'ancienne clé anarlog-theme", () => {
    localStorage.setItem("anarlog-theme", "light");

    expect(readStoredThemePreference()).toBe("light");
  });

  it("falls back to the legacy storage key", () => {
    localStorage.setItem("hypr-theme", "dark");

    expect(readStoredThemePreference()).toBe("dark");
  });

  it("privilégie la clé Syntheo sur les clés héritées", () => {
    localStorage.setItem("syntheo-theme", "light");
    localStorage.setItem("anarlog-theme", "dark");
    localStorage.setItem("hypr-theme", "dark");

    expect(readStoredThemePreference()).toBe("light");
  });
});

describe("resolveBootIsDark", () => {
  it.each([
    ["light", true, false],
    ["dark", false, true],
    ["system", true, true],
    ["system", false, false],
    [null, true, true],
    [null, false, false],
    ["legacy-value", true, true],
    ["legacy-value", false, false],
  ])(
    "resolves stored theme %s with system appearance %s to %s",
    (stored, prefersDark, expected) => {
      expect(resolveBootIsDark(stored, prefersDark)).toBe(expected);
    },
  );
});

describe("bootstrapThemeFromSettings", () => {
  it("applies persisted settings before resolving when load is prompt", async () => {
    getStoredSettingValues.mockResolvedValue({
      values: { theme: "dark" },
      hasValues: new Set(["theme"]),
    });

    await bootstrapThemeFromSettings({ timeoutMs: 100 });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("syntheo-theme")).toBe("dark");
  });

  it("applique et mémorise la palette enregistrée dans les paramètres", async () => {
    getStoredSettingValues.mockResolvedValue({
      values: { theme: "light", palette: "fuji" },
      hasValues: new Set(["theme", "palette"]),
    });

    await bootstrapThemeFromSettings({ timeoutMs: 100 });

    expect(document.documentElement.getAttribute("data-palette")).toBe("fuji");
    expect(localStorage.getItem("syntheo-palette")).toBe("fuji");
  });

  it("revient à Thé vert sans palette enregistrée (paramètres antérieurs)", async () => {
    document.documentElement.setAttribute("data-palette", "enji");
    localStorage.setItem("syntheo-palette", "enji");
    getStoredSettingValues.mockResolvedValue({
      values: { theme: "dark" },
      hasValues: new Set(["theme"]),
    });

    await bootstrapThemeFromSettings({ timeoutMs: 100 });

    expect(document.documentElement.hasAttribute("data-palette")).toBe(false);
    expect(localStorage.getItem("syntheo-palette")).toBe("cha");
  });

  it("does not hold startup past the deadline when settings load stalls", async () => {
    vi.useFakeTimers();

    let resolveLoad!: (value: {
      values: { theme: string };
      hasValues: Set<string>;
    }) => void;
    getStoredSettingValues.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const bootstrap = bootstrapThemeFromSettings({ timeoutMs: 20 });
    let resolved = false;
    void bootstrap.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(resolved).toBe(true);
    expect(localStorage.getItem("syntheo-theme")).toBe(null);

    resolveLoad({
      values: { theme: "dark" },
      hasValues: new Set(["theme"]),
    });
    await Promise.resolve();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("syntheo-theme")).toBe("dark");
  });
});
