import chroma from "chroma-js";
import { describe, expect, it } from "vitest";

import { DesignColors } from "@syntheo/design-system";

import {
  getActiveLineIndex,
  getSegmentColor,
  getSegmentColorVars,
} from "./utils";

import type { SegmentKey, SegmentWord } from "~/stt/live-segment";

describe("transcript renderer utils", () => {
  it("distingue les personnes partageant un canal et un index", () => {
    const key: SegmentKey = {
      channel: "MixedCapture",
      speaker_index: null,
      speaker_human_id: "person-1",
    };
    const first = getSegmentColor(key);
    const second = getSegmentColor({
      ...key,
      speaker_human_id: "person-2",
    });

    expect(chroma.deltaE(first, second)).toBeGreaterThan(20);
    expect(
      getSegmentColor({ ...key, channel: "RemoteParty", speaker_index: 3 }),
    ).toBe(first);
  });

  it("cycle dans la palette s1–s4 pour les locuteurs non identifiés", () => {
    const colors = Array.from({ length: 6 }, (_, speaker_index) =>
      getSegmentColor({
        channel: "MixedCapture",
        speaker_index,
        speaker_human_id: null,
      }),
    );

    expect(new Set(colors).size).toBe(4);
    expect(colors[0]).toBe(colors[4]);
    expect(colors[1]).toBe(colors[5]);
  });

  it("expose la variante claire et la variante sombre du jeton chart", () => {
    const key: SegmentKey = {
      channel: "DirectMic",
      speaker_index: 0,
      speaker_human_id: null,
    };

    expect(getSegmentColorVars(key)).toEqual({
      "--segment-color-light": getSegmentColor(key),
      "--segment-color-dark": DesignColors.dark.chart2,
    });
    expect(getSegmentColor(key)).toBe(DesignColors.light.chart2);
  });

  it("finds the active transcript line without building line groups", () => {
    const words: SegmentWord[] = [
      createWord("word-1", "Hello", 100, 400),
      createWord("word-2", "world.", 400, 900),
      createWord("word-3", "Next", 1400, 1600),
      createWord("word-4", "line!", 1600, 2100),
    ];

    expect(getActiveLineIndex(words, 50, 0)).toBeNull();
    expect(getActiveLineIndex(words, 50, 149)).toBeNull();
    expect(getActiveLineIndex(words, 50, 150)).toBe(0);
    expect(getActiveLineIndex(words, 50, 950)).toBe(0);
    expect(getActiveLineIndex(words, 50, 1200)).toBeNull();
    expect(getActiveLineIndex(words, 50, 1450)).toBe(1);
    expect(getActiveLineIndex(words, 50, 2150)).toBe(1);
    expect(getActiveLineIndex(words, 50, 2200)).toBeNull();
  });
});

function createWord(
  id: string,
  text: string,
  startMs: number,
  endMs: number,
): SegmentWord {
  return {
    id,
    text,
    start_ms: startMs,
    end_ms: endMs,
    channel: "MixedCapture",
    is_final: true,
  };
}
