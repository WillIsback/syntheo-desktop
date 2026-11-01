// Doit précéder react-dom : React ne signale ses commits qu'à un crochet
// devtools installé avant lui.
import "~/devtools-bar/render-hook";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { memo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderTranscriptRequest } from "@syntheo/plugin-transcription";

import { RenderTranscript } from "./transcript";

import { onReactCommit } from "~/devtools-bar/render-hook";
import {
  createRenderPerfCollector,
  type RenderPerfCollector,
} from "~/devtools-bar/render-perf";
import type { Segment, SegmentWord } from "~/stt/live-segment";

const mocks = vi.hoisted(() => ({
  wordRenders: new Map<string, number>(),
  useRenderedTranscriptData: vi.fn(),
}));

vi.mock("@syntheo/plugin-transcription", () => ({
  commands: { renderTranscriptSegments: vi.fn() },
}));
vi.mock("../../search/context", () => ({ useSearch: () => null }));
vi.mock("./data-hooks", () => ({
  useRenderedTranscriptData: mocks.useRenderedTranscriptData,
  useTranscriptTimelineMetadata: () => ({
    offsetMs: 0,
    sessionId: "session-1",
  }),
}));
// Même contrat de mémoïsation que le vrai WordSpan, avec un compteur.
vi.mock("./word-span", async () => {
  const { memo: memoize } = await import("react");
  return {
    WordSpan: memoize(function CountedWordSpan(props: {
      word: SegmentWord;
      displayText: string;
    }) {
      const id = props.word.id ?? props.displayText;
      mocks.wordRenders.set(id, (mocks.wordRenders.get(id) ?? 0) + 1);
      return <span>{props.displayText}</span>;
    }),
  };
});
vi.mock("@syntheo/ui/components/ui/popover", () => ({
  AppFloatingPanel: () => null,
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
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
vi.mock("~/stt/queries", () => ({ assignTranscriptSpeaker: vi.fn() }));

const NOOP = () => {};
const NOOP_SEEK = (_seconds: number) => {};

function Harness({ liveSegments }: { liveSegments: Segment[] }) {
  return (
    <RenderTranscript
      scrollElement={null}
      isLastTranscript
      shouldScrollToEnd={false}
      transcriptId="transcript-1"
      currentActive
      liveSegments={liveSegments}
      currentMs={0}
      seek={NOOP_SEEK}
      startPlayback={NOOP}
      audioExists={false}
    />
  );
}
const StableHarness = memo(Harness);

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient();
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

function word(id: string, startMs: number, isFinal: boolean): SegmentWord {
  return {
    id,
    text: ` ${id}`,
    start_ms: startMs,
    end_ms: startMs + 90,
    channel: "MixedCapture",
    is_final: isFinal,
  };
}

function segment(
  id: string,
  speakerIndex: number,
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
    text: words.map((entry) => entry.text).join(""),
    words,
  };
}

function emptyRequest(): RenderTranscriptRequest {
  return {
    humans: [],
    participant_human_ids: [],
    self_human_id: null,
    transcripts: [{ assignments: [], started_at: null, words: [] }],
  };
}

describe("marge de transcription : partiels pendant l'écoute", () => {
  let collector: RenderPerfCollector;
  let stopCommits: () => void;

  beforeEach(() => {
    mocks.wordRenders.clear();
    mocks.useRenderedTranscriptData.mockReturnValue({
      maxSpeakerNumber: undefined,
      request: emptyRequest(),
      segments: [],
    });
    collector = createRenderPerfCollector();
    stopCommits = onReactCommit(collector.recordCommit);
  });
  afterEach(() => {
    stopCommits();
    cleanup();
  });

  it("ne re-rend que les mots provisoires quand un partiel change", () => {
    // Deux locuteurs alternés : le bloc final et le bloc vivant ne fusionnent pas.
    const finalWords = Array.from({ length: 40 }, (_, index) =>
      word(`final-${index}`, index * 100, true),
    );
    const finalSegment = segment("segment-final", 0, finalWords);
    const liveBefore = segment("segment-live", 1, [
      word("live-a", 5_000, false),
    ]);
    const view = renderWithClient(
      <StableHarness liveSegments={[finalSegment, liveBefore]} />,
    );
    mocks.wordRenders.clear();

    const liveAfter = segment("segment-live", 1, [
      liveBefore.words[0]!,
      word("live-b", 5_100, false),
    ]);
    view.rerender(<StableHarness liveSegments={[finalSegment, liveAfter]} />);

    const rendered = [...mocks.wordRenders.keys()];
    expect(rendered.filter((id) => id.startsWith("final-"))).toEqual([]);
    expect(rendered).toContain("live-b");
  });

  it("garde les lignes finales d'un même locuteur quand sa ligne provisoire bouge", () => {
    // Même locuteur : le bloc final et le partiel sont fusionnés en un seul
    // segment ; seules les phrases encore provisoires doivent être refaites.
    const sentences = Array.from({ length: 30 }, (_, index) => ({
      ...word(`final-${index}`, index * 100, true),
      text: ` phrase${index}.`,
    }));
    const finalSegment = segment("segment-final", 0, sentences);
    const liveBefore = segment("segment-live", 0, [
      word("live-a", 5_000, false),
    ]);
    const view = renderWithClient(
      <StableHarness liveSegments={[finalSegment, liveBefore]} />,
    );
    const linesBefore = document.querySelectorAll(
      "[data-transcript-segment-content] > span",
    );
    mocks.wordRenders.clear();
    collector.drain({ seq: 0, phase: "listening", elapsedMs: 0 });

    const liveAfter = segment("segment-live", 0, [
      liveBefore.words[0]!,
      word("live-b", 5_100, false),
    ]);
    view.rerender(<StableHarness liveSegments={[finalSegment, liveAfter]} />);

    const rendered = [...mocks.wordRenders.keys()];
    expect(rendered.filter((id) => id.startsWith("final-"))).toEqual([]);
    expect(rendered).toContain("live-b");
    // 30 phrases finales + la phrase provisoire : seule cette dernière est
    // refaite.
    expect(collector.rendersOf("TranscriptLine")).toBe(1);
    const linesAfter = document.querySelectorAll(
      "[data-transcript-segment-content] > span",
    );
    expect(linesAfter).toHaveLength(linesBefore.length);
    expect(linesAfter[0]).toBe(linesBefore[0]);
    expect(linesAfter[linesAfter.length - 1]?.textContent).toBe(
      " live-a live-b",
    );
  });
});
