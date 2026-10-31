import { useMemo, useRef } from "react";

import type { Segment } from "~/stt/live-segment";
import { getTranscriptTimingSource } from "~/stt/timing";

export function useStableSegments(segments: Segment[]): Segment[] {
  const cacheRef = useRef<Map<string, Segment>>(new Map());

  return useMemo(() => {
    const nextCache = new Map<string, Segment>();
    const stable = segments.map((segment) => {
      const cached = cacheRef.current.get(segment.id);
      if (cached && segmentsEqual(cached, segment)) {
        nextCache.set(segment.id, cached);
        return cached;
      }

      nextCache.set(segment.id, segment);
      return segment;
    });

    cacheRef.current = nextCache;
    return stable;
  }, [segments]);
}

// Clé React (et clé du cache de hauteurs) d'une ligne de transcription.
// Elle ne dépend que du canal et du début du bloc : pendant l'écoute, le
// locuteur d'un bloc est souvent réattribué (diarisation, identités) et ses
// mots provisoires deviennent définitifs. Si la clé changeait alors, la ligne
// serait remontée, perdrait sa hauteur mesurée et toute la marge sauterait.
export function createSegmentKey(
  segment: Segment,
  transcriptId: string,
  fallbackIndex: number,
) {
  const firstWord = segment.words[0];
  return [
    transcriptId,
    segment.key.channel,
    firstWord ? `start-${firstWord.start_ms}` : `index-${fallbackIndex}`,
  ].join(":");
}

// Des clés en double feraient réutiliser par React la mauvaise ligne : deux
// blocs qui commencent au même instant sur le même canal sont départagés par
// leur rang d'apparition.
export function createSegmentKeys(
  segments: readonly Segment[],
  transcriptId: string,
): string[] {
  const seen = new Map<string, number>();
  return segments.map((segment, index) => {
    const key = createSegmentKey(segment, transcriptId, index);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return occurrence === 0 ? key : `${key}:${occurrence}`;
  });
}

function segmentsEqual(a: Segment, b: Segment) {
  if (
    a.id !== b.id ||
    a.start_ms !== b.start_ms ||
    a.end_ms !== b.end_ms ||
    a.text !== b.text ||
    a.speaker_label !== b.speaker_label ||
    JSON.stringify(a.provisional_speaker) !==
      JSON.stringify(b.provisional_speaker) ||
    a.key.channel !== b.key.channel ||
    a.key.speaker_index !== b.key.speaker_index ||
    a.key.speaker_human_id !== b.key.speaker_human_id ||
    a.words.length !== b.words.length
  ) {
    return false;
  }

  for (let index = 0; index < a.words.length; index += 1) {
    const aw = a.words[index]!;
    const bw = b.words[index]!;
    if (
      aw.id !== bw.id ||
      aw.text !== bw.text ||
      aw.start_ms !== bw.start_ms ||
      aw.end_ms !== bw.end_ms ||
      aw.channel !== bw.channel ||
      aw.is_final !== bw.is_final ||
      getTranscriptTimingSource(aw) !== getTranscriptTimingSource(bw)
    ) {
      return false;
    }
  }

  return true;
}

export function segmentsShallowEqual(a: Segment[], b: Segment[]) {
  if (a === b) {
    return true;
  }

  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}
