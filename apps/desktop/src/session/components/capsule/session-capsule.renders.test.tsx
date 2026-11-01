// Doit précéder react-dom : React ne signale ses commits qu'à un crochet
// devtools installé avant lui.
import "~/devtools-bar/render-hook";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionCapsule } from "./session-capsule";

import { onReactCommit } from "~/devtools-bar/render-hook";
import {
  createRenderPerfCollector,
  type RenderPerfCollector,
} from "~/devtools-bar/render-perf";
import { createListenerStore } from "~/store/zustand/listener";
import type { Tab } from "~/store/zustand/tabs";
import { ListenerProvider } from "~/stt/contexts";

vi.mock("~/stt/detect-events", () => ({ useHandleDetectEvents: vi.fn() }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));
vi.mock("motion/react", () => ({ useReducedMotion: () => false }));
vi.mock("~/contexts/shell", () => ({
  useShell: () => ({ chat: { mode: "FloatingClosed", sendEvent: vi.fn() } }),
}));
vi.mock("~/stt/useStartListening", () => ({
  useStartListening: () => vi.fn(),
}));
vi.mock("~/stt/window-control", () => ({
  isMainWebviewWindow: () => true,
  requestMainListenerControl: vi.fn(),
}));
vi.mock("~/shared/leave-overlay-tab", () => ({ leaveOverlayTab: vi.fn() }));
vi.mock("~/session/queries", () => ({
  useSession: () => ({ raw_md: "" }),
  useEnhancedNote: () => undefined,
}));
vi.mock("~/session/components/note-input/header-shared", () => ({
  copyTextToClipboard: vi.fn(),
  getStoredNoteMarkdown: (content: string | undefined) => content ?? "",
}));
vi.mock("~/session/components/outer-header/overflow/export-modal", () => ({
  ExportModal: () => null,
}));

const tab = {
  type: "sessions",
  id: "session-1",
  active: true,
  pinned: false,
  slotId: "slot-1",
  state: { view: null, autoStart: null },
} as Extract<Tab, { type: "sessions" }>;

function meterScales() {
  return [...document.querySelectorAll("[data-level-meter] i")].map(
    (bar) => (bar as HTMLElement).style.transform,
  );
}

describe("SessionCapsule pendant l'écoute", () => {
  let collector: RenderPerfCollector;
  let stopCommits: () => void;

  beforeEach(() => {
    collector = createRenderPerfCollector();
    stopCommits = onReactCommit(collector.recordCommit);
  });
  afterEach(() => {
    stopCommits();
    cleanup();
  });

  function renderListening() {
    const store = createListenerStore();
    store.setState((state) => ({
      live: { ...state.live, sessionId: "session-1", status: "active" },
    }));
    render(
      <ListenerProvider store={store}>
        <SessionCapsule
          tab={tab}
          stage="listen"
          currentView={{ type: "raw" }}
        />
      </ListenerProvider>,
    );
    collector.drain({ seq: 0, phase: "listening", elapsedMs: 0 });
    return store;
  }

  it("ne redessine que le vumètre quand le niveau sonore change", () => {
    const store = renderListening();
    const before = meterScales();

    for (let tick = 1; tick <= 10; tick += 1) {
      act(() => {
        store.setState((state) => ({
          live: {
            ...state.live,
            amplitude: { mic: tick / 20, speaker: 0 },
          },
        }));
      });
    }

    expect(collector.rendersOf("SessionCapsule")).toBe(0);
    expect(collector.rendersOf("NoteCapsule")).toBe(0);
    expect(collector.rendersOf("CapsuleButton")).toBe(0);
    expect(collector.rendersOf("SessionLevelMeter")).toBe(10);
    // Le vumètre bouge toujours.
    expect(meterScales()).not.toEqual(before);
  });

  it("ne redessine que le chrono à chaque seconde", () => {
    const store = renderListening();

    act(() => {
      store.setState((state) => ({ live: { ...state.live, seconds: 65 } }));
    });

    expect(collector.rendersOf("SessionCapsule")).toBe(0);
    expect(collector.rendersOf("NoteCapsule")).toBe(0);
    expect(collector.rendersOf("SessionElapsed")).toBe(1);
    expect(screen.getByRole("timer").textContent).toBe("01:05");
  });
});
