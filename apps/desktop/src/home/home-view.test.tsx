import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeView, type HomeViewProps } from "./home-view";

function renderHome(overrides: Partial<HomeViewProps> = {}) {
  const props: HomeViewProps = {
    firstName: "Camille",
    nextMeeting: null,
    recentNotes: [],
    onStart: vi.fn(),
    onOpenNote: vi.fn(),
    onSearch: vi.fn(),
    ...overrides,
  };
  render(<HomeView {...props} />);
  return props;
}

describe("HomeView", () => {
  afterEach(() => {
    cleanup();
  });

  it("salue l'utilisateur par son prénom, en serif 52px", () => {
    renderHome();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Hello Camille.");
    expect(heading.className).toContain("font-serif");
    expect(heading.className).toContain("text-[52px]");
    expect(heading.className).toContain("leading-[1.05]");
  });

  it("dit simplement bonjour sans prénom", () => {
    renderHome({ firstName: "" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Hello.",
    );
  });

  it("n'affiche pas de prochaine réunion quand l'agenda est vide", () => {
    renderHome();
    expect(document.querySelector("[data-next-meeting]")).toBeNull();
  });

  it("affiche la prochaine réunion de l'agenda", () => {
    const startedAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    renderHome({
      nextMeeting: {
        id: "event-1",
        title: "Point d'équipe",
        startedAt,
        endedAt: new Date(startedAt.getTime() + 3_600_000),
        imminent: false,
        ongoing: false,
      },
    });
    const line = document.querySelector("[data-next-meeting]");
    expect(line?.textContent).toContain("Your next meeting:");
    expect(line?.querySelector("b")?.textContent).toBe("Point d'équipe");
  });

  it("indique une réunion en cours", () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);
    renderHome({
      nextMeeting: {
        id: "event-1",
        title: "Point d'équipe",
        startedAt,
        endedAt: new Date(startedAt.getTime() + 3_600_000),
        imminent: true,
        ongoing: true,
      },
    });
    expect(
      document.querySelector("[data-next-meeting]")?.textContent,
    ).toContain("in progress");
  });

  it("le bouton Démarrer est le seul élément primary plein largeur", () => {
    const props = renderHome();
    const start = screen.getByRole("button", { name: /Start a meeting/ });
    expect(start.className).toContain("bg-primary");
    expect(start.className).toContain("w-full");
    expect(start.className).toContain("rounded-2xl");
    fireEvent.click(start);
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it("affiche le filigrane 茶 décoratif et le pied local", () => {
    renderHome();
    const watermark = document.querySelector("[data-home-watermark]");
    expect(watermark?.textContent).toBe("茶");
    expect(watermark?.getAttribute("aria-hidden")).toBe("true");
    expect(watermark?.className).toContain("font-kanji");
    expect(watermark?.className).toContain("text-primary");
    expect(watermark?.className).toContain("opacity-[0.06]");
    expect(watermark?.className).toContain("text-[300px]");
    expect(
      screen.getByText("Everything is processed on your local server"),
    ).toBeTruthy();
  });

  it.each([
    ["fuji", "藤"],
    ["enji", "紅"],
  ])("prend le filigrane de la palette %s : %s", (palette, kanji) => {
    document.documentElement.setAttribute("data-palette", palette);
    try {
      renderHome();
      const watermark = document.querySelector("[data-home-watermark]");
      expect(watermark?.textContent).toBe(kanji);
      expect(watermark?.getAttribute("aria-hidden")).toBe("true");
    } finally {
      document.documentElement.removeAttribute("data-palette");
    }
  });

  it("la capsule ne propose que « Rechercher une note » (Ctrl K)", () => {
    const props = renderHome();
    const capsule = screen.getByRole("group", { name: "Home capsule" });
    const buttons = capsule.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Search a noteCtrl K");
    expect(buttons[0]?.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    expect(capsule.className).toContain("shadow-capsule");
    expect(capsule.className).toContain("rounded-pill");
    fireEvent.click(buttons[0]!);
    expect(props.onSearch).toHaveBeenCalledTimes(1);
  });

  it("affiche ⌘ sur macOS", () => {
    renderHome({ modifierLabel: "⌘" });
    expect(
      screen.getByRole("button", { name: /Start a meeting/ }).textContent,
    ).toContain("⌘ N");
    expect(
      screen.getByRole("button", { name: /Search a note/ }).textContent,
    ).toContain("⌘ K");
  });
});
