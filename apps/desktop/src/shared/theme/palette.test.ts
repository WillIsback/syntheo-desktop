import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyDocumentPalette,
  normalizePalette,
  readDocumentPalette,
  readStoredPalette,
  useDocumentPalette,
  writeStoredPalette,
} from "./palette";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  delete document.documentElement.dataset.palette;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.palette;
});

describe("normalizePalette", () => {
  it.each([
    ["cha", "cha"],
    ["fuji", "fuji"],
    ["enji", "enji"],
    [null, "cha"],
    [undefined, "cha"],
    ["", "cha"],
    ["sakura", "cha"],
    [42, "cha"],
  ])("normalise %s en %s", (value, expected) => {
    expect(normalizePalette(value)).toBe(expected);
  });
});

describe("applyDocumentPalette", () => {
  it("pose data-palette sur <html> pour Glycine et Laque et encre", () => {
    applyDocumentPalette("fuji");
    expect(document.documentElement.getAttribute("data-palette")).toBe("fuji");
    applyDocumentPalette("enji");
    expect(document.documentElement.getAttribute("data-palette")).toBe("enji");
  });

  it("retire l'attribut pour Thé vert, la palette par défaut de :root", () => {
    applyDocumentPalette("enji");
    applyDocumentPalette("cha");
    expect(document.documentElement.hasAttribute("data-palette")).toBe(false);
    expect(readDocumentPalette()).toBe("cha");
  });
});

describe("stockage local de la palette", () => {
  it("relit la palette écrite, et Thé vert par défaut", () => {
    expect(readStoredPalette()).toBe("cha");
    writeStoredPalette("fuji");
    expect(localStorage.getItem("syntheo-palette")).toBe("fuji");
    expect(readStoredPalette()).toBe("fuji");
  });

  it("ignore une valeur inconnue", () => {
    localStorage.setItem("syntheo-palette", "rose");
    expect(readStoredPalette()).toBe("cha");
  });
});

describe("useDocumentPalette", () => {
  it("suit les changements de data-palette sur <html>", async () => {
    const { result } = renderHook(() => useDocumentPalette());
    expect(result.current).toBe("cha");

    await act(async () => {
      applyDocumentPalette("enji");
      await Promise.resolve();
    });
    expect(result.current).toBe("enji");
  });
});
