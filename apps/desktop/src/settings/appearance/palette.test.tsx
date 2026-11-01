import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setPalette: vi.fn(),
  palette: "cha" as string | undefined,
}));

vi.mock("~/settings/queries", () => ({
  useSetSettingValue: (key: string) =>
    key === "palette" ? mocks.setPalette : vi.fn(),
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) =>
    key === "palette" ? mocks.palette : undefined,
}));

import { PaletteSelector } from "./palette";

function radio(name: RegExp) {
  return screen.getByRole("radio", { name });
}

describe("PaletteSelector", () => {
  it("nomme chaque option par son nom seul et la décrit par sa légende", () => {
    render(<PaletteSelector />);
    const fuji = screen.getByRole("radio", { name: "Wisteria" });
    const describedBy = fuji.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain(
      "Edo purple",
    );
  });

  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.palette = "cha";
    document.documentElement.removeAttribute("data-palette");
  });

  it("propose les trois palettes dans un groupe radio, Thé vert cochée par défaut", () => {
    mocks.palette = undefined;
    render(<PaletteSelector />);

    expect(
      screen.getByRole("radiogroup", { name: "Color palette" }),
    ).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radio(/Green tea/).getAttribute("aria-checked")).toBe("true");
    expect(radio(/Wisteria/).getAttribute("aria-checked")).toBe("false");
    expect(radio(/Lacquer and ink/).getAttribute("aria-checked")).toBe("false");
  });

  it("affiche le kanji (décoratif) et cinq pastilles par palette", () => {
    render(<PaletteSelector />);

    const fuji = radio(/Wisteria/);
    const kanji = fuji.querySelector("[data-palette-kanji]");
    expect(kanji?.textContent).toBe("藤");
    expect(kanji?.getAttribute("aria-hidden")).toBe("true");
    expect(kanji?.className).toContain("font-kanji");
    expect(
      radio(/Green tea/).querySelector("[data-palette-kanji]")?.textContent,
    ).toBe("緑茶");
    expect(
      radio(/Lacquer and ink/).querySelector("[data-palette-kanji]")
        ?.textContent,
    ).toBe("臙脂");

    const swatches = fuji.querySelectorAll("[data-palette-swatch]");
    expect(swatches).toHaveLength(5);
    // Fond, primaire, accent, encre, rouge d'écoute (jetons DesignPalettes).
    expect((swatches[1] as HTMLElement).style.background).toBe(
      "rgb(103, 74, 140)",
    );
  });

  it("applique, mémorise et enregistre la palette choisie", () => {
    render(<PaletteSelector />);

    fireEvent.click(radio(/Lacquer and ink/));

    expect(document.documentElement.getAttribute("data-palette")).toBe("enji");
    expect(localStorage.getItem("syntheo-palette")).toBe("enji");
    expect(mocks.setPalette).toHaveBeenCalledWith("enji");
  });

  it("se pilote au clavier comme un groupe radio (tabulation unique, flèches)", () => {
    mocks.palette = "fuji";
    render(<PaletteSelector />);

    expect(radio(/Wisteria/).tabIndex).toBe(0);
    expect(radio(/Green tea/).tabIndex).toBe(-1);
    expect(radio(/Lacquer and ink/).tabIndex).toBe(-1);

    fireEvent.keyDown(radio(/Wisteria/), { key: "ArrowRight" });
    expect(mocks.setPalette).toHaveBeenLastCalledWith("enji");
    expect(document.activeElement).toBe(radio(/Lacquer and ink/));

    fireEvent.keyDown(radio(/Wisteria/), { key: "ArrowLeft" });
    expect(mocks.setPalette).toHaveBeenLastCalledWith("cha");

    fireEvent.keyDown(radio(/Wisteria/), { key: "End" });
    expect(mocks.setPalette).toHaveBeenLastCalledWith("enji");

    fireEvent.keyDown(radio(/Wisteria/), { key: "Home" });
    expect(mocks.setPalette).toHaveBeenLastCalledWith("cha");
  });

  it("boucle aux extrémités", () => {
    mocks.palette = "enji";
    render(<PaletteSelector />);

    fireEvent.keyDown(radio(/Lacquer and ink/), { key: "ArrowDown" });
    expect(mocks.setPalette).toHaveBeenLastCalledWith("cha");
  });
});
