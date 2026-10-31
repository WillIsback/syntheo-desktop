import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SectionsList } from "./sections-editor";

afterEach(cleanup);

const sections = [
  { title: "Décisions", description: "Ce qui a été tranché." },
  { title: "Actions", description: "Qui fait quoi, pour quand." },
  { title: "Points ouverts", description: "Questions sans réponse." },
];

function titles() {
  return screen
    .getAllByRole("textbox", { name: /^Section \d+ title$/ })
    .map((input) => (input as HTMLInputElement).value);
}

describe("SectionsList", () => {
  it("affiche chaque section avec un titre et une consigne", () => {
    render(
      <SectionsList disabled={false} items={sections} onChange={vi.fn()} />,
    );

    expect(titles()).toEqual(["Décisions", "Actions", "Points ouverts"]);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Section 2 instruction",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Qui fait quoi, pour quand.");
  });

  it("réordonne une section au clavier depuis sa poignée et garde le focus", () => {
    const onChange = vi.fn();
    render(
      <SectionsList disabled={false} items={sections} onChange={onChange} />,
    );

    const handle = screen.getByRole("button", { name: "Move section 1" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowDown" });

    expect(titles()).toEqual(["Actions", "Décisions", "Points ouverts"]);
    expect(onChange).toHaveBeenLastCalledWith([
      sections[1],
      sections[0],
      sections[2],
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move section 2" }),
    );
    expect(screen.getByText("Section moved to position 2 of 3.")).toBeTruthy();

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(titles()).toEqual(["Décisions", "Actions", "Points ouverts"]);
  });

  it("ne déplace pas au-delà des bords", () => {
    const onChange = vi.fn();
    render(
      <SectionsList disabled={false} items={sections} onChange={onChange} />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Move section 1" }), {
      key: "ArrowUp",
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Move section 3" }), {
      key: "ArrowDown",
    });

    expect(titles()).toEqual(["Décisions", "Actions", "Points ouverts"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ajoute une section et place le focus sur son titre", () => {
    const onChange = vi.fn();
    render(
      <SectionsList disabled={false} items={sections} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ Add a section" }));

    expect(titles()).toHaveLength(4);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Section 4 title" }),
    );
    expect(onChange).toHaveBeenLastCalledWith([
      ...sections,
      { title: "", description: "" },
    ]);
  });

  it("supprime une section", () => {
    const onChange = vi.fn();
    render(
      <SectionsList disabled={false} items={sections} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete section 2" }));

    expect(titles()).toEqual(["Décisions", "Points ouverts"]);
    expect(onChange).toHaveBeenLastCalledWith([sections[0], sections[2]]);
  });

  it("modifie la consigne d'une section", () => {
    const onChange = vi.fn();
    render(
      <SectionsList disabled={false} items={sections} onChange={onChange} />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Section 1 instruction" }),
      { target: { value: "Les décisions, datées." } },
    );

    expect(onChange).toHaveBeenLastCalledWith([
      { title: "Décisions", description: "Les décisions, datées." },
      sections[1],
      sections[2],
    ]);
  });

  it("n'affiche aucune action en lecture seule", () => {
    render(
      <SectionsList disabled={true} items={sections} onChange={vi.fn()} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});
