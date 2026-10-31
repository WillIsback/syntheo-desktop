import { describe, expect, it } from "vitest";

import { createSegmentKeys } from "./segment-hooks";

import type { Segment } from "~/stt/live-segment";

function segment(
  startMs: number,
  {
    speakerIndex = 0,
    humanId = null,
    wordId,
  }: {
    speakerIndex?: number | null;
    humanId?: string | null;
    wordId?: string;
  } = {},
): Segment {
  return {
    id: `${startMs}:${speakerIndex}:${humanId}:${wordId}`,
    key: {
      channel: "DirectMic",
      speaker_index: speakerIndex,
      speaker_human_id: humanId,
    },
    start_ms: startMs,
    end_ms: startMs + 500,
    text: "bonjour",
    words: [
      {
        id: wordId,
        text: "bonjour",
        start_ms: startMs,
        end_ms: startMs + 500,
        channel: "DirectMic",
        is_final: wordId !== undefined,
      },
    ],
  } as Segment;
}

describe("createSegmentKeys", () => {
  it("garde la même clé quand le locuteur du bloc est réattribué", () => {
    // La diarisation en direct renomme souvent un bloc (Speaker 1 → Alice) :
    // sa ligne ne doit pas être remontée ni perdre sa hauteur mesurée.
    const [before] = createSegmentKeys([segment(1000)], "t1");
    const [after] = createSegmentKeys(
      [segment(1000, { speakerIndex: null, humanId: "alice" })],
      "t1",
    );

    expect(after).toBe(before);
  });

  it("garde la même clé quand le premier mot provisoire devient définitif", () => {
    const [partial] = createSegmentKeys([segment(1000)], "t1");
    const [final] = createSegmentKeys(
      [segment(1000, { wordId: "word-1" })],
      "t1",
    );

    expect(final).toBe(partial);
  });

  it("ne produit jamais deux clés identiques", () => {
    const keys = createSegmentKeys(
      [
        segment(1000, { speakerIndex: 0 }),
        segment(1000, { speakerIndex: 1 }),
        segment(1000, { speakerIndex: 2 }),
      ],
      "t1",
    );

    expect(new Set(keys).size).toBe(3);
  });
});
