import { useMemo, useRef } from "react";

import { endsSentence } from "./utils";

import type { Segment, SegmentWord } from "~/stt/live-segment";

// Découpage d'affichage du flux d'un même locuteur en paragraphes (issue 281).
// Sans diarisation, toute la réunion forme un seul segment : affiché d'un
// bloc, chaque partiel ferait remettre en page et repeindre la réunion
// entière. Chaque paragraphe devient une ligne virtuelle isolée, et un
// partiel ne touche que le dernier. Les données, l'export, la sélection et
// l'édition restent au niveau du segment.

// Silence entre deux mots finaux à partir duquel une fin de phrase ouvre un
// nouveau paragraphe.
export const PARAGRAPH_PAUSE_MS = 1_500;
// Sans pause, un paragraphe est fermé au plus tard après ce nombre de
// phrases (ou à la suivante si le mot d'après est encore provisoire).
export const PARAGRAPH_MAX_SENTENCES = 5;

// Indices des premiers mots de chaque paragraphe (le premier vaut 0).
//
// Une coupure se fait seulement après un mot final qui termine une phrase,
// suivi d'un mot final : jamais au milieu d'une phrase, et jamais sur la foi
// d'un mot provisoire, dont le texte et l'horodatage peuvent encore changer.
// La décision ne dépend donc que des mots finaux qui la précèdent : quand le
// flux grandit, un paragraphe fermé garde ses bornes et son premier mot.
//
// `previous` (découpage d'une version antérieure du même flux) permet de
// reprendre au dernier début de paragraphe dont les mots, et le suivant, sont
// les mêmes objets : le découpage qui précède est forcément identique, et le
// compte de phrases y repart de zéro. Pendant l'écoute, seul le dernier
// paragraphe est ainsi relu à chaque battement (issue 287).
export function splitWordsIntoParagraphs(
  words: readonly SegmentWord[],
  previous?: { words: readonly SegmentWord[]; starts: readonly number[] },
) {
  let starts = [0];
  let from = 0;
  if (previous) {
    const limit = Math.min(words.length, previous.words.length);
    let common = 0;
    while (common < limit && words[common] === previous.words[common]) {
      common += 1;
    }
    let resume = previous.starts.length - 1;
    while (resume > 0 && previous.starts[resume]! >= common) resume -= 1;
    starts = previous.starts.slice(0, resume + 1);
    from = starts[resume]!;
  }
  let sentences = 0;
  for (let index = from; index < words.length - 1; index += 1) {
    const word = words[index]!;
    if (!endsSentence(word)) continue;
    sentences += 1;

    const next = words[index + 1]!;
    if (!word.is_final || !next.is_final) continue;
    const pause = next.start_ms - word.end_ms >= PARAGRAPH_PAUSE_MS;
    if (pause || sentences >= PARAGRAPH_MAX_SENTENCES) {
      starts.push(index + 1);
      sentences = 0;
    }
  }
  return starts;
}

export type TranscriptParagraph = {
  // Vue du paragraphe : les champs du segment, restreints à ses mots. Même
  // objet tant que ses mots et son locuteur ne changent pas.
  segment: Segment;
  // Rang du segment d'origine dans la liste des segments.
  segmentIndex: number;
  // Paragraphe suivant dans le même tour de parole : pas d'en-tête.
  continuation: boolean;
};

// Paragraphes d'affichage de la liste de segments. Les vues des paragraphes
// inchangés reprennent leur identité précédente (indexées par leur premier
// mot, stable depuis `useStableSegments`) : un partiel ne refait que le
// dernier paragraphe, même si le segment d'origine est un objet neuf.
export function useTranscriptParagraphs(
  segments: Segment[],
  split: boolean,
): TranscriptParagraph[] {
  const cacheRef = useRef<Map<SegmentWord, Segment>>(new Map());
  const splitsRef = useRef<Map<SegmentWord, ParagraphSplit>>(new Map());

  return useMemo(() => {
    const nextCache = new Map<SegmentWord, Segment>();
    const nextSplits = new Map<SegmentWord, ParagraphSplit>();
    const paragraphs: TranscriptParagraph[] = [];
    segments.forEach((segment, segmentIndex) => {
      const first = segment.words[0];
      let starts: readonly number[] = [0];
      if (split && first) {
        const previous = splitsRef.current.get(first);
        starts =
          previous?.words === segment.words
            ? previous.starts
            : splitWordsIntoParagraphs(segment.words, previous);
        nextSplits.set(first, { words: segment.words, starts });
      }
      if (starts.length === 1) {
        paragraphs.push({ segment, segmentIndex, continuation: false });
        return;
      }
      starts.forEach((start, position) => {
        const end = starts[position + 1] ?? segment.words.length;
        const head = segment.words[start]!;
        const cached = cacheRef.current.get(head);
        const view =
          cached &&
          wordsIdentical(cached.words, segment.words, start, end) &&
          sameSpeaker(cached, segment)
            ? cached
            : createParagraphView(segment, segment.words.slice(start, end));
        nextCache.set(head, view);
        paragraphs.push({
          segment: view,
          segmentIndex,
          continuation: position > 0,
        });
      });
    });
    cacheRef.current = nextCache;
    splitsRef.current = nextSplits;
    return paragraphs;
  }, [segments, split]);
}

type ParagraphSplit = {
  words: readonly SegmentWord[];
  starts: readonly number[];
};

function createParagraphView(segment: Segment, words: SegmentWord[]): Segment {
  return {
    ...segment,
    start_ms: words[0]!.start_ms,
    end_ms: words[words.length - 1]!.end_ms,
    text: words
      .map((word) => word.text)
      .join("")
      .trim(),
    words,
  };
}

// Comparaison par identité de `a` et de `b[start..end)`, sans copie.
function wordsIdentical(
  a: readonly SegmentWord[],
  b: readonly SegmentWord[],
  start: number,
  end: number,
) {
  if (a.length !== end - start) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[start + index]) return false;
  }
  return true;
}

// L'identifiant du segment n'entre pas en compte : pendant l'écoute, il
// contient le dernier mot et change à chaque partiel. Les paragraphes
// s'identifient par la clé stable de leur segment (voir transcript.tsx).
function sameSpeaker(view: Segment, segment: Segment) {
  return (
    view.key.channel === segment.key.channel &&
    view.key.speaker_index === segment.key.speaker_index &&
    view.key.speaker_human_id === segment.key.speaker_human_id &&
    view.speaker_label === segment.speaker_label &&
    JSON.stringify(view.provisional_speaker) ===
      JSON.stringify(segment.provisional_speaker)
  );
}
