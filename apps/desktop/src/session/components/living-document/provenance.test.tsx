import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NoteSeal, ProvenanceLegend } from "./provenance";

describe("ProvenanceLegend", () => {
  afterEach(() => {
    cleanup();
  });

  it("tells who wrote what with the foreground and ai-ink tokens", () => {
    render(<ProvenanceLegend />);

    const mine = screen.getByText("Your notes");
    const syntheo = screen.getByText("Completed by Syntheo");
    expect(mine.className).toContain("text-foreground");
    expect(syntheo.className).toContain("text-ai-ink");
    for (const label of [mine, syntheo]) {
      expect(label.className).not.toMatch(/italic|text-muted|text-faint/);
    }
  });
});

describe("NoteSeal", () => {
  afterEach(() => {
    cleanup();
  });

  it("is a decorative 46px 記 seal in the seal colour, tilted by −5°", () => {
    render(<NoteSeal />);

    const seal = document.querySelector("[data-note-seal]");
    expect(seal?.textContent).toBe("記");
    expect(seal?.getAttribute("aria-hidden")).toBe("true");
    for (const token of [
      "size-[46px]",
      "border-seal",
      "text-seal",
      "-rotate-5",
      "opacity-85",
      "font-kanji",
    ]) {
      expect(seal?.className).toContain(token);
    }
  });
});
