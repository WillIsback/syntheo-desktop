import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderTranscriptRequest } from "@syntheo/plugin-transcription";

import { PARAGRAPH_MAX_SENTENCES } from "./paragraphs";
import { RenderTranscript } from "./transcript";

import type { Segment, SegmentWord } from "~/stt/live-segment";

// Issue 281 : le flux d'un même locuteur est affiché en paragraphes. Le découpage
// n'est qu'un affichage : en-tête, recherche et clic sur un mot se
// comportent comme sur le segment entier.

const mocks = vi.hoisted(() => ({
  segments: [] as Segment[],
  search: null as null | {
    activeMatchId: string | null;
    caseSensitive: boolean;
    isVisible: boolean;
    query: string;
    wholeWord: boolean;
  },
}));

vi.mock("@syntheo/plugin-transcription", () => ({
  commands: { renderTranscriptSegments: vi.fn() },
}));
vi.mock("../../search/context", () => ({ useSearch: () => mocks.search }));
vi.mock("./data-hooks", () => ({
  useRenderedTranscriptData: () => ({
    maxSpeakerNumber: undefined,
    request: emptyRequest(),
    segments: mocks.segments,
  }),
  useTranscriptTimelineMetadata: () => ({
    offsetMs: 5_000,
    sessionId: "session-1",
  }),
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
  splitTranscriptSpeaker: vi.fn(),
  updateTranscriptSegmentText: vi.fn(),
}));

function emptyRequest(): RenderTranscriptRequest {
  return {
    humans: [],
    participant_human_ids: [],
    self_human_id: null,
    transcripts: [{ assignments: [], started_at: null, words: [] }],
  };
}

// `count` phrases de six mots, sans pause : une seule prise de parole.
function monologue(count: number): Segment {
  const words: SegmentWord[] = Array.from({ length: count }, (_, sentence) =>
    Array.from({ length: 6 }, (_, position) => ({
      id: `w-${sentence}-${position}`,
      text: position === 5 ? ` fin${sentence}.` : ` mot${sentence}x${position}`,
      start_ms: sentence * 1_000 + position * 100,
      end_ms: sentence * 1_000 + position * 100 + 90,
      channel: "MixedCapture" as const,
      is_final: true,
    })),
  ).flat();
  return {
    id: "turn-0",
    key: { channel: "MixedCapture", speaker_index: 0, speaker_human_id: null },
    start_ms: 0,
    end_ms: words[words.length - 1]!.end_ms,
    text: words
      .map((word) => word.text)
      .join("")
      .trim(),
    words,
  };
}

function createScrollElement() {
  const element = document.createElement("div");
  const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
  Object.defineProperties(element, {
    clientHeight: { value: 600 },
    scrollTop: { value: 0, writable: true },
    scrollTo: { value: scrollTo },
  });
  document.body.append(element);
  return { element, scrollTo };
}

function renderTranscript({
  scrollElement = null,
  seek = vi.fn(),
  editMode = false,
}: {
  scrollElement?: HTMLDivElement | null;
  seek?: (sec: number) => void;
  editMode?: boolean;
} = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <RenderTranscript
        scrollElement={scrollElement}
        isLastTranscript
        shouldScrollToEnd={false}
        transcriptId="transcript-1"
        currentActive={false}
        liveSegments={[]}
        currentMs={0}
        seek={seek}
        startPlayback={vi.fn()}
        audioExists
        editMode={editMode}
      />
    </QueryClientProvider>,
    scrollElement ? { container: scrollElement } : undefined,
  );
}

const sections = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      "section[data-transcript-segment-id]",
    ),
  );

describe("paragraphes d'une même prise de parole (issue 281)", () => {
  beforeEach(() => {
    mocks.search = null;
    mocks.segments = [monologue(PARAGRAPH_MAX_SENTENCES * 4)];
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("n'affiche l'en-tête du locuteur que sur le premier paragraphe", () => {
    renderTranscript();

    const rendered = sections();
    expect(rendered).toHaveLength(4);
    expect(
      rendered.map(
        (section) =>
          section.querySelectorAll("[data-transcript-speaker-assign]").length,
      ),
    ).toEqual([1, 0, 0, 0]);
    // Un seul segment : tous les paragraphes en portent l'identité.
    expect(
      new Set(rendered.map((section) => section.dataset.transcriptSegmentId))
        .size,
    ).toBe(1);
    // Une sélection qui traverse deux paragraphes garde l'espace entre eux.
    expect(
      rendered[1]!.querySelector("[data-transcript-segment-content]")
        ?.textContent,
    ).toMatch(new RegExp(`^ mot${PARAGRAPH_MAX_SENTENCES}x0 `));
  });

  it("garde le segment entier en mode édition", () => {
    renderTranscript({ editMode: true });

    expect(sections()).toHaveLength(1);
    expect(document.querySelectorAll("[data-transcript-editor]")).toHaveLength(
      1,
    );
  });

  it("monte et centre un résultat de recherche situé dans un paragraphe non initial", () => {
    mocks.segments = [monologue(PARAGRAPH_MAX_SENTENCES * 200)];
    const target = `w-${PARAGRAPH_MAX_SENTENCES * 150 + 2}-3`;
    mocks.search = {
      activeMatchId: target,
      caseSensitive: false,
      isVisible: true,
      query: `mot${PARAGRAPH_MAX_SENTENCES * 150 + 2}x3`,
      wholeWord: false,
    };
    const { element: scrollElement, scrollTo } = createScrollElement();

    renderTranscript({ scrollElement });

    const word = document.querySelector<HTMLElement>(
      `[data-transcript-word-id='${target}']`,
    );
    expect(word).toBeTruthy();
    // Le mot est surligné comme résultat actif.
    expect(word!.querySelector(".bg-chart-3\\/35")?.textContent).toBe(
      `mot${PARAGRAPH_MAX_SENTENCES * 150 + 2}x3`,
    );
    // Il est dans un paragraphe de suite, sans en-tête.
    const section = word!.closest("section")!;
    expect(section.querySelector("[data-transcript-speaker-assign]")).toBe(
      null,
    );
    expect(scrollTo).toHaveBeenCalled();
    expect(scrollTo.mock.lastCall?.[0].top ?? 0).toBeGreaterThan(0);
  });

  it("lance la lecture au clic sur un mot d'un paragraphe non initial", () => {
    const seek = vi.fn();
    renderTranscript({ seek });

    const word = document.querySelector<HTMLElement>(
      `[data-transcript-word-id='w-${PARAGRAPH_MAX_SENTENCES * 2 + 1}-2']`,
    )!;
    expect(
      word
        .closest("section")!
        .querySelector("[data-transcript-speaker-assign]"),
    ).toBe(null);
    fireEvent.click(word);

    expect(seek).toHaveBeenCalledWith(
      (5_000 + (PARAGRAPH_MAX_SENTENCES * 2 + 1) * 1_000 + 200) / 1_000,
    );
  });
});
