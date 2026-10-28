import { tool } from "ai";
import { z } from "zod";

import { md2json } from "@syntheo/editor/markdown";

import {
  resolveActiveEnhancedNoteId,
  resolveCurrentSessionId,
} from "./current-session";
import type { ToolDependencies } from "./types";

import {
  applySessionContentCorrections,
  type SummaryContentCorrection,
  type TranscriptContentCorrection,
} from "~/session/content-mutations";
import {
  loadSessionContentSnapshot,
  type SessionContentSnapshot,
} from "~/session/content-queries";
import { updateSettingValue } from "~/settings/queries";
import { normalizeKeywordList, parseDictionaryTermsJson } from "~/stt/keywords";

type CorrectionTarget = "summary" | "transcript" | "summary_and_transcript";

type ReplacementResult = {
  text: string;
  count: number;
};

type TranscriptWord = {
  id?: string | null;
  text?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
  channel?: number | null;
  speaker?: string | null;
  metadata?: unknown;
};

type SummaryChange = {
  enhancedNoteId: string;
  title: string;
  replacements: number;
};

type TranscriptChange = {
  transcriptId: string;
  wordReplacements: number;
  memoReplacements: number;
};

type DictionaryChange = {
  addedTerms: string[];
};

type TitleChange = {
  replacements: number;
  nextTitle: string;
};

type SummaryCorrectionPlan = {
  changes: SummaryChange[];
  updates: SummaryContentCorrection[];
};

type TranscriptCorrectionPlan = {
  changes: TranscriptChange[];
  updates: TranscriptContentCorrection[];
};

function replaceExact(
  value: string,
  oldText: string,
  newText: string,
): ReplacementResult {
  if (!oldText) {
    return { text: value, count: 0 };
  }

  const parts = value.split(oldText);
  if (parts.length === 1) {
    return { text: value, count: 0 };
  }

  return {
    text: parts.join(newText),
    count: parts.length - 1,
  };
}

function replaceBoundedExact(
  value: string,
  oldText: string,
  newText: string,
): ReplacementResult {
  if (!oldText) {
    return { text: value, count: 0 };
  }

  const escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const pattern = new RegExp(
    String.raw`(^|[^\p{L}\p{N}])${escaped}(?=$|[^\p{L}\p{N}])`,
    "giu",
  );
  let count = 0;
  const text = value.replace(pattern, (_match, prefix: string) => {
    count++;
    return `${prefix}${newText}`;
  });

  return { text, count };
}

function planSummaryCorrections({
  notes,
  enhancedNoteId,
  oldText,
  newText,
}: {
  notes: SessionContentSnapshot["enhancedNotes"];
  enhancedNoteId?: string;
  oldText: string;
  newText: string;
}): SummaryCorrectionPlan {
  const candidates = enhancedNoteId
    ? notes.filter((note) => note.id === enhancedNoteId)
    : notes;
  const changes: SummaryChange[] = [];
  const updates: SummaryContentCorrection[] = [];

  for (const note of candidates) {
    const replaced = replaceExact(note.markdown, oldText, newText);
    if (replaced.count === 0) {
      continue;
    }

    updates.push({
      id: note.id,
      currentContent: note.content,
      currentContentFormat: note.contentFormat,
      nextContent: JSON.stringify(md2json(replaced.text)),
    });
    changes.push({
      enhancedNoteId: note.id,
      title: note.title.trim() || "Summary",
      replacements: replaced.count,
    });
  }

  return { changes, updates };
}

const TOKEN_CHAR_PATTERN = /[\p{L}\p{N}]/u;

function trimTokenPunctuation(value: string): string {
  const chars = [...value];
  let start = 0;
  while (start < chars.length && !TOKEN_CHAR_PATTERN.test(chars[start])) {
    start++;
  }
  let end = chars.length;
  while (end > start && !TOKEN_CHAR_PATTERN.test(chars[end - 1])) {
    end--;
  }
  const trimmed = chars.slice(start, end).join("");
  return trimmed || value;
}

function normalizeComparableToken(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokenizeReplacement(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .map(trimTokenPunctuation)
    .filter(Boolean);
}

function tokenizeComparable(value: string): string[] {
  return tokenizeReplacement(value)
    .map(normalizeComparableToken)
    .filter(Boolean);
}

function wordRangeMatchesAt(
  words: TranscriptWord[],
  target: string[],
  start: number,
): boolean {
  if (target.length === 0 || start + target.length > words.length) {
    return false;
  }

  return target.every(
    (text, index) =>
      normalizeComparableToken(words[start + index].text ?? "") === text,
  );
}

function buildReplacementWords(
  original: TranscriptWord[],
  newText: string,
): TranscriptWord[] {
  const tokens = tokenizeReplacement(newText);
  if (tokens.length === 0) {
    return [];
  }

  const first = original[0] ?? {};
  const last = original[original.length - 1] ?? first;
  const startMs = typeof first.start_ms === "number" ? first.start_ms : null;
  const endMs = typeof last.end_ms === "number" ? last.end_ms : startMs;
  const duration =
    startMs !== null && endMs !== null ? Math.max(endMs - startMs, 0) : 0;
  const step = tokens.length > 0 ? duration / tokens.length : 0;
  const baseId = typeof first.id === "string" && first.id ? first.id : null;

  return tokens.map((text, index) => {
    const wordStart =
      startMs === null ? first.start_ms : Math.round(startMs + step * index);
    const wordEnd =
      startMs === null
        ? first.end_ms
        : Math.round(startMs + step * (index + 1));

    return {
      ...first,
      id: index === 0 ? first.id : `${baseId ?? "word"}:correction:${index}`,
      text,
      start_ms: wordStart,
      end_ms: wordEnd,
    };
  });
}

function replaceTranscriptWords(
  words: TranscriptWord[],
  oldText: string,
  newText: string,
): { words: TranscriptWord[]; count: number } {
  const target = tokenizeComparable(oldText);
  const replacementTokens = tokenizeReplacement(newText);
  if (
    target.length === 0 ||
    replacementTokens.length === 0 ||
    target.length > words.length
  ) {
    return { words, count: 0 };
  }

  const nextWords: TranscriptWord[] = [];
  let count = 0;
  for (let index = 0; index < words.length; ) {
    if (target.length === 1 && replacementTokens.length === 1) {
      const word = words[index];
      const replaced = replaceBoundedExact(word.text ?? "", oldText, newText);
      if (replaced.count > 0) {
        nextWords.push({ ...word, text: replaced.text });
        count += replaced.count;
        index++;
        continue;
      }
    }

    if (wordRangeMatchesAt(words, target, index)) {
      const original = words.slice(index, index + target.length);
      nextWords.push(...buildReplacementWords(original, newText));
      index += target.length;
      count++;
      continue;
    }

    nextWords.push(words[index]);
    index++;
  }

  return count === 0 ? { words, count: 0 } : { words: nextWords, count };
}

const TEXT_TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;

function findComparableTextTokens(
  value: string,
): Array<{ text: string; start: number; end: number }> {
  return Array.from(value.matchAll(TEXT_TOKEN_PATTERN)).flatMap((match) => {
    const start = match.index;
    if (start === undefined) {
      return [];
    }

    const text = normalizeComparableToken(match[0]);
    return text ? [{ text, start, end: start + match[0].length }] : [];
  });
}

function replaceLoosePhrase(
  value: string,
  oldText: string,
  newText: string,
): ReplacementResult {
  const target = tokenizeComparable(oldText);
  const tokens = findComparableTextTokens(value);
  if (target.length === 0 || target.length > tokens.length) {
    return { text: value, count: 0 };
  }

  const parts: string[] = [];
  let cursor = 0;
  let count = 0;

  for (let index = 0; index < tokens.length; ) {
    const matches = target.every(
      (text, offset) => tokens[index + offset]?.text === text,
    );
    if (!matches) {
      index++;
      continue;
    }

    const first = tokens[index];
    const last = tokens[index + target.length - 1];
    parts.push(value.slice(cursor, first.start), newText);
    cursor = last.end;
    count++;
    index += target.length;
  }

  if (count === 0) {
    return { text: value, count: 0 };
  }

  parts.push(value.slice(cursor));
  return { text: parts.join(""), count };
}

function replaceTranscriptText(
  value: string,
  oldText: string,
  newText: string,
): ReplacementResult {
  if (
    tokenizeComparable(oldText).length === 1 &&
    tokenizeReplacement(newText).length === 1
  ) {
    const bounded = replaceBoundedExact(value, oldText, newText);
    return bounded.count > 0
      ? bounded
      : replaceLoosePhrase(value, oldText, newText);
  }

  const exact = replaceExact(value, oldText, newText);
  return exact.count > 0 ? exact : replaceLoosePhrase(value, oldText, newText);
}

function planTranscriptCorrections({
  transcripts,
  oldText,
  newText,
}: {
  transcripts: SessionContentSnapshot["transcripts"];
  oldText: string;
  newText: string;
}): TranscriptCorrectionPlan {
  if (tokenizeReplacement(newText).length === 0) {
    return { changes: [], updates: [] };
  }

  const changes: TranscriptChange[] = [];
  const updates: TranscriptContentCorrection[] = [];

  for (const transcript of transcripts) {
    const words = transcript.words as TranscriptWord[];
    const wordResult = replaceTranscriptWords(words, oldText, newText);

    const hasMemo = transcript.memo.length > 0;
    const memoResult = replaceTranscriptText(
      hasMemo ? transcript.memo : "",
      oldText,
      newText,
    );

    if (wordResult.count === 0 && memoResult.count === 0) {
      continue;
    }
    if (
      words.length > 0 &&
      hasMemo &&
      (wordResult.count === 0 || memoResult.count === 0)
    ) {
      continue;
    }

    updates.push({
      id: transcript.id,
      currentWordsJson: transcript.wordsJson,
      currentMemo: transcript.memo,
      nextWordsJson:
        wordResult.count > 0
          ? JSON.stringify(wordResult.words)
          : transcript.wordsJson,
      nextMemo: memoResult.count > 0 ? memoResult.text : transcript.memo,
    });

    changes.push({
      transcriptId: transcript.id,
      wordReplacements: wordResult.count,
      memoReplacements: memoResult.count,
    });
  }

  return { changes, updates };
}

function planTitleCorrection({
  title,
  oldText,
  newText,
}: {
  title: string;
  oldText: string;
  newText: string;
}): TitleChange | null {
  const replaced = replaceExact(title, oldText, newText);
  if (replaced.count === 0 || replaced.text === title) {
    return null;
  }

  return {
    replacements: replaced.count,
    nextTitle: replaced.text,
  };
}

function dictionaryKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function saveDictionaryTerms(
  terms?: string[],
): Promise<DictionaryChange> {
  if (!terms || terms.length === 0) {
    return { addedTerms: [] };
  }

  let addedTerms: string[] = [];
  await updateSettingValue(
    "personalization_dictionary_terms",
    (storedValue) => {
      const currentTerms = parseDictionaryTermsJson(storedValue);
      const currentKeys = new Set(currentTerms.map(dictionaryKey));
      addedTerms = normalizeKeywordList(terms).filter(
        (term) => !currentKeys.has(dictionaryKey(term)),
      );
      return JSON.stringify(
        normalizeKeywordList([...currentTerms, ...addedTerms]),
      );
    },
  );

  return { addedTerms };
}

function shouldEditSummary(target: CorrectionTarget): boolean {
  return target === "summary" || target === "summary_and_transcript";
}

function shouldEditTranscript(target: CorrectionTarget): boolean {
  return target === "transcript" || target === "summary_and_transcript";
}

type CorrectionParams = {
  sessionId?: string;
  target?: CorrectionTarget;
  enhancedNoteId?: string;
  oldText: string;
  newText: string;
  dictionaryTerms?: string[];
};

type CorrectionScope = {
  editSummary: boolean;
  editTranscript: boolean;
  summaryError?: string;
};

type CorrectionPlans = {
  summaryPlan: SummaryCorrectionPlan;
  transcriptPlan: TranscriptCorrectionPlan;
  titleChange: TitleChange | null;
};

function resolveCorrectionEnhancedNoteId(
  params: CorrectionParams,
  deps: Pick<ToolDependencies, "getSessionId" | "getEnhancedNoteId">,
  sessionId: string,
): string | undefined {
  if (params.enhancedNoteId !== undefined) {
    return params.enhancedNoteId;
  }
  if (params.sessionId) {
    return undefined;
  }
  return resolveActiveEnhancedNoteId(deps, sessionId);
}

function resolveCorrectionScope({
  target,
  enhancedNoteId,
  snapshot,
}: {
  target: CorrectionTarget;
  enhancedNoteId?: string;
  snapshot: SessionContentSnapshot;
}): CorrectionScope {
  const editTranscript = shouldEditTranscript(target);
  const editSummary = shouldEditSummary(target);
  if (!editSummary || !enhancedNoteId) {
    return { editSummary, editTranscript };
  }
  if (snapshot.enhancedNotes.some((note) => note.id === enhancedNoteId)) {
    return { editSummary, editTranscript };
  }
  if (target === "summary") {
    return {
      editSummary: false,
      editTranscript,
      summaryError:
        "The requested summary does not belong to the target session.",
    };
  }
  return { editSummary: false, editTranscript };
}

function buildCorrectionPlans({
  scope,
  snapshot,
  enhancedNoteId,
  oldText,
  newText,
}: {
  scope: CorrectionScope;
  snapshot: SessionContentSnapshot;
  enhancedNoteId?: string;
  oldText: string;
  newText: string;
}): CorrectionPlans {
  const emptySummaryPlan: SummaryCorrectionPlan = { changes: [], updates: [] };
  const emptyTranscriptPlan: TranscriptCorrectionPlan = {
    changes: [],
    updates: [],
  };
  return {
    summaryPlan: scope.editSummary
      ? planSummaryCorrections({
          notes: snapshot.enhancedNotes,
          enhancedNoteId,
          oldText,
          newText,
        })
      : emptySummaryPlan,
    transcriptPlan: scope.editTranscript
      ? planTranscriptCorrections({
          transcripts: snapshot.transcripts,
          oldText,
          newText,
        })
      : emptyTranscriptPlan,
    titleChange: scope.editSummary
      ? planTitleCorrection({ title: snapshot.title, oldText, newText })
      : null,
  };
}

async function commitCorrectionPlans({
  sessionId,
  snapshot,
  plans,
}: {
  sessionId: string;
  snapshot: SessionContentSnapshot;
  plans: CorrectionPlans;
}): Promise<boolean> {
  try {
    await applySessionContentCorrections({
      sessionId,
      summaries: plans.summaryPlan.updates,
      transcripts: plans.transcriptPlan.updates,
      ...(plans.titleChange
        ? {
            title: {
              currentTitle: snapshot.title,
              nextTitle: plans.titleChange.nextTitle,
            },
          }
        : {}),
    });
    return true;
  } catch (error) {
    console.error("Failed to apply session correction", error);
    return false;
  }
}

function buildMissingTargets({
  scope,
  plans,
}: {
  scope: CorrectionScope;
  plans: CorrectionPlans;
}): CorrectionTarget[] {
  const missing = [
    scope.editSummary &&
    plans.summaryPlan.changes.length === 0 &&
    !plans.titleChange
      ? "summary"
      : null,
    scope.editTranscript && plans.transcriptPlan.changes.length === 0
      ? "transcript"
      : null,
  ];
  return missing.filter(
    (target): target is CorrectionTarget => target !== null,
  );
}

function buildOutcomeMessage({
  missingTargets,
  dictionarySaveFailed,
}: {
  missingTargets: CorrectionTarget[];
  dictionarySaveFailed: boolean;
}): string | undefined {
  const messages = [
    missingTargets.length > 0
      ? `Applied correction where matched, but no matching ${missingTargets.join(" or ")} text was found.`
      : null,
    dictionarySaveFailed
      ? "The correction was applied, but dictionary terms could not be saved."
      : null,
  ].filter((message): message is string => message !== null);
  return messages.length > 0 ? messages.join(" ") : undefined;
}

export const buildApplySessionCorrectionTool = (
  deps: Pick<ToolDependencies, "getSessionId" | "getEnhancedNoteId">,
) =>
  tool({
    description:
      "Apply a correction to a session summary, visible session title, and/or transcript. Use this when the user corrects note content, for example 'it's not X but Y'. Prefer summary_and_transcript for factual meeting corrections unless the user explicitly asks for one target only. Read the note first if you need exact summary text.",
    inputSchema: z.object({
      sessionId: z
        .string()
        .optional()
        .describe(
          "Session ID of the note to edit. Omit to edit the current note (the one marked as current in context). Pass another note's Session ID only when the user asks to edit that note.",
        ),
      target: z
        .enum(["summary", "transcript", "summary_and_transcript"])
        .default("summary_and_transcript")
        .describe(
          "Which session content to correct. Use summary only or transcript only when the user explicitly scopes the correction.",
        ),
      enhancedNoteId: z
        .string()
        .optional()
        .describe(
          "Optional summary ID to restrict summary edits. Defaults to summaries in the target session.",
        ),
      oldText: z
        .string()
        .min(1)
        .describe("Exact text currently present in the note or transcript."),
      newText: z.string().describe("Replacement text."),
      dictionaryTerms: z
        .array(z.string().min(1))
        .default([])
        .describe(
          "Uncommon names, company/product names, acronyms, or jargon from the correction to save for future transcription. Skip common names.",
        ),
    }),
    execute: async (params: CorrectionParams, options) => {
      const sessionId =
        params.sessionId ?? resolveCurrentSessionId(deps, options);

      if (!sessionId) {
        return {
          status: "error",
          message:
            "No active session selected. Provide sessionId explicitly when calling apply_session_correction.",
        };
      }

      const newText = params.newText.trim();
      if (!newText) {
        return {
          status: "error",
          message: "Replacement text cannot be blank.",
          sessionId,
        };
      }

      const target = params.target ?? "summary_and_transcript";
      const enhancedNoteId = resolveCorrectionEnhancedNoteId(
        params,
        deps,
        sessionId,
      );
      const snapshot = await loadSessionContentSnapshot(sessionId);
      if (!snapshot) {
        return {
          status: "error",
          message: "The target session could not be loaded.",
          sessionId,
        };
      }

      const scope = resolveCorrectionScope({
        target,
        enhancedNoteId,
        snapshot,
      });
      if (scope.summaryError) {
        return {
          status: "error",
          message: scope.summaryError,
          sessionId,
        };
      }

      const plans = buildCorrectionPlans({
        scope,
        snapshot,
        enhancedNoteId,
        oldText: params.oldText,
        newText,
      });

      if (
        plans.summaryPlan.changes.length === 0 &&
        plans.transcriptPlan.changes.length === 0 &&
        !plans.titleChange
      ) {
        return {
          status: "not_found",
          message:
            "No exact match found. Read the note and call apply_session_correction with the exact current text.",
          sessionId,
        };
      }

      const committed = await commitCorrectionPlans({
        sessionId,
        snapshot,
        plans,
      });
      if (!committed) {
        return {
          status: "error",
          message:
            "The note changed before the correction could be committed. Read the note and retry.",
          sessionId,
        };
      }

      let dictionaryChanges: DictionaryChange = { addedTerms: [] };
      let dictionarySaveFailed = false;
      try {
        dictionaryChanges = await saveDictionaryTerms(params.dictionaryTerms);
      } catch (error) {
        dictionarySaveFailed = true;
        console.error("Failed to save correction dictionary terms", error);
      }

      const missingTargets = buildMissingTargets({ scope, plans });
      return {
        status: missingTargets.length > 0 ? "partial" : "applied",
        message: buildOutcomeMessage({ missingTargets, dictionarySaveFailed }),
        sessionId,
        summaryChanges: plans.summaryPlan.changes,
        transcriptChanges: plans.transcriptPlan.changes,
        titleChange: plans.titleChange,
        dictionaryChanges,
      };
    },
  });

export const sessionCorrectionTestInternals = {
  planSummaryCorrections,
  planTranscriptCorrections,
  planTitleCorrection,
  replaceExact,
  replaceLoosePhrase,
  replaceTranscriptWords,
};
