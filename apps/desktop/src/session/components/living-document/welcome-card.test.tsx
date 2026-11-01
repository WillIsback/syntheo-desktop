import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isWelcomeNote, WelcomeCard } from "./welcome-card";

import { WELCOME_NOTE_TRACKING_ID } from "~/onboarding/welcome-note.constants";

const mocks = vi.hoisted(() => ({
  eventJson: "" as string | undefined,
  openNew: vi.fn(),
}));

vi.mock("~/session/queries", () => ({
  useSession: () =>
    mocks.eventJson === undefined ? null : { event_json: mocks.eventJson },
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (select: (state: { openNew: typeof mocks.openNew }) => unknown) =>
    select({ openNew: mocks.openNew }),
}));

const welcomeEvent = JSON.stringify({ tracking_id: WELCOME_NOTE_TRACKING_ID });

beforeEach(() => {
  mocks.eventJson = welcomeEvent;
  mocks.openNew.mockReset();
});

afterEach(cleanup);

describe("isWelcomeNote", () => {
  it("recognizes only the welcome note", () => {
    expect(isWelcomeNote(welcomeEvent)).toBe(true);
    expect(isWelcomeNote(JSON.stringify({ tracking_id: "meeting-42" }))).toBe(
      false,
    );
    expect(isWelcomeNote("")).toBe(false);
    expect(isWelcomeNote(undefined)).toBe(false);
    expect(isWelcomeNote("{not json")).toBe(false);
  });
});

describe("WelcomeCard", () => {
  it("opens each essential settings screen from its button", () => {
    render(<WelcomeCard sessionId="welcome" />);

    fireEvent.click(screen.getByRole("button", { name: /Appearance/ }));
    fireEvent.click(screen.getByRole("button", { name: /Transcription/ }));
    fireEvent.click(screen.getByRole("button", { name: /Synthesis/ }));

    expect(mocks.openNew.mock.calls.map(([input]) => input)).toEqual([
      { type: "settings", state: { tab: "appearance" } },
      { type: "settings", state: { tab: "transcription" } },
      { type: "settings", state: { tab: "intelligence" } },
    ]);
  });

  it("is absent from any other note", () => {
    mocks.eventJson = JSON.stringify({ tracking_id: "meeting-42" });
    const { container } = render(<WelcomeCard sessionId="meeting" />);
    expect(container.innerHTML).toBe("");
  });

  it("is absent while the note is still loading", () => {
    mocks.eventJson = undefined;
    const { container } = render(<WelcomeCard sessionId="loading" />);
    expect(container.innerHTML).toBe("");
  });
});
