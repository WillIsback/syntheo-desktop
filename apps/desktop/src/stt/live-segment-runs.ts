import type {
  ChannelProfile as SegmentChannelProfile,
  RenderTranscriptRequest,
} from "@syntheo/plugin-transcription";

import {
  type Segment,
  type SegmentKey,
  SegmentKeyUtils,
  type SegmentWord,
} from "./live-segment";
import { createSegmentFragment } from "./live-segment-merge";

// Identités des locuteurs et fusion des segments voisins d'un même locuteur,
// refaites à chaque battement d'affichage pendant l'écoute (issue 287) : les
// résultats sont mis en cache par segment, pour que seuls les segments neufs
// (la fenêtre vivante) soient relus.

type IdentityAssignments = {
  byWordId: Map<string, string>;
  byChannel: Map<SegmentChannelProfile, string>;
  byChannelSpeaker: Map<string, string>;
};

const identityAssignments = new WeakMap<
  RenderTranscriptRequest,
  IdentityAssignments | null
>();
const segmentIdentities = new WeakMap<
  Segment,
  { request: RenderTranscriptRequest; result: Segment[] }
>();

function getIdentityAssignments(
  request: RenderTranscriptRequest,
): IdentityAssignments | null {
  if (identityAssignments.has(request)) {
    return identityAssignments.get(request)!;
  }
  const assignments = request.transcripts.flatMap(
    (transcript) => transcript.assignments,
  );
  if (assignments.length === 0) {
    identityAssignments.set(request, null);
    return null;
  }

  const completeChannels = getCompleteChannels(request);
  const result: IdentityAssignments = {
    byWordId: new Map(),
    byChannel: new Map(),
    byChannelSpeaker: new Map(),
  };
  for (const assignment of assignments) {
    if (!assignment.human_id) {
      continue;
    }

    if (assignment.scope.kind === "words") {
      for (const wordId of assignment.scope.word_ids) {
        result.byWordId.set(wordId, assignment.human_id);
      }
    } else if (assignment.scope.kind === "channel_speaker") {
      result.byChannelSpeaker.set(
        channelSpeakerKey(
          assignment.scope.channel,
          assignment.scope.speaker_index,
        ),
        assignment.human_id,
      );
    } else if (
      request.speaker_context ||
      completeChannels.has(assignment.scope.channel)
    ) {
      result.byChannel.set(assignment.scope.channel, assignment.human_id);
    }
  }
  identityAssignments.set(request, result);
  return result;
}

export function applyRenderRequestIdentitiesToSegments(
  segments: Segment[],
  request?: RenderTranscriptRequest | null,
): Segment[] {
  if (!request || segments.length === 0) {
    return segments;
  }

  const assignments = getIdentityAssignments(request);
  if (!assignments) {
    return segments;
  }

  return segments.flatMap((segment) => {
    const cached = segmentIdentities.get(segment);
    if (cached?.request === request) {
      return cached.result;
    }
    const result = applySegmentIdentities(segment, assignments);
    segmentIdentities.set(segment, { request, result });
    return result;
  });
}

function applySegmentIdentities(
  segment: Segment,
  assignments: IdentityAssignments,
): Segment[] {
  const scopedHumanId =
    (typeof segment.key.speaker_index === "number"
      ? assignments.byChannelSpeaker.get(
          channelSpeakerKey(segment.key.channel, segment.key.speaker_index),
        )
      : undefined) ??
    segment.key.speaker_human_id ??
    assignments.byChannel.get(segment.key.channel) ??
    null;
  const runs: Array<{ humanId: string | null; words: SegmentWord[] }> = [];
  let previousHumanId = scopedHumanId;

  for (const word of segment.words) {
    let humanId =
      (word.id ? assignments.byWordId.get(word.id) : undefined) ??
      scopedHumanId;
    if (!word.id && !word.is_final) {
      humanId = previousHumanId;
    }

    const run = runs[runs.length - 1];
    if (run?.humanId === humanId) {
      run.words.push(word);
    } else {
      runs.push({ humanId, words: [word] });
    }
    previousHumanId = humanId;
  }

  if (runs.length === 0) {
    return [segment];
  }

  if (runs.length === 1) {
    const humanId = runs[0]!.humanId;
    if ((segment.key.speaker_human_id ?? null) === humanId) {
      return [segment];
    }

    return [
      {
        ...segment,
        key: { ...segment.key, speaker_human_id: humanId },
        speaker_label: undefined,
        provisional_speaker: undefined,
      },
    ];
  }

  return runs.map(({ humanId, words }) => {
    const identityChanged = (segment.key.speaker_human_id ?? null) !== humanId;
    return {
      ...createSegmentFragment(
        segment,
        words,
        `identity:${humanId ?? "unassigned"}`,
      ),
      key: { ...segment.key, speaker_human_id: humanId },
      speaker_label: identityChanged ? undefined : segment.speaker_label,
      provisional_speaker: identityChanged
        ? undefined
        : segment.provisional_speaker,
    };
  });
}

const serializedKeys = new WeakMap<SegmentKey, string>();

function serializeKey(key: SegmentKey): string {
  let serialized = serializedKeys.get(key);
  if (serialized === undefined) {
    serialized = SegmentKeyUtils.serialize(key);
    serializedKeys.set(key, serialized);
  }
  return serialized;
}

export function mergeAdjacentSpeakerSegments(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  let runStart = 0;
  const flush = (runEnd: number) => {
    if (runEnd - runStart > 1) {
      merged.push(mergeSegmentRun(segments.slice(runStart, runEnd)));
    } else if (runEnd > runStart) {
      merged.push(segments[runStart]!);
    }
    runStart = runEnd;
  };
  for (let index = 1; index < segments.length; index++) {
    if (
      !shouldMergeAdjacentSegmentKeys(
        segments[index - 1]!.key,
        segments[index]!.key,
      )
    ) {
      flush(index);
    }
  }
  flush(segments.length);
  return merged;
}

// Mirrors `should_merge_adjacent_keys` in crates/transcript.
function shouldMergeAdjacentSegmentKeys(
  last: SegmentKey,
  next: SegmentKey,
): boolean {
  if (last.channel !== next.channel) {
    return false;
  }

  if (
    last.speaker_human_id != null &&
    last.speaker_human_id === next.speaker_human_id
  ) {
    return true;
  }

  return (
    serializeKey(last) === serializeKey(next) &&
    (next.speaker_index != null || next.speaker_human_id != null)
  );
}

// Pendant l'écoute, la fusion est refaite à chaque partiel : un mot dont le
// texte est normalisé garde la même identité d'un rendu à l'autre, pour que
// les mots déjà affichés (mémoïsés par référence) ne soient pas refaits.
const normalizedMergedWords = new WeakMap<SegmentWord, SegmentWord>();

function getNormalizedMergedWord(word: SegmentWord, text: string): SegmentWord {
  const cached = normalizedMergedWords.get(word);
  if (cached?.text === text) {
    return cached;
  }
  const normalized = { ...word, text };
  normalizedMergedWords.set(word, normalized);
  return normalized;
}

// Mots normalisés d'un segment dans une suite fusionnée, selon qu'il l'ouvre
// ou non : calculés une fois par segment. Un tour de parole persisté de toute
// la réunion n'est ainsi pas relu à chaque battement.
type MergedPart = { words: SegmentWord[]; text: string };
const mergedParts = new WeakMap<
  Segment,
  { opening?: MergedPart; following?: MergedPart }
>();

function getMergedPart(segment: Segment, opensRun: boolean): MergedPart {
  let parts = mergedParts.get(segment);
  if (!parts) {
    parts = {};
    mergedParts.set(segment, parts);
  }
  const slot = opensRun ? "opening" : "following";
  let part = parts[slot];
  if (!part) {
    const words = segment.words.map((word, index) => {
      const text = normalizeMergedWordText(word.text, opensRun && index === 0);
      return text === word.text ? word : getNormalizedMergedWord(word, text);
    });
    part = { words, text: words.map((word) => word.text).join("") };
    parts[slot] = part;
  }
  return part;
}

function mergeSegmentRun(run: Segment[]): Segment {
  const first = run[0]!;
  const parts = run.map((segment, index) =>
    getMergedPart(segment, index === 0),
  );
  const words = parts.flatMap((part) => part.words);
  const head = words[0]!;
  const tail = words[words.length - 1]!;
  return {
    ...first,
    id: [
      serializeKey(first.key),
      head.id ?? `start:${head.start_ms}`,
      tail.id ?? `end:${tail.end_ms}`,
    ].join(":"),
    start_ms: head.start_ms,
    end_ms: tail.end_ms,
    text: parts
      .map((part) => part.text)
      .join("")
      .trim(),
    words,
    speaker_label: run.find((segment) => segment.speaker_label)?.speaker_label,
    provisional_speaker: run.find((segment) => segment.provisional_speaker)
      ?.provisional_speaker,
  };
}

// Mirrors `normalized_rendered_word_text` in crates/transcript: only the first
// word of a segment loses its leading whitespace, and a non-first word that
// lost it regains a space unless it opens with punctuation.
function normalizeMergedWordText(text: string, isFirstWord: boolean): string {
  const trimmedStart = text.trimStart();
  if (trimmedStart.length === 0) {
    return text;
  }
  if (isFirstWord) {
    return trimmedStart;
  }
  if (text.startsWith(" ")) {
    return text;
  }
  if (/^[,.;:!?)\]}']/.test(trimmedStart)) {
    return trimmedStart;
  }
  return ` ${trimmedStart}`;
}

function getCompleteChannels(
  request: RenderTranscriptRequest,
): Set<SegmentChannelProfile> {
  const participantHumanIds = new Set(
    request.participant_human_ids.filter(Boolean),
  );
  if (request.self_human_id) {
    participantHumanIds.add(request.self_human_id);
  }

  return new Set([
    "DirectMic",
    ...(participantHumanIds.size === 2 ? (["RemoteParty"] as const) : []),
  ]);
}

function channelSpeakerKey(
  channel: SegmentChannelProfile,
  speakerIndex: number,
): string {
  return `${channel}:${speakerIndex}`;
}
