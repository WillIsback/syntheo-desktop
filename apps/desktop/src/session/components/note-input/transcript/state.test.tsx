import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  metadata: [
    {
      id: "transcript-1",
      sessionId: "session-1",
      startedAt: 0,
      hasWords: true,
    },
  ],
}));

vi.mock("~/stt/detect-events", () => ({
  useHandleDetectEvents: vi.fn(),
}));

vi.mock("~/stt/queries", () => ({
  useSessionTranscriptMetadata: () => mocks.metadata,
}));

import { useTranscriptScreen } from "./state";

import { createListenerStore } from "~/store/zustand/listener";
import { ListenerProvider } from "~/stt/contexts";

describe("useTranscriptScreen subscriptions", () => {
  it("does not rerender for amplitude-only listener updates", () => {
    const store = createListenerStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ListenerProvider store={store}>{children}</ListenerProvider>
    );
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount += 1;
        return useTranscriptScreen({ sessionId: "session-1" });
      },
      { wrapper },
    );
    const initialRenderCount = renderCount;

    act(() => {
      store.setState((state) => ({
        live: { ...state.live, amplitude: { mic: 0.5, speaker: 0.25 } },
      }));
    });

    expect(renderCount).toBe(initialRenderCount);
    expect(result.current.kind).toBe("ready");

    act(() => {
      store.setState((state) => ({
        live: {
          ...state.live,
          captureGenerationBySession: { "session-1": 1 },
        },
      }));
    });

    expect(renderCount).toBe(initialRenderCount + 1);
  });

  it("keeps the same transcriptIds array while the ids do not change", () => {
    const store = createListenerStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ListenerProvider store={store}>{children}</ListenerProvider>
    );
    const { result, rerender } = renderHook(
      () => useTranscriptScreen({ sessionId: "session-1" }),
      { wrapper },
    );
    const screenIds = () =>
      result.current.kind === "ready" ? result.current.transcriptIds : null;
    const initialIds = screenIds();

    // La requête SQLite renvoie un nouveau tableau à chaque écriture.
    mocks.metadata = mocks.metadata.map((entry) => ({ ...entry }));
    rerender();
    expect(screenIds()).toBe(initialIds);

    mocks.metadata = [
      ...mocks.metadata,
      {
        id: "transcript-2",
        sessionId: "session-1",
        startedAt: 1,
        hasWords: true,
      },
    ];
    rerender();
    expect(screenIds()).toEqual(["transcript-1", "transcript-2"]);
  });
});
