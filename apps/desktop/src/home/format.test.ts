import { describe, expect, it } from "vitest";

import { firstNameOf, formatDuration, formatIndexDate } from "./format";

describe("firstNameOf", () => {
  it("garde le premier mot du nom complet", () => {
    expect(firstNameOf("  Camille  Martin ")).toBe("Camille");
  });

  it("renvoie une chaîne vide sans nom", () => {
    expect(firstNameOf("")).toBe("");
    expect(firstNameOf("   ")).toBe("");
    expect(firstNameOf(null)).toBe("");
    expect(firstNameOf(undefined)).toBe("");
  });
});

describe("formatDuration", () => {
  it("affiche les minutes, puis les heures", () => {
    expect(formatDuration(42 * 60_000)).toBe("42 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05");
    expect(formatDuration(120 * 60_000 + 59_000)).toBe("2 h 00");
  });

  it("n'affiche rien sous la minute", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(59_000)).toBe("");
    expect(formatDuration(-5)).toBe("");
  });
});

describe("formatIndexDate", () => {
  it("formate une date courte en français", () => {
    expect(formatIndexDate("2024-10-29T10:00:00", "fr")).toBe("mar. 29 oct.");
  });

  it("renvoie une chaîne vide pour une date illisible", () => {
    expect(formatIndexDate("", "fr")).toBe("");
    expect(formatIndexDate("n'importe quoi", "fr")).toBe("");
  });
});
