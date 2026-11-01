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
  const cacheRef = useRef<StableCache>({
    segments: new Map(),
    words: new Map(),
    knownWords: new WeakSet(),
  });

  return useMemo(() => {
    const cache = cacheRef.current;
    const nextSegments = new Map<string, Segment>();
    const stable = segments.map((segment) => {
      const cached = cache.segments.get(segment.id);
      const reused =
        cached && (cached === segment || segmentsEqual(cached, segment))
          ? cached
          : withStableWords(segment, cache);
      nextSegments.set(segment.id, reused);
      return reused;
    });
    const wordCount = stable.reduce(
      (total, segment) => total + segment.words.length,
      0,
    );

    cache.segments = nextSegments;
    // Le cache des mots n'est pas reconstruit à chaque battement (ce serait
    // relire toute la réunion, issue 287) : seulement quand il a doublé, pour
    // oublier les mots qui ne sont plus affichés.
    if (cache.words.size > 2 * wordCount + STABLE_WORD_CACHE_SLACK) {
      cache.words = new Map();
      for (const segment of stable) {
        for (const word of segment.words) {
          cache.words.set(wordCacheKey(word), word);
        }
      }
    }
    return stable;
  }, [segments]);
}

const STABLE_WORD_CACHE_SLACK = 1_024;

type StableCache = {
  segments: Map<string, Segment>;
  // Dernier objet affiché pour chaque mot (voir `wordCacheKey`).
  words: Map<string, SegmentWord>;
  // Mots déjà passés par le cache : leur identité est déjà la bonne, ils
  // n'ont pas à être relus.
  knownWords: WeakSet<SegmentWord>;
};

// Les mots provisoires n'ont pas d'identifiant : leur position et leur canal
// en tiennent lieu, l'égalité complète est vérifiée ensuite.
function wordCacheKey(word: SegmentWord): string {
  return word.id
    ? `id:${word.id}`
    : `at:${word.channel}:${word.start_ms}:${word.end_ms}`;
}

function withStableWords(segment: Segment, cache: StableCache): Segment {
  let changed = false;
  const words = segment.words.map((word) => {
    if (cache.knownWords.has(word)) return word;
    const key = wordCacheKey(word);
    const cached = cache.words.get(key);
    if (cached && cached !== word && wordsEqual(cached, word)) {
      changed = true;
      return cached;
    }
    cache.words.set(key, word);
    cache.knownWords.add(word);
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
  let position = segmentKeyPositions.get(segment);
  if (position === undefined) {
    const firstWord = segment.words[0];
    if (!firstWord) {
      return [transcriptId, segment.key.channel, `index-${fallbackIndex}`].join(
        ":",
      );
    }
    position = `${segment.key.channel}:start-${firstWord.start_ms}`;
    segmentKeyPositions.set(segment, position);
  }
  return `${transcriptId}:${position}`;
}

// Calculée une fois par segment : la liste des clés est refaite à chaque
// battement, sur toutes les lignes.
const segmentKeyPositions = new WeakMap<Segment, string>();

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
    const left = a.words[index]!;
    const right = b.words[index]!;
    if (left !== right && !wordsEqual(left, right)) {
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
