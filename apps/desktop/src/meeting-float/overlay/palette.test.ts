import { afterEach, describe, expect, it } from "vitest";

import { DesignPalettes } from "@syntheo/design-system";

import { tokensFor } from "./palette";

afterEach(() => {
  document.documentElement.removeAttribute("data-palette");
});

describe("tokensFor", () => {
  it("lit Thé vert par défaut", () => {
    expect(tokensFor("light")).toBe(DesignPalettes.cha.light);
    expect(tokensFor("dark")).toBe(DesignPalettes.cha.dark);
  });

  it("suit la palette active du document (data-palette)", () => {
    document.documentElement.setAttribute("data-palette", "enji");
    expect(tokensFor("light")).toBe(DesignPalettes.enji.light);
    expect(tokensFor("dark")).toBe(DesignPalettes.enji.dark);
  });

  it("accepte une palette explicite", () => {
    expect(tokensFor("dark", "fuji")).toBe(DesignPalettes.fuji.dark);
  });
});
