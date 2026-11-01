import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TemplatePreview } from "./template-preview";

afterEach(cleanup);

describe("TemplatePreview", () => {
  it("montre la forme de la synthèse : titre daté, sections et consignes", () => {
    render(
      <TemplatePreview
        title="Point d'équipe"
        date={new Date(2026, 9, 27)}
        sections={[
          { title: "Décisions", description: "Ce qui a été tranché." },
          { title: "Actions", description: "Qui fait quoi." },
        ]}
      />,
    );

    const preview = screen.getByRole("article", { name: "Summary preview" });
    expect(
      within(preview).getByRole("heading", { level: 2 }).textContent,
    ).toMatch(/^Point d'équipe · Tuesday/);
    expect(
      within(preview)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Décisions", "Actions"]);
    expect(within(preview).getByText("Ce qui a été tranché.")).toBeTruthy();
    expect(screen.getByText("Written by Syntheo")).toBeTruthy();
  });

  it("écrit l'exemple de Syntheo à l'encre foreground, les consignes en muted", () => {
    render(
      <TemplatePreview
        title="Point d'équipe"
        sections={[
          { title: "Décisions", description: "Ce qui a été tranché." },
        ]}
      />,
    );

    const sample = screen.getByText(
      "— Sample line written from this instruction.",
    );
    expect(sample.className).toContain("text-foreground");
    expect(sample.className).not.toMatch(/user-ink|italic|muted|faint/);
    expect(screen.getByText("Ce qui a été tranché.").className).toContain(
      "text-muted-foreground",
    );
    expect(document.body.innerHTML).not.toContain("ai-ink");
  });

  it("invite à ajouter des sections quand il n'y en a pas", () => {
    render(<TemplatePreview title="" sections={[]} />);

    expect(
      screen.getByText("Add sections to see the shape of the summary."),
    ).toBeTruthy();
  });
});
