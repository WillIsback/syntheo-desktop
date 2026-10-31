import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextMeeting } from "./next-meeting";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "linux"),
  openCurrent: vi.fn(),
  newNote: vi.fn(),
  openSearch: vi.fn(),
  getOrCreateSessionForEventId: vi.fn(),
  nextMeeting: null as NextMeeting | null,
  firstName: "Camille",
  recentNotes: [
    {
      id: "s1",
      title: "Comité projet",
      createdAt: "2024-10-28T10:00:00",
      durationMs: 0,
    },
  ],
}));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: mocks.platform }));

vi.mock("./queries", () => ({
  useOwnerFirstName: () => mocks.firstName,
  useNextMeeting: () => mocks.nextMeeting,
  useRecentNotes: () => mocks.recentNotes,
}));

vi.mock("~/session/queries", () => ({
  getOrCreateSessionForEventId: mocks.getOrCreateSessionForEventId,
}));

vi.mock("~/shared/open-note-dialog", () => ({
  useOpenNoteDialog: () => ({ open: mocks.openSearch }),
}));

vi.mock("~/shared/useNewNote", () => ({
  useNewNote: () => mocks.newNote,
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: { openCurrent: () => void }) => unknown) =>
    selector({ openCurrent: mocks.openCurrent }),
}));

import { HomePage } from "./index";

function meeting(imminent: boolean): NextMeeting {
  const startedAt = new Date(Date.now() + (imminent ? 5 : 120) * 60_000);
  return {
    id: "event-1",
    title: "Point d'équipe",
    startedAt,
    endedAt: new Date(startedAt.getTime() + 3_600_000),
    imminent,
    ongoing: false,
  };
}

describe("HomePage", () => {
  beforeEach(() => {
    mocks.nextMeeting = null;
    mocks.platform.mockReturnValue("linux");
    mocks.getOrCreateSessionForEventId.mockResolvedValue("session-event");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("crée une note vierge sans réunion imminente", () => {
    mocks.nextMeeting = meeting(false);
    render(<HomePage />);

    fireEvent.click(screen.getByRole("button", { name: /Start a meeting/ }));
    expect(mocks.newNote).toHaveBeenCalledTimes(1);
    expect(mocks.getOrCreateSessionForEventId).not.toHaveBeenCalled();
  });

  it("reprend la réunion imminente de l'agenda (titre et participants)", async () => {
    mocks.nextMeeting = meeting(true);
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start a meeting/ }));
    });

    expect(mocks.getOrCreateSessionForEventId).toHaveBeenCalledWith(
      "event-1",
      "Point d'équipe",
    );
    expect(mocks.newNote).not.toHaveBeenCalled();
    expect(mocks.openCurrent).toHaveBeenCalledWith({
      type: "sessions",
      id: "session-event",
    });
  });

  it("ouvre une note de « Reprendre » dans l'onglet courant", () => {
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Comité projet" }));
    expect(mocks.openCurrent).toHaveBeenCalledWith({
      type: "sessions",
      id: "s1",
    });
  });

  it("la capsule ouvre la palette de recherche (Ctrl K)", () => {
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: /Search a note/ }));
    expect(mocks.openSearch).toHaveBeenCalledTimes(1);
  });

  it("affiche ⌘ sur macOS", () => {
    mocks.platform.mockReturnValue("macos");
    render(<HomePage />);
    expect(
      screen.getByRole("button", { name: /Start a meeting/ }).textContent,
    ).toContain("⌘ N");
  });
});
