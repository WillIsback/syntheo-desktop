import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LiveTranscriptDelta,
  LiveTranscriptSegment,
} from "@syntheo/plugin-transcription";

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
import { resetNoteTypingForTests } from "~/stt/live-display-cadence";

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

// Issue 287 : le flux natif envoie 10 à 20 événements de transcription par
// seconde. L'état les applique tous ; la marge n'en affiche que 4 par seconde.
describe("useTranscriptScreen : rythme d'affichage de la transcription", () => {
  const liveSegment = (index: number): LiveTranscriptSegment => ({
    id: "segment-live",
    key: {
      channel: "MixedCapture",
      speaker_index: null,
      speaker_human_id: null,
    },
    start_ms: 0,
    end_ms: index * 100 + 90,
    text: `mot${index}`,
    words: Array.from({ length: index + 1 }, (_, position) => ({
      id: `w-${position}`,
      text: ` mot${position}`,
      start_ms: position * 100,
      end_ms: position * 100 + 90,
      channel: "MixedCapture",
      is_final: position < index,
    })),
  });
  const transcriptDelta = (index: number): LiveTranscriptDelta => ({
    new_words: [],
    replaced_ids: [],
    partials: [
      {
        text: ` partiel${index}`,
        start_ms: index * 100,
        end_ms: index * 100 + 90,
        channel: 0,
        speaker_index: null,
      },
    ],
  });

  beforeEach(() => {
    vi.useFakeTimers();
    resetNoteTypingForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const store = createListenerStore();
    store.setState((state) => ({
      live: { ...state.live, status: "active", sessionId: "session-1" },
    }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ListenerProvider store={store}>{children}</ListenerProvider>
    );
    let renderCount = 0;
    const view = renderHook(
      () => {
        renderCount += 1;
        return useTranscriptScreen({ sessionId: "session-1" });
      },
      { wrapper },
    );
    const displayed = () =>
      view.result.current.kind === "ready"
        ? view.result.current.liveSegments
        : null;
    return { store, view, displayed, renders: () => renderCount };
  }

  function stream(
    store: ReturnType<typeof createListenerStore>,
    { from, count }: { from: number; count: number },
  ) {
    for (let index = from; index < from + count; index += 1) {
      act(() => {
        store
          .getState()
          .handleTranscriptDelta("session-1", transcriptDelta(index));
        store.getState().handleTranscriptSegmentDelta({
          upserts: [liveSegment(index)],
          removed_ids: [],
        });
        vi.advanceTimersByTime(50);
      });
    }
  }

  it("20 événements en une seconde donnent au plus 5 rendus", () => {
    const { store, renders } = setup();
    const before = renders();

    stream(store, { from: 0, count: 20 });

    expect(renders() - before).toBeLessThanOrEqual(5);
    expect(renders() - before).toBeGreaterThanOrEqual(3);
  });

  it("n'en perd aucun : le dernier affichage est l'état complet", () => {
    const { store, displayed } = setup();

    stream(store, { from: 0, count: 20 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(displayed()).toBe(store.getState().liveSegments);
    expect(displayed()?.[0]?.words).toHaveLength(20);
  });

  it("ralentit pendant la frappe dans les notes", () => {
    const { store, renders } = setup();
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    document.body.append(editor);
    const before = renders();

    for (let index = 0; index < 40; index += 1) {
      if (index % 4 === 0) {
        editor.dispatchEvent(
          new KeyboardEvent("keydown", { key: "a", bubbles: true }),
        );
      }
      stream(store, { from: index, count: 1 });
    }

    // 2 s de frappe : 2 rendus par seconde, plus le premier.
    expect(renders() - before).toBeLessThanOrEqual(5);
    editor.remove();
  });

  it("ne rend rien fenêtre masquée et rattrape tout au retour", () => {
    const { store, renders, displayed } = setup();
    const visibility = (hidden: boolean) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    // La transcription est déjà affichée quand la fenêtre est masquée.
    stream(store, { from: 0, count: 1 });
    visibility(true);
    const before = renders();

    stream(store, { from: 1, count: 40 });
    expect(renders()).toBe(before);

    act(() => {
      visibility(false);
      vi.advanceTimersByTime(0);
    });
    expect(renders()).toBe(before + 1);
    expect(displayed()).toBe(store.getState().liveSegments);
    visibility(false);
  });

  it("affiche aussitôt la fin de l'écoute", () => {
    const { store, displayed } = setup();
    stream(store, { from: 0, count: 3 });

    act(() => {
      store.getState().handleTranscriptSegmentDelta({
        upserts: [liveSegment(3)],
        removed_ids: [],
      });
      store.setState((state) => ({
        live: { ...state.live, status: "inactive" },
      }));
    });

    expect(displayed()).toBe(store.getState().liveSegments);
  });
});
