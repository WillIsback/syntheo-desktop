import { describe, expect, it } from "vitest";

import {
  PARAGRAPH_MAX_SENTENCES,
  PARAGRAPH_PAUSE_MS,
  splitWordsIntoParagraphs,
} from "./paragraphs";

import type { SegmentWord } from "~/stt/live-segment";

function word(
  text: string,
  startMs: number,
  isFinal = true,
  durationMs = 200,
): SegmentWord {
  return {
    id: isFinal ? `w-${startMs}` : undefined,
    text,
    start_ms: startMs,
    end_ms: startMs + durationMs,
    channel: "MixedCapture",
    is_final: isFinal,
  } as SegmentWord;
}

// Phrases de trois mots enchaînées sans pause : `count` phrases à partir de
// `startMs`, 300 ms par mot.
function sentences(count: number, startMs = 0, isFinal = true) {
  return Array.from({ length: count }, (_, sentence) =>
    [" un", " deux", " trois."].map((text, position) =>
      word(text, startMs + (sentence * 3 + position) * 300, isFinal),
    ),
  ).flat();
}

function texts(words: SegmentWord[], starts: number[]) {
  return starts.map((start, index) =>
    words
      .slice(start, starts[index + 1] ?? words.length)
      .map((entry) => entry.text)
      .join(""),
  );
}

describe("splitWordsIntoParagraphs", () => {
  it("ne coupe pas un flux court et continu", () => {
    const words = sentences(3);
    expect(splitWordsIntoParagraphs(words)).toEqual([0]);
  });

  it("coupe sur une pause naturelle entre deux phrases", () => {
    const first = sentences(2);
    const afterPause = sentences(
      2,
      first[first.length - 1]!.end_ms + PARAGRAPH_PAUSE_MS,
    );
    const words = [...first, ...afterPause];

    expect(splitWordsIntoParagraphs(words)).toEqual([0, first.length]);
  });

  it("ne coupe jamais au milieu d'une phrase, même après une longue pause", () => {
    const words = [
      word(" Bonjour", 0),
      word(" à", 10_000),
      word(" tous.", 10_300),
      word(" Suite.", 10_600),
    ];
    expect(splitWordsIntoParagraphs(words)).toEqual([0]);
  });

  it("ignore une pause plus courte que le seuil", () => {
    const first = sentences(2);
    const rest = sentences(
      2,
      first[first.length - 1]!.end_ms + PARAGRAPH_PAUSE_MS - 1,
    );
    expect(splitWordsIntoParagraphs([...first, ...rest])).toEqual([0]);
  });

  it(`coupe au plus toutes les ${PARAGRAPH_MAX_SENTENCES} phrases sans pause`, () => {
    const words = sentences(PARAGRAPH_MAX_SENTENCES * 3 + 2);
    const starts = splitWordsIntoParagraphs(words);

    expect(starts).toEqual([
      0,
      PARAGRAPH_MAX_SENTENCES * 3,
      PARAGRAPH_MAX_SENTENCES * 6,
      PARAGRAPH_MAX_SENTENCES * 9,
    ]);
    for (const paragraph of texts(words, starts)) {
      expect(paragraph.trim().endsWith(".")).toBe(true);
    }
  });

  it("ne coupe pas tant que le mot suivant est provisoire", () => {
    const finals = sentences(PARAGRAPH_MAX_SENTENCES);
    const partial = word(" vivant", finals[finals.length - 1]!.end_ms, false);
    expect(splitWordsIntoParagraphs([...finals, partial])).toEqual([0]);
  });

  it("ne coupe pas après une phrase terminée par un mot provisoire", () => {
    const finals = sentences(PARAGRAPH_MAX_SENTENCES - 1);
    const words = [
      ...finals,
      word(" fin.", finals[finals.length - 1]!.end_ms, false),
      word(" ensuite", 1_000_000),
    ];
    expect(splitWordsIntoParagraphs(words)).toEqual([0]);
  });

  it("garde les paragraphes fermés intacts quand le paragraphe vivant grandit", () => {
    // Écoute simulée : chaque partiel ajoute un mot final, puis un mot
    // provisoire en queue qui sera remplacé au partiel suivant.
    const stream = [
      ...sentences(4),
      ...sentences(3, 20_000),
      ...sentences(12, 40_000),
    ];
    let previous: number[] = [0];
    for (let length = 1; length <= stream.length; length += 1) {
      const finals = stream.slice(0, length);
      const tail = word(" provisoire.", finals[length - 1]!.end_ms + 10, false);
      const starts = splitWordsIntoParagraphs([...finals, tail]);

      // Tous les paragraphes fermés au partiel précédent (tous sauf le
      // dernier) gardent leurs bornes, donc leur premier mot et leur clé.
      const closed = previous.slice(0, -1);
      expect(starts.slice(0, closed.length)).toEqual(closed);
      // Le paragraphe vivant garde son premier mot : il ne fait que grandir
      // ou se fermer.
      expect(starts[previous.length - 1]).toBe(previous[previous.length - 1]);
      previous = starts;
    }
    // Pause à 20 s et 40 s, puis plafond de phrases.
    expect(previous.length).toBeGreaterThanOrEqual(4);
  });
});
