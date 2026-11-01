import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NoteSeal, ProvenanceLegend } from "./provenance";

describe("ProvenanceLegend", () => {
  afterEach(() => {
    cleanup();
  });

  it("tells who wrote what: your notes in user-ink, Syntheo in foreground", () => {
    render(<ProvenanceLegend />);

    const mine = screen.getByText("Your notes");
    const syntheo = screen.getByText("Completed by Syntheo");
    expect(mine.className).toContain("text-user-ink");
    expect(mine.querySelector("i")?.className).toContain("bg-user-ink");
    expect(syntheo.className).toContain("text-foreground");
    expect(syntheo.className).not.toContain("user-ink");
    expect(syntheo.querySelector("i")?.className).toContain("bg-foreground");
    for (const label of [mine, syntheo]) {
      expect(label.className).not.toMatch(/italic|text-muted|text-faint/);
    }
  });
});

describe("living-document.css", () => {
  const css = readFileSync(
    join(
      process.cwd(),
      "src/session/components/living-document/living-document.css",
    ),
    "utf8",
  );
  const rule = (selector: string) =>
    css.match(
      new RegExp(
        `${selector.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
      ),
    )?.[1] ?? "";

  it("writes Syntheo's text in foreground, never italic nor grey", () => {
    const ai = rule('[data-provenance="ai"] .note-typography');
    expect(ai).toContain("color: hsl(var(--foreground))");
    expect(ai).not.toMatch(/italic|muted|faint/);
  });

  it("writes the user's notes and their checkboxes in user-ink", () => {
    expect(rule('[data-provenance="user"] .note-typography')).toContain(
      "color: hsl(var(--user-ink))",
    );
    expect(
      rule('[data-provenance="user"] .note-typography input.task-checkbox'),
    ).toContain("border-color: hsl(var(--user-ink))");
    expect(css).not.toContain("ai-ink");
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
