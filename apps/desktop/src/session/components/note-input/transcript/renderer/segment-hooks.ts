import { useMemo, useRef } from "react";

import type { Segment, SegmentWord } from "~/stt/live-segment";
import { getTranscriptTimingSource } from "~/stt/timing";

// Le natif (IPC) renvoie à chaque partiel des objets neufs : sans diarisation,
// toute la réunion tient en un seul segment, renvoyé entier, mots compris.
// Les segments et les mots inchangés reprennent ici leur identité précédente,
// pour que les phrases et les mots déjà affichés (mémoïsés par référence) ne
// soient pas refaits : seul ce qui a changé est redessiné, quelle que soit la
// longueur de la réunion.
export function useStableSegments(segments: Segment[]): Segment[] {
  const cacheRef = useRef<Map<string, Segment>>(new Map());
  const wordCacheRef = useRef<Map<string, SegmentWord>>(new Map());

  return useMemo(() => {
    const nextCache = new Map<string, Segment>();
    const nextWordCache = new Map<string, SegmentWord>();
    const stable = segments.map((segment) => {
      const cached = cacheRef.current.get(segment.id);
      const reused =
        cached && segmentsEqual(cached, segment)
          ? cached
          : withStableWords(segment, wordCacheRef.current);
      nextCache.set(segment.id, reused);
      for (const word of reused.words) {
        nextWordCache.set(wordCacheKey(word), word);
      }
      return reused;
    });

    cacheRef.current = nextCache;
    wordCacheRef.current = nextWordCache;
    return stable;
  }, [segments]);
}

// Les mots provisoires n'ont pas d'identifiant : leur position et leur canal
// en tiennent lieu, l'égalité complète est vérifiée ensuite.
function wordCacheKey(word: SegmentWord): string {
  return word.id
    ? `id:${word.id}`
    : `at:${word.channel}:${word.start_ms}:${word.end_ms}`;
}

function withStableWords(
  segment: Segment,
  wordCache: ReadonlyMap<string, SegmentWord>,
): Segment {
  let changed = false;
  const words = segment.words.map((word) => {
    const cached = wordCache.get(wordCacheKey(word));
    if (cached && cached !== word && wordsEqual(cached, word)) {
      changed = true;
      return cached;
    }
    return word;
  });
  return changed ? { ...segment, words } : segment;
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
    if (!wordsEqual(a.words[index]!, b.words[index]!)) {
      return false;
    }
  }

  return true;
}

function wordsEqual(a: SegmentWord, b: SegmentWord) {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.start_ms === b.start_ms &&
    a.end_ms === b.end_ms &&
    a.channel === b.channel &&
    a.is_final === b.is_final &&
    getTranscriptTimingSource(a) === getTranscriptTimingSource(b)
  );
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
