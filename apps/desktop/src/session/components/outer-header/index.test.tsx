import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorView } from "~/store/zustand/tabs/schema";

const mocks = vi.hoisted(() => ({
  sessionModes: {} as Record<string, string>,
  sessionEvents: {} as Record<string, any>,
  nowMs: 0,
  openUrl: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
  requestMainListenerControl: vi.fn(),
  isMainWebviewWindow: true,
  audioExists: false,
  hasTranscriptBySession: {} as Record<string, boolean>,
  configValues: {} as Record<string, boolean>,
  meetingMicInUse: false,
}));

vi.mock("../title-input", () => ({
  TitleInput: () => <input aria-label="Session title" placeholder="Untitled" />,
}));

vi.mock("~/session/queries", () => ({
  useSession: () => ({ folder_id: "" }),
  useFolderIcons: () => ({}),
  useFolderPaths: () => [],
  useUpdateSession: () => vi.fn(),
}));

vi.mock("./overflow", () => ({
  OverflowButton: () => <button type="button">More</button>,
}));

vi.mock("../shared", () => ({
  RecordingIcon: () => <div />,
  useHasTranscript: (sessionId: string) =>
    mocks.hasTranscriptBySession[sessionId] ?? false,
}));

vi.mock("@syntheo/plugin-opener2", () => ({
  commands: { openUrl: mocks.openUrl },
}));

vi.mock("~/calendar/hooks", () => ({
  useNow: () => new Date(mocks.nowMs),
}));

vi.mock("~/session/hooks/useSessionEvent", () => ({
  useSessionEvent: (sessionId: string) =>
    mocks.sessionEvents[sessionId] ?? null,
}));

vi.mock("~/session/hooks/useMeetingMicInUse", () => ({
  useMeetingMicInUse: () => mocks.meetingMicInUse,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) => mocks.configValues[key],
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: vi.fn((selector: (state: unknown) => unknown) => selector({})),
}));

vi.mock("~/stt/contexts", () => ({
  useListener: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      getSessionMode: (sessionId: string) =>
        mocks.sessionModes[sessionId] ?? "inactive",
      stop: mocks.stopListening,
    }),
  ),
}));

vi.mock("~/stt/useStartListening", () => ({
  useStartListening: () => mocks.startListening,
}));

vi.mock("~/stt/window-control", () => ({
  isMainWebviewWindow: () => mocks.isMainWebviewWindow,
  requestMainListenerControl: mocks.requestMainListenerControl,
}));

import { OuterHeader } from "./index";

const MEET_LINK = "https://meet.google.com/abc-defg-hij";
const scheduled = (meeting_link?: string) => ({
  title: "Design Review",
  started_at: "2026-06-05T10:00:00.000Z",
  ended_at: "2026-06-05T10:30:00.000Z",
  meeting_link,
});
const BEFORE = "2026-06-05T09:55:00.000Z";
const DURING = "2026-06-05T10:05:00.000Z";
const AFTER = "2026-06-05T10:31:00.000Z";

type Scenario = {
  mode?: string;
  event?: Record<string, unknown>;
  now?: string;
  transcript?: boolean;
  audio?: boolean;
  micInUse?: boolean;
};

function arrange({
  mode,
  event,
  now = BEFORE,
  transcript,
  audio,
  micInUse,
}: Scenario) {
  if (mode) mocks.sessionModes = { "session-1": mode };
  if (event) mocks.sessionEvents = { "session-1": event };
  mocks.nowMs = new Date(now).getTime();
  mocks.hasTranscriptBySession = { "session-1": !!transcript };
  mocks.audioExists = !!audio;
  mocks.meetingMicInUse = !!micInUse;
}

function renderHeader(
  props: {
    view?: EditorView;
    withTab?: boolean;
    standaloneWindow?: boolean;
  } = {},
) {
  const view = props.view ?? ({ type: "raw" } as EditorView);
  return render(
    <OuterHeader
      sessionId="session-1"
      currentView={view}
      standaloneWindow={props.standaloneWindow}
      tab={
        props.withTab
          ? {
              active: true,
              id: "session-1",
              pinned: false,
              slotId: "slot-1",
              state: { autoStart: null, view },
              type: "sessions",
            }
          : undefined
      }
    />,
  );
}

const ACTIONS = ["Record", "Join & record", "Stop"] as const;

function visibleAction() {
  const visible = ACTIONS.filter((name) =>
    screen.queryByRole("button", { name }),
  );
  expect(visible.length).toBeLessThanOrEqual(1);
  return visible[0] ?? null;
}

describe("OuterHeader", () => {
  beforeEach(() => {
    mocks.sessionModes = {};
    mocks.sessionEvents = {};
    mocks.nowMs = new Date(BEFORE).getTime();
    mocks.openUrl.mockClear();
    mocks.startListening.mockClear();
    mocks.stopListening.mockClear();
    mocks.requestMainListenerControl.mockClear();
    mocks.isMainWebviewWindow = true;
    mocks.audioExists = false;
    mocks.hasTranscriptBySession = {};
    mocks.configValues = {};
    mocks.meetingMicInUse = false;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Commencer / terminer l'écoute passent par la capsule (document vivant) :
  // l'en-tête ne propose plus que « Join & record » pour une réunion en ligne.
  it.each<[string, Scenario, (typeof ACTIONS)[number] | null]>([
    ["new ad hoc note", {}, null],
    ["active recording", { mode: "active" }, null],
    [
      "active recording past the scheduled end",
      { mode: "active", event: scheduled(MEET_LINK), now: AFTER },
      null,
    ],
    ["post-meeting transcription", { mode: "running_batch", now: AFTER }, null],
    ["finalizing", { mode: "finalizing", event: scheduled(MEET_LINK) }, null],
    // Partage retiré (cloud) : plus aucune action une fois la réunion terminée.
    ["inactive with transcript", { transcript: true }, null],
    ["meeting over", { event: scheduled(MEET_LINK), now: AFTER }, null],
    [
      "recorded event without ended_at",
      {
        event: { ...scheduled(MEET_LINK), ended_at: undefined },
        now: AFTER,
        transcript: true,
      },
      null,
    ],
    ["meeting without a link", { event: scheduled() }, null],
    [
      "meeting with an unrecognized link",
      { event: scheduled("https://naver.me/example") },
      null,
    ],
    [
      "remote meeting before start",
      { event: scheduled(MEET_LINK) },
      "Join & record",
    ],
    [
      "remote meeting before start with mic in use",
      { event: scheduled(MEET_LINK), micInUse: true },
      "Join & record",
    ],
    [
      "remote meeting after start with mic free",
      { event: scheduled(MEET_LINK), now: DURING },
      "Join & record",
    ],
    [
      "remote meeting after start with mic in use",
      { event: scheduled(MEET_LINK), now: DURING, micInUse: true },
      null,
    ],
  ])("shows the right meeting action for %s", (_label, scenario, expected) => {
    arrange(scenario);
    renderHeader();

    expect(visibleAction()).toBe(expected);
    expect(screen.getByRole("button", { name: "More" })).not.toBeNull();
  });

  it("opens the meeting link and starts listening from join & record", () => {
    arrange({ event: scheduled(MEET_LINK) });
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Join & record" }));

    expect(mocks.openUrl).toHaveBeenCalledWith(MEET_LINK, null);
    expect(mocks.startListening).toHaveBeenCalledTimes(1);
  });

  it("delegates join & record to the main window from standalone windows", () => {
    arrange({ event: scheduled(MEET_LINK) });
    mocks.isMainWebviewWindow = false;
    renderHeader({ standaloneWindow: true });

    fireEvent.click(screen.getByRole("button", { name: "Join & record" }));

    expect(mocks.requestMainListenerControl).toHaveBeenCalledWith(
      "start",
      "session-1",
    );
    expect(mocks.startListening).not.toHaveBeenCalled();
  });

  it("keeps the countdown for a scheduled meeting without a link", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T09:55:30.000Z"));
    arrange({ event: scheduled(), now: new Date().toISOString() });
    renderHeader();

    expect(visibleAction()).toBeNull();
    expect(screen.getByText("starts in 4m 30s")).not.toBeNull();
  });

  it("shows the meeting countdown before start and hides it while listening", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T09:55:30.000Z"));
    arrange({ event: scheduled(MEET_LINK), now: new Date().toISOString() });
    const { unmount } = renderHeader();

    expect(screen.getByText("starts in 4m 30s")).not.toBeNull();
    unmount();

    arrange({ mode: "active", now: new Date().toISOString() });
    renderHeader();

    expect(screen.queryByText(/starts in/)).toBeNull();
  });

  // Scheduled auto-start is owned by ScheduledMeetingAutoStart so it fires
  // regardless of which tab is open; the header must not start a second one.
  it("does not auto-start when the countdown reaches the meeting start time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T09:59:58.000Z"));
    mocks.configValues = {
      auto_start_scheduled_meetings: true,
      auto_join_scheduled_meetings: true,
    };
    arrange({ event: scheduled(MEET_LINK), now: new Date().toISOString() });
    renderHeader();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mocks.startListening).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  // Le titre est maintenant en tête du document (serif 40px), plus dans
  // l'en-tête.
  it.each<[string, Scenario]>([
    ["before recording", {}],
    ["transcript exists", { transcript: true }],
    ["listening", { mode: "active" }],
  ])("never shows the title input in the header %s", (_label, scenario) => {
    arrange(scenario);
    renderHeader({ withTab: true });

    expect(screen.queryByRole("textbox", { name: "Session title" })).toBeNull();
  });
});
