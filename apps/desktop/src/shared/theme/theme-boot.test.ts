import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `public/theme-boot.js` s'exécute avant React (index.html) : on le rejoue tel
// quel dans jsdom pour vérifier qu'il pose `.dark` et `data-palette` depuis le
// stockage local, sans flash de la palette par défaut.
const script = readFileSync(
  resolve(process.cwd(), "public/theme-boot.js"),
  "utf8",
);

function runBoot() {
  // oxlint-disable-next-line no-new-func -- rejoue le script public tel quel
  new Function(script)();
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-palette");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-palette");
});

describe("theme-boot.js", () => {
  it.each(["fuji", "enji"])("pose data-palette=%s mémorisée", (palette) => {
    localStorage.setItem("syntheo-palette", palette);
    runBoot();
    expect(document.documentElement.getAttribute("data-palette")).toBe(palette);
  });

  it.each([null, "cha", "inconnue"])(
    "laisse Thé vert (pas d'attribut) pour %s",
    (palette) => {
      if (palette !== null) localStorage.setItem("syntheo-palette", palette);
      runBoot();
      expect(document.documentElement.hasAttribute("data-palette")).toBe(false);
    },
  );

  it("combine la palette et le thème sombre", () => {
    localStorage.setItem("syntheo-palette", "enji");
    localStorage.setItem("syntheo-theme", "dark");
    runBoot();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-palette")).toBe("enji");
  });
});
