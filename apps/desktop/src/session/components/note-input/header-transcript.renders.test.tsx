// Doit précéder react-dom : React ne signale ses commits qu'à un crochet
// devtools installé avant lui.
import "~/devtools-bar/render-hook";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeaderViewTranscript } from "./header-transcript";

import { onReactCommit } from "~/devtools-bar/render-hook";
import { createRenderPerfCollector } from "~/devtools-bar/render-perf";
import { createListenerStore } from "~/store/zustand/listener";
import { ListenerProvider } from "~/stt/contexts";

vi.mock("~/stt/detect-events", () => ({ useHandleDetectEvents: vi.fn() }));
vi.mock("~/session/components/shared", () => ({
  useHasTranscript: () => false,
}));
vi.mock("~/stt/queries", () => ({
  useSessionTranscriptMetadata: () => [],
}));
vi.mock("~/session/components/note-input/transcript/export-data", () => ({
  buildTranscriptExportSegments: vi.fn(),
  formatTranscriptExportSegments: vi.fn(),
}));
vi.mock(
  "~/session/components/note-input/transcript/render-request-hooks",
  () => ({ getSessionTranscriptRenderRequest: vi.fn() }),
);
vi.mock("~/shared/hooks/useNativeContextMenu", () => ({
  useNativeContextMenu: () => vi.fn(),
}));
vi.mock("~/stt/useStartListeningWithBatchOverride", () => ({
  useStartListeningWithBatchOverride: () => vi.fn(),
}));
vi.mock("~/stt/window-control", () => ({
  isMainWebviewWindow: () => true,
  requestMainListenerControl: vi.fn(),
}));

afterEach(cleanup);

describe("HeaderViewTranscript pendant l'écoute", () => {
  it("ne redessine que l'icône animée quand le niveau sonore change", () => {
    const store = createListenerStore();
    store.setState((state) => ({
      live: { ...state.live, sessionId: "session-1", status: "active" },
    }));
    render(
      <ListenerProvider store={store}>
        <HeaderViewTranscript
          isActive
          isTranscribing={false}
          sessionId="session-1"
        />
      </ListenerProvider>,
    );
    const collector = createRenderPerfCollector();
    const stop = onReactCommit(collector.recordCommit);

    for (let tick = 1; tick <= 5; tick += 1) {
      act(() => {
        store.setState((state) => ({
          live: { ...state.live, amplitude: { mic: tick / 10, speaker: 0 } },
        }));
      });
    }
    stop();

    expect(collector.rendersOf("HeaderViewTranscript")).toBe(0);
    expect(collector.rendersOf("HeaderViewTranscriptActive")).toBe(0);
    expect(collector.rendersOf("LiveDancingSticks")).toBe(5);
  });
});
