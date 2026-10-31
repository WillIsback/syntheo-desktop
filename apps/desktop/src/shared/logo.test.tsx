import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Logo, LOGO_FULL_MIN_SIZE } from "@syntheo/ui/components/logo";

// Vitest s'exécute avec cwd = apps/desktop.
const brand = (file: string) =>
  readFileSync(
    resolve(process.cwd(), "../../packages/design-system/assets/brand", file),
    "utf8",
  );
const pathData = (svg: string) =>
  [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => match[1]);

afterEach(cleanup);

describe("Logo « Hanko S »", () => {
  it("reprend tels quels les tracés du paquet de marque", () => {
    const { container } = render(<Logo variant="full" size={40} />);
    const rendered = [...container.querySelectorAll("path")].map((path) =>
      path.getAttribute("d"),
    );
    const [markS] = pathData(brand("syntheo-mark.svg"));
    const [wordmark] = pathData(brand("syntheo-wordmark.svg"));
    expect(rendered).toEqual([markS, wordmark]);
    // Sceau incliné de −5°, mêmes proportions que les fichiers fournis.
    expect(container.querySelector("g[transform='rotate(-5 32 32)']")).not.toBe(
      null,
    );
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 295 72",
    );
  });

  it("suit le thème : symbole en primary, mot en foreground", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("g.text-primary")).not.toBe(null);
    expect(container.querySelector("path.text-foreground")).not.toBe(null);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
    expect(container.innerHTML).not.toMatch(/recording|seal/);
  });

  it("s'annonce comme image « Syntheo », ou se masque à côté d'un texte visible", () => {
    const { container, rerender } = render(<Logo />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Syntheo");

    rerender(<Logo decorative />);
    const decorative = container.querySelector("svg")!;
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    expect(decorative.getAttribute("role")).toBe(null);
  });

  it("passe au symbole seul sous la taille minimale du logo complet", () => {
    const { container, rerender } = render(
      <Logo variant="full" size={LOGO_FULL_MIN_SIZE} />,
    );
    expect(
      container.querySelector("svg")?.getAttribute("data-logo-variant"),
    ).toBe("full");

    rerender(<Logo variant="full" size={LOGO_FULL_MIN_SIZE - 1} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("data-logo-variant")).toBe("mark");
    expect(svg.getAttribute("viewBox")).toBe("0 0 64 64");
  });

  it("dimensionne le logo complet par sa hauteur", () => {
    const { container } = render(<Logo variant="full" size={72} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("height")).toBe("72");
    expect(svg.getAttribute("width")).toBe("295");
  });
});
