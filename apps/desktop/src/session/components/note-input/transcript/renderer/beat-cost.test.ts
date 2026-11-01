import { renderHook } from "@testing-library/react";
import { useMemo } from "react";
import { describe, expect, it } from "vitest";

import type {
  RenderTranscriptRequest,
  RenderTranscriptWordInput,
} from "@syntheo/plugin-transcription";

import { useTranscriptParagraphs } from "./paragraphs";
import { createSegmentKeys, useStableSegments } from "./segment-hooks";
import { useVirtualSegments } from "./virtual-segments";

import {
  type Segment,
  type SegmentKey,
  type SegmentWord,
} from "~/stt/live-segment";
import { mergeRenderedAndLiveSegments } from "~/stt/live-segment-merge";
import {
  applyRenderRequestIdentitiesToSegments,
  mergeAdjacentSpeakerSegments,
} from "~/stt/live-segment-runs";

// Issue 287 : sur une session de 2 h, le coût d'un battement d'affichage ne
// doit pas dépendre de la longueur de ce qui est déjà affiché. On mesure les
// lectures de propriétés (texte, horodatages, identifiants) sur les mots de
// l'historique pendant un battement : c'est le travail par mot (comparaisons,
// découpage en phrases, concaténation de texte, estimation des hauteurs).
// Copier un tableau de références ne lit aucun mot et n'est pas compté.

const WORDS_PER_PHRASE = 6;
const PHRASES_PER_TURN = 5;

let countingReads = false;
let reads = 0;

function counted<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (countingReads && typeof property === "string") reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
}

function key(speakerIndex: number): SegmentKey {
  return {
    channel: "MixedCapture",
    speaker_index: speakerIndex,
    speaker_human_id: null,
  };
}

function phraseWords(
  prefix: string,
  phrase: number,
  isFinal: boolean,
): SegmentWord[] {
  return Array.from({ length: WORDS_PER_PHRASE }, (_, position) => ({
    id: isFinal ? `${prefix}-${phrase}-${position}` : undefined,
    text:
      position === WORDS_PER_PHRASE - 1
        ? ` mot${position}.`
        : ` mot${position}`,
    start_ms: phrase * 1_000 + position * 100,
    end_ms: phrase * 1_000 + position * 100 + 90,
    channel: "MixedCapture",
    is_final: isFinal,
  })) as SegmentWord[];
}

function segmentOf(id: string, speaker: number, words: SegmentWord[]): Segment {
  return {
    id,
    key: key(speaker),
    start_ms: words[0]!.start_ms,
    end_ms: words[words.length - 1]!.end_ms,
    text: words
      .map((word) => word.text)
      .join("")
      .trim(),
    words,
  };
}

type Scenario = {
  stored: Segment[];
  request: RenderTranscriptRequest;
  live: (beat: number) => Segment[];
};

// `phrases` phrases déjà transcrites (rendu persisté), puis la fenêtre
// vivante du natif : deux phrases finales et une provisoire, en objets neufs
// à chaque battement comme par l'IPC.
function scenario(phrases: number, diarized: boolean): Scenario {
  const speakerOf = (phrase: number) =>
    diarized ? Math.floor(phrase / PHRASES_PER_TURN) % 2 : 0;
  const stored: Segment[] = [];
  const requestWords: RenderTranscriptWordInput[] = [];
  let turn: SegmentWord[] = [];
  const flush = (phrase: number) => {
    if (turn.length === 0) return;
    stored.push(segmentOf(`stored-${phrase}`, speakerOf(phrase - 1), turn));
    turn = [];
  };
  for (let phrase = 0; phrase < phrases; phrase += 1) {
    if (phrase > 0 && speakerOf(phrase) !== speakerOf(phrase - 1)) {
      flush(phrase);
    }
    for (const word of phraseWords("h", phrase, true)) {
      turn.push(counted(word));
      requestWords.push(
        counted({
          id: word.id!,
          text: word.text,
          start_ms: word.start_ms,
          end_ms: word.end_ms,
          channel: 2,
        }),
      );
    }
  }
  flush(phrases);

  const request: RenderTranscriptRequest = {
    humans: [],
    participant_human_ids: [],
    self_human_id: null,
    transcripts: [{ assignments: [], started_at: 0, words: requestWords }],
  };
  const liveSpeaker = speakerOf(phrases - 1);
  const live = (beat: number) => {
    const words = [
      ...phraseWords("l", phrases, true),
      ...phraseWords("l", phrases + 1, true),
      ...phraseWords("l", phrases + 2, false).slice(0, 1 + (beat % 5)),
    ];
    return [segmentOf(`live-${beat}`, liveSpeaker, words)];
  };
  return { stored, request, live };
}

// Le traitement d'un battement pendant l'écoute, de la fusion des segments
// au découpage en paragraphes (PersistedTranscript et SegmentsList).
function useBeat(
  stored: Segment[],
  live: Segment[],
  request: RenderTranscriptRequest,
) {
  const merged = mergeAdjacentSpeakerSegments(
    applyRenderRequestIdentitiesToSegments(
      mergeRenderedAndLiveSegments(stored, live, request),
      request,
    ),
  );
  const segments = useStableSegments(merged);
  const paragraphs = useTranscriptParagraphs(segments, true);
  createSegmentKeys(segments, "transcript-1");
  const rows = useMemo(
    () => paragraphs.map((paragraph) => paragraph.segment),
    [paragraphs],
  );
  const continuations = useMemo(
    () => paragraphs.map((paragraph) => paragraph.continuation),
    [paragraphs],
  );
  const rowKeys = useMemo(
    () => createSegmentKeys(rows, "transcript-1"),
    [rows],
  );
  useVirtualSegments({
    segments: rows,
    segmentKeys: rowKeys,
    continuations,
    scrollElement: null,
    activeMatchId: null,
    searchEnabled: false,
    currentMs: 0,
    offsetMs: 0,
  });
  return paragraphs;
}

// Copie profonde en objets neufs : aucun cache ne s'y applique.
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readsPerBeat(phrases: number, diarized: boolean): number {
  const { stored, request, live } = scenario(phrases, diarized);
  const view = renderHook(
    ({ liveSegments }) => useBeat(stored, liveSegments, request),
    { initialProps: { liveSegments: live(0) } },
  );
  view.rerender({ liveSegments: live(1) });

  countingReads = true;
  reads = 0;
  view.rerender({ liveSegments: live(2) });
  countingReads = false;
  view.unmount();
  return reads;
}

describe("coût d'un battement d'affichage selon la longueur de la réunion", () => {
  it.each([
    ["un seul locuteur", false],
    ["plusieurs locuteurs", true],
  ])("%s : le même à 50 et à 5 000 phrases", (_label, diarized) => {
    // Avant : 7 116 et 712 986 lectures (un locuteur), 9 510 et 978 720
    // (plusieurs) ; le coût croissait avec la réunion.
    const short = readsPerBeat(50, diarized);
    const long = readsPerBeat(5_000, diarized);

    expect(long).toBe(short);
    expect(long).toBe(0);
  });

  it.each([
    ["un seul locuteur", false],
    ["plusieurs locuteurs", true],
  ])(
    "%s : les caches donnent le même affichage qu'un calcul complet",
    (_label, diarized) => {
      const { stored, request, live } = scenario(300, diarized);
      const describe = (paragraphs: ReturnType<typeof useBeat>) =>
        paragraphs.map(({ segment, segmentIndex, continuation }) => ({
          text: segment.text,
          words: segment.words.map((word) => word.text),
          segmentIndex,
          continuation,
        }));
      const incremental = renderHook(
        ({ liveSegments }) => useBeat(stored, liveSegments, request),
        { initialProps: { liveSegments: live(0) } },
      );
      for (let beat = 1; beat <= 7; beat += 1) {
        incremental.rerender({ liveSegments: live(beat) });
      }
      const fresh = renderHook(() =>
        useBeat(copy(stored), live(7), copy(request)),
      );

      expect(describe(incremental.result.current)).toEqual(
        describe(fresh.result.current),
      );
    },
  );
});
