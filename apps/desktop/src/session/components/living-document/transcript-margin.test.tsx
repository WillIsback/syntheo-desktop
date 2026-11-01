// Doit précéder react-dom : React ne signale ses commits qu'à un crochet
// devtools installé avant lui.
import "~/devtools-bar/render-hook";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderTranscriptRequest } from "@syntheo/plugin-transcription";

import { TranscriptMargin } from "./transcript-margin";

import { onReactCommit } from "~/devtools-bar/render-hook";
import {
  createRenderPerfCollector,
  type RenderPerfCollector,
} from "~/devtools-bar/render-perf";
import type { TranscriptScreen } from "~/session/components/note-input/transcript/state";
import type { Segment, SegmentWord } from "~/stt/live-segment";

// Mesure de l'issue #279 : pendant l'écoute, la marge de transcription
// redessinait toute la transcription à chaque partiel. Le test monte la vraie
// marge (TranscriptMargin → Transcript → TranscriptViewer, avec son conteneur
// de défilement) et ne remplace que les sources de données.

const mocks = vi.hoisted(() => ({
  screen: null as TranscriptScreen | null,
  renderedSegments: [] as Segment[],
}));

vi.mock("~/session/components/note-input/transcript/state", () => ({
  useTranscriptScreen: () => mocks.screen,
}));
vi.mock(
  "~/session/components/note-input/transcript/renderer/data-hooks",
  () => ({
    useRenderedTranscriptData: () => ({
      maxSpeakerNumber: undefined,
      request: emptyRequest(),
      segments: mocks.renderedSegments,
    }),
    useTranscriptTimelineMetadata: () => ({
      offsetMs: 0,
      sessionId: "session-1",
    }),
  }),
);
vi.mock("~/stt/contexts", () => ({
  useListener: (selector: (state: unknown) => unknown) =>
    selector({ stopTranscription: vi.fn(), live: { degraded: false } }),
}));
vi.mock("~/stt/capture-result", () => ({
  useIncompleteCapture: () => null,
}));
vi.mock("~/stt/useUploadFile", () => ({
  useUploadFile: () => ({ uploadAudio: vi.fn(), uploadTranscript: vi.fn() }),
}));
vi.mock("~/settings/queries", () => ({
  useStoredSettingValue: () => ({ value: null }),
}));
vi.mock("@syntheo/plugin-transcription", () => ({
  commands: { renderTranscriptSegments: vi.fn() },
}));
vi.mock("@syntheo/ui/components/ui/popover", () => ({
  AppFloatingPanel: () => null,
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("~/calendar/queries", () => ({
  useSessionEventParticipants: () => [],
}));
vi.mock("~/contacts/queries", () => ({
  createHuman: vi.fn(),
  useHumans: () => [],
}));
vi.mock("~/session/queries", () => ({
  addSessionParticipant: vi.fn(),
  useSession: () => null,
  useSessionParticipants: () => [],
}));
vi.mock("~/stt/queries", () => ({
  assignTranscriptSpeaker: vi.fn(),
  mergeTranscriptSegments: vi.fn(),
  splitTranscriptSpeaker: vi.fn(),
  updateTranscriptSegmentText: vi.fn(),
}));

const VIEWPORT_HEIGHT = 300;

function emptyRequest(): RenderTranscriptRequest {
  return {
    humans: [],
    participant_human_ids: [],
    self_human_id: null,
    transcripts: [{ assignments: [], started_at: null, words: [] }],
  };
}

function word(
  id: string | undefined,
  text: string,
  startMs: number,
  isFinal: boolean,
): SegmentWord {
  return {
    ...(id ? { id } : {}),
    text,
    start_ms: startMs,
    end_ms: startMs + 90,
    channel: "MixedCapture",
    is_final: isFinal,
  } as SegmentWord;
}

// Une phrase finale de six mots, terminée par un point.
function sentence(index: number): SegmentWord[] {
  return Array.from({ length: 6 }, (_, position) =>
    word(
      `w-${index}-${position}`,
      position === 5 ? ` mot${position}.` : ` mot${position}`,
      index * 1_000 + position * 100,
      true,
    ),
  );
}

function segment(
  id: string,
  speakerIndex: number | null,
  words: SegmentWord[],
): Segment {
  return {
    id,
    key: {
      channel: "MixedCapture",
      speaker_index: speakerIndex,
      speaker_human_id: null,
    },
    start_ms: words[0]!.start_ms,
    end_ms: words[words.length - 1]!.end_ms,
    text: words
      .map((entry) => entry.text)
      .join("")
      .trim(),
    words,
  };
}

// Comme l'IPC Tauri : chaque segment reçu du natif est un objet neuf, mots
// compris, même quand seul le dernier mot a changé.
function fromNative<T>(value: T): T {
  return structuredClone(value);
}

function liveScreen(liveSegments: Segment[]): TranscriptScreen {
  return {
    kind: "ready",
    transcriptIds: ["transcript-1"],
    liveSegments,
    currentActive: true,
    captureGeneration: 0,
    liveTranscriptInterrupted: false,
  };
}

function settledScreen(): TranscriptScreen {
  return {
    kind: "ready",
    transcriptIds: ["transcript-1"],
    liveSegments: [],
    currentActive: false,
    captureGeneration: 0,
    liveTranscriptInterrupted: false,
  };
}

// jsdom n'a pas de mise en page : le conteneur de défilement de la marge
// mesure VIEWPORT_HEIGHT px, son contenu la hauteur de la liste virtuelle.
function simulateScrollLayout() {
  const scrollTops = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-transcript-container")
        ? VIEWPORT_HEIGHT
        : 0;
    },
  );
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
    function (this: Element) {
      let total = 0;
      for (const list of this.querySelectorAll<HTMLElement>(
        "[data-transcript-virtual-total]",
      )) {
        total += Number.parseFloat(list.style.height) || 0;
      }
      return total;
    },
  );
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (
    this: Element,
  ) {
    return scrollTops.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    value: number,
  ) {
    // Comme un navigateur : la position est bornée par le contenu.
    const max = Math.max(0, this.scrollHeight - this.clientHeight);
    scrollTops.set(this, Math.max(0, Math.min(max, value)));
    this.dispatchEvent(new Event("scroll"));
  });
  // La liste défile avec son conteneur : son bord haut remonte de scrollTop.
  const realRect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const container = this.closest("[data-transcript-container]");
      if (!container || container === this) return realRect.call(this);
      const top = -(scrollTops.get(container) ?? 0);
      return DOMRect.fromRect({ x: 0, y: top, width: 280, height: 0 });
    },
  );
  Element.prototype.scrollTo = function (
    this: Element,
    options?: ScrollToOptions | number,
  ) {
    const top = typeof options === "object" ? (options.top ?? 0) : 0;
    this.scrollTop = top;
  } as Element["scrollTo"];
}

async function flushFrames() {
  await act(async () => {
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
}

function zoneRenders(lines: string[], zone: string): number {
  const line = lines.find((entry) =>
    entry.includes(` zone seq=`) ? entry.includes(`name=${zone} `) : false,
  );
  return Number(line?.match(/renders=(\d+)/)?.[1] ?? 0);
}

describe("marge de transcription pendant l'écoute (#279)", () => {
  let collector: RenderPerfCollector;
  let stopCommits: () => void;
  let client: QueryClient;
  let seq = 0;

  const ui = () => (
    <QueryClientProvider client={client}>
      <TranscriptMargin sessionId="session-1" />
    </QueryClientProvider>
  );

  // Rendus de la marge pour une seule mise à jour, une fois le défilement et
  // les mesures stabilisés.
  async function measure(update: () => void) {
    collector.drain({ seq: seq++, phase: "listening", elapsedMs: 0 });
    update();
    await flushFrames();
    // Le résumé ne garde que les composants les plus rendus : les compteurs
    // sont lus avant de le vider.
    const counts = {
      rows: collector.rendersOf("VirtualSegmentRow"),
      blocks: collector.rendersOf("SegmentRenderer"),
      lines: collector.rendersOf("TranscriptLine"),
      words: collector.rendersOf("WordSpan"),
    };
    const summary = collector.drain({
      seq: seq++,
      phase: "listening",
      elapsedMs: 0,
    });
    return { margin: zoneRenders(summary, "transcript-margin"), ...counts };
  }

  function liveWords(count: number, startMs: number): SegmentWord[] {
    return Array.from({ length: count }, (_, index) =>
      word(undefined, ` vivant${index}`, startMs + index * 100, false),
    );
  }

  // Sans diarisation, le natif rend toute la réunion en un seul segment
  // (crates/listener-core, build_segments) et le renvoie entier, mots
  // compris, à chaque partiel.
  function singleSpeaker(size: number) {
    const finals = Array.from({ length: size }, (_, index) =>
      sentence(index),
    ).flat();
    return (partials: number) =>
      fromNative([
        segment("turn-0", null, [
          ...finals,
          ...liveWords(partials, size * 1_000),
        ]),
      ]);
  }

  // Avec plusieurs locuteurs, un segment par tour de parole ; le natif
  // renvoie toute sa fenêtre quand il réétiquette les locuteurs.
  function manySpeakers(size: number) {
    const finals = Array.from({ length: size }, (_, index) =>
      segment(`segment-${index}`, index % 2, sentence(index)),
    );
    return (partials: number) =>
      fromNative([
        ...finals,
        segment("segment-live", size % 2, liveWords(partials, size * 1_000)),
      ]);
  }

  const rows = () =>
    document.querySelectorAll<HTMLElement>("[data-transcript-virtual-index]");

  // Monte la marge sur une réunion de `size` blocs, puis mesure trois
  // partiels successifs.
  async function listen(
    meeting: (size: number) => (partials: number) => Segment[],
    size: number,
  ) {
    const at = meeting(size);
    mocks.screen = liveScreen(at(1));
    const view = render(ui());
    await flushFrames();

    // Défilement automatique : la fin de la transcription est à l'écran.
    expect(rows()[rows().length - 1]?.textContent).toContain("vivant0");

    const partials = [];
    for (let count = 2; count <= 4; count += 1) {
      partials.push(
        await measure(() => {
          mocks.screen = liveScreen(at(count));
          view.rerender(ui());
        }),
      );
      expect(rows()[rows().length - 1]?.textContent).toContain(
        `vivant${count - 1}`,
      );
    }
    const mounted = rows().length;
    view.unmount();
    return { partials, rows: mounted };
  }

  beforeEach(() => {
    client = new QueryClient();
    mocks.renderedSegments = [];
    collector = createRenderPerfCollector();
    stopCommits = onReactCommit((root) => {
      collector.recordCommit(root);
    });
    simulateScrollLayout();
  });
  afterEach(() => {
    stopCommits();
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ["un seul locuteur", singleSpeaker],
    ["plusieurs locuteurs", manySpeakers],
  ])(
    "%s : un partiel ne redessine que la phrase vivante, au même coût avec 50 ou 1 000 blocs",
    async (_name, meeting) => {
      const short = await listen(meeting, 50);
      const long = await listen(meeting, 1_000);

      for (const [index, partial] of long.partials.entries()) {
        // Seul le bloc vivant est refait : les blocs finaux, visibles ou non,
        // gardent leur rendu. Dans ce bloc, seule la phrase provisoire est
        // refaite, avec ses seuls mots.
        expect(partial.rows).toBe(1);
        expect(partial.blocks).toBe(1);
        expect(partial.lines).toBe(1);
        expect(partial.words).toBeLessThanOrEqual(index + 2);
        // Coût constant : la longueur de la réunion n'y change rien.
        expect(partial).toEqual(short.partials[index]);
      }
      // Virtualisation : les blocs montés sont bornés par la fenêtre.
      expect(long.rows).toBe(short.rows);
      expect(long.rows).toBeLessThan(40);
    },
  );

  it("à l'arrêt, la finalisation puis le rechargement depuis la base ne redessinent que la fin", async () => {
    const finals = Array.from({ length: 300 }, (_, index) =>
      sentence(index),
    ).flat();
    const lastWords = liveWords(3, 300_000);
    mocks.screen = liveScreen(
      fromNative([segment("turn-0", null, [...finals, ...lastWords])]),
    );
    const view = render(ui());
    await flushFrames();

    // Arrêt : la transcription est relue depuis la base et rendue par le
    // natif ; les partiels sont devenus des mots finaux.
    const settledWords = [
      ...finals,
      ...lastWords.map((entry, index) => ({
        ...entry,
        id: `final-${index}`,
        is_final: true,
      })),
    ];
    const stop = await measure(() => {
      mocks.screen = settledScreen();
      mocks.renderedSegments = fromNative([
        segment("turn-0", null, settledWords),
      ]);
      view.rerender(ui());
    });
    expect(stop.lines).toBe(1);
    expect(stop.words).toBeLessThanOrEqual(lastWords.length);

    // Chaque écriture en base (attributions, compte-rendu) relance le rendu
    // natif : mêmes mots, objets neufs.
    const reload = await measure(() => {
      mocks.renderedSegments = fromNative([
        segment("turn-0", null, settledWords),
      ]);
      view.rerender(ui());
    });
    expect(reload.lines).toBe(0);
    expect(reload.words).toBe(0);
  });
});
