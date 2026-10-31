import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteIndex } from "./note-index";
import type { RecentNote } from "./queries";

const NOTES: RecentNote[] = [
  {
    id: "s1",
    title: "Entretien annuel",
    createdAt: "2024-10-29T10:00:00",
    durationMs: 42 * 60_000,
  },
  {
    id: "s2",
    title: "",
    createdAt: "2024-10-28T10:00:00",
    durationMs: 65 * 60_000,
  },
  {
    id: "s3",
    title: "Sans audio",
    createdAt: "2024-10-27T10:00:00",
    durationMs: 0,
  },
];

describe("NoteIndex", () => {
  afterEach(() => {
    cleanup();
  });

  it("n'affiche rien sans note", () => {
    const { container } = render(<NoteIndex notes={[]} onOpen={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("liste date, titre et durée, sans carte", () => {
    render(<NoteIndex notes={NOTES} onOpen={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Resume" })).toBeTruthy();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);

    const cells = (row: HTMLElement) =>
      Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent);
    expect(cells(rows[1]!)[1]).toBe("Untitled");
    expect(cells(rows[0]!)[2]).toBe("42 min");
    expect(cells(rows[1]!)[2]).toBe("1 h 05");
    expect(cells(rows[2]!)[2]).toBe("");

    const [date, , duration] = Array.from(rows[0]!.querySelectorAll("td"));
    expect(date?.className).toContain("text-muted-foreground");
    expect(duration?.className).toContain("text-muted-foreground");
    expect(date?.className).toContain("border-border");
    expect(rows[0]!.className).toContain("hover:bg-accent");
    expect(document.querySelector(".bg-card, .shadow")).toBeNull();
  });

  it("ouvre la note au clic sur la ligne ou au clavier", () => {
    const onOpen = vi.fn();
    render(<NoteIndex notes={NOTES} onOpen={onOpen} />);

    fireEvent.click(screen.getAllByRole("row")[2]!);
    expect(onOpen).toHaveBeenLastCalledWith("s3");

    fireEvent.click(screen.getByRole("button", { name: "Entretien annuel" }));
    expect(onOpen).toHaveBeenLastCalledWith("s1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("passe d'une note à l'autre avec les flèches", () => {
    render(<NoteIndex notes={NOTES} onOpen={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    buttons[0]!.focus();

    fireEvent.keyDown(buttons[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]!.className).toContain("focus-visible:ring-2");
  });
});
