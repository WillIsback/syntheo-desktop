import type { RenderTranscriptRequest } from "@syntheo/plugin-transcription";

import type { Segment, SegmentKey, SegmentWord } from "./live-segment";

// Fusion de la transcription persistée et des segments vivants, refaite à
// chaque battement d'affichage pendant l'écoute (issue 287). Le persisté ne
// change pas pendant une capture : tout ce qui ne dépend que de lui est
// calculé une fois et mis en cache (par identité du tableau, du segment et de
// la requête), pour que le coût d'un battement dépende de la fenêtre vivante,
// pas de la longueur de la réunion. Les résultats sont identiques au calcul
// complet.

const REPLACEMENT_TIME_BUCKET_MS = 1_000;

type ReplacementCandidate = { word: SegmentWord; segment: number };

type RenderedIndex = {
  request: RenderTranscriptRequest | null;
  currentWordIds: Set<string> | null;
  // Segments persistés filtrés des seuls mots absents de la requête.
  staticFragments: Segment[][];
  staticSegments: Segment[];
  sortedStaticSegments: Segment[];
  segmentsById: Map<string, number[]>;
  segmentsByWordId: Map<string, number[]>;
  replacementCandidates: Map<string, ReplacementCandidate[]>;
};

const renderedIndexes = new WeakMap<Segment[], RenderedIndex>();
const requestWordIds = new WeakMap<RenderTranscriptRequest, Set<string>>();

function getRequestWordIds(request: RenderTranscriptRequest): Set<string> {
  let ids = requestWordIds.get(request);
  if (!ids) {
    ids = new Set(
      request.transcripts.flatMap((transcript) =>
        transcript.words.map((word) => word.id),
      ),
    );
    requestWordIds.set(request, ids);
  }
  return ids;
}

function compareSegments(a: Segment, b: Segment) {
  return a.start_ms - b.start_ms || a.end_ms - b.end_ms;
}

function pushIndex(map: Map<string, number[]>, key: string, index: number) {
  const entries = map.get(key);
  if (entries) entries.push(index);
  else map.set(key, [index]);
}

function getRenderedIndex(
  renderedSegments: Segment[],
  request: RenderTranscriptRequest | null,
): RenderedIndex {
  const cached = renderedIndexes.get(renderedSegments);
  if (cached && cached.request === request) {
    return cached;
  }

  const currentWordIds = request ? getRequestWordIds(request) : null;
  const segmentsById = new Map<string, number[]>();
  const segmentsByWordId = new Map<string, number[]>();
  const replacementCandidates = new Map<string, ReplacementCandidate[]>();
  const staticFragments = renderedSegments.map((segment, index) => {
    if (segment.id) pushIndex(segmentsById, segment.id, index);
    for (const word of segment.words) {
      if (!word.id) continue;
      pushIndex(segmentsByWordId, word.id, index);
      if (word.end_ms <= word.start_ms) continue;
      const [startBucket, endBucket] = getReplacementBucketRange(word);
      for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
        const key = replacementBucketKey(segment.key, bucket);
        const candidates = replacementCandidates.get(key);
        const candidate = { word, segment: index };
        if (candidates) candidates.push(candidate);
        else replacementCandidates.set(key, [candidate]);
      }
    }
    return filterSegmentWords(
      segment,
      (word) => !(word.id && currentWordIds && !currentWordIds.has(word.id)),
      "persisted",
    );
  });
  const staticSegments = staticFragments.flat();
  const index: RenderedIndex = {
    request,
    currentWordIds,
    staticFragments,
    staticSegments,
    sortedStaticSegments: [...staticSegments].sort(compareSegments),
    segmentsById,
    segmentsByWordId,
    replacementCandidates,
  };
  renderedIndexes.set(renderedSegments, index);
  return index;
}

// Insère les segments vivants dans les segments persistés déjà triés : même
// résultat qu'un tri stable de leur concaténation (à égalité, le persisté
// d'abord), sans reparcourir tout le persisté.
function insertSorted(sorted: Segment[], live: Segment[]): Segment[] {
  const result: Segment[] = [];
  let from = 0;
  for (const segment of [...live].sort(compareSegments)) {
    let low = from;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compareSegments(sorted[middle]!, segment) <= 0) low = middle + 1;
      else high = middle;
    }
    for (let index = from; index < low; index += 1) result.push(sorted[index]!);
    result.push(segment);
    from = low;
  }
  for (let index = from; index < sorted.length; index += 1) {
    result.push(sorted[index]!);
  }
  return result;
}

export function mergeRenderedAndLiveSegments(
  renderedSegments: Segment[],
  liveSegments: Segment[],
  currentRequest?: RenderTranscriptRequest | null,
): Segment[] {
  const index = getRenderedIndex(renderedSegments, currentRequest ?? null);
  const { currentWordIds } = index;
  const dropped = new Set<number>();
  const touched = new Set<number>();
  const liveWordIds = new Set<string>();
  const replacedWords = new Set<SegmentWord>();

  for (const segment of liveSegments) {
    if (segment.id) {
      for (const stored of index.segmentsById.get(segment.id) ?? []) {
        dropped.add(stored);
      }
    }
    for (const word of segment.words) {
      if (!word.id) continue;
      liveWordIds.add(word.id);
      for (const stored of index.segmentsByWordId.get(word.id) ?? []) {
        touched.add(stored);
      }
      // Un mot vivant pas encore persisté remplace le mot persisté qui
      // occupe le même temps (au moins 80 % du plus court des deux).
      if (!currentWordIds || currentWordIds.has(word.id)) continue;
      const [startBucket, endBucket] = getReplacementBucketRange(word);
      for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
        const candidates = index.replacementCandidates.get(
          replacementBucketKey(segment.key, bucket),
        );
        for (const candidate of candidates ?? []) {
          if (isReplacedBy(candidate.word, word)) {
            replacedWords.add(candidate.word);
            touched.add(candidate.segment);
          }
        }
      }
    }
  }

  let renderedOnly = index.staticSegments;
  let sortedRenderedOnly = index.sortedStaticSegments;
  if (dropped.size > 0 || touched.size > 0) {
    renderedOnly = renderedSegments.flatMap((segment, position) => {
      if (dropped.has(position)) return [];
      if (!touched.has(position)) return index.staticFragments[position]!;
      return filterSegmentWords(
        segment,
        (word) =>
          !(
            (word.id && liveWordIds.has(word.id)) ||
            (word.id && currentWordIds && !currentWordIds.has(word.id)) ||
            replacedWords.has(word)
          ),
        "persisted",
      );
    });
    sortedRenderedOnly = [...renderedOnly].sort(compareSegments);
  }

  if (liveSegments.length === 0) {
    return renderedOnly;
  }

  return insertSorted(sortedRenderedOnly, liveSegments);
}

function isReplacedBy(rendered: SegmentWord, live: SegmentWord): boolean {
  const overlap =
    Math.min(rendered.end_ms, live.end_ms) -
    Math.max(rendered.start_ms, live.start_ms);
  const shorterDuration = Math.min(
    rendered.end_ms - rendered.start_ms,
    live.end_ms - live.start_ms,
  );
  return overlap > 0 && overlap / shorterDuration >= 0.8;
}

function getReplacementBucketRange(
  word: SegmentWord,
): [start: number, end: number] {
  const start = Math.floor(word.start_ms / REPLACEMENT_TIME_BUCKET_MS);
  const inclusiveEnd = Math.max(word.start_ms, word.end_ms - 1);
  return [start, Math.floor(inclusiveEnd / REPLACEMENT_TIME_BUCKET_MS)];
}

function replacementBucketKey(key: SegmentKey, bucket: number): string {
  return `${key.channel}:${key.speaker_index ?? "none"}:${bucket}`;
}

function filterSegmentWords(
  segment: Segment,
  keepWord: (word: SegmentWord) => boolean,
  fragmentKind: string,
): Segment[] {
  if (segment.words.every(keepWord)) {
    return [segment];
  }

  const fragments: Segment[] = [];
  let words: SegmentWord[] = [];
  const flushFragment = () => {
    if (words.length > 0) {
      fragments.push(createSegmentFragment(segment, words, fragmentKind));
      words = [];
    }
  };

  for (const word of segment.words) {
    if (keepWord(word)) {
      words.push(word);
    } else {
      flushFragment();
    }
  }
  flushFragment();
  return fragments;
}

export function createSegmentFragment(
  segment: Segment,
  words: SegmentWord[],
  fragmentKind: string,
): Segment {
  const first = words[0]!;
  const last = words[words.length - 1]!;
  return {
    ...segment,
    id: [
      segment.id || "segment",
      fragmentKind,
      first.id ?? first.start_ms,
      last.id ?? last.end_ms,
    ].join(":"),
    start_ms: first.start_ms,
    end_ms: last.end_ms,
    text: words
      .map((word) => word.text)
      .join("")
      .trim(),
    words,
  };
}
