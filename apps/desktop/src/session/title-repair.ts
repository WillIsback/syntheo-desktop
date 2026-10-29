import { md2json, parseJsonContent } from "@syntheo/editor/markdown";
import type { JSONContent } from "@syntheo/editor/note";

import { applyGeneratedSessionTitle } from "./content-mutations";
import {
  loadSessionContentSnapshot,
  type SessionContentSnapshot,
} from "./content-queries";
import { extractFirstLineTitle } from "./title-content";

import { hasLiveSessionTitleDraft } from "~/store/zustand/live-title";

const MAX_ATTEMPTS = 2;
// Optimistic concurrency failure raised when the note changed underneath us.
const STALE_TRANSACTION_ERROR =
  /^transaction statement \d+ affected 0 rows; expected 1$/;

type EnhancedNote = SessionContentSnapshot["enhancedNotes"][number];

type TitleCandidate = {
  currentTitle: string;
  note: EnhancedNote;
  content: JSONContent;
  title: string;
};

export async function repairMissingSessionTitle(
  sessionId: string,
  enhancedNoteId: string,
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = await findTitleCandidate(sessionId, enhancedNoteId);
    if (!candidate) return;

    try {
      await applyGeneratedSessionTitle(buildTitleRequest(sessionId, candidate));
      return;
    } catch (error) {
      // Only a lost optimistic transaction is worth replaying against the
      // freshly reloaded note.
      if (attempt === MAX_ATTEMPTS - 1 || !isStaleTransactionError(error)) {
        throw error;
      }
    }
  }
}

async function findTitleCandidate(
  sessionId: string,
  enhancedNoteId: string,
): Promise<TitleCandidate | null> {
  if (hasLiveSessionTitleDraft(sessionId)) return null;

  const snapshot = await loadSessionContentSnapshot(sessionId, {
    includeTranscriptWords: false,
  });
  if (!snapshot || snapshot.title.trim()) return null;

  const note = snapshot.enhancedNotes.find(
    (note) => note.id === enhancedNoteId,
  );
  if (!note?.content.trim()) return null;

  const content = toEditorContent(note);
  if (!startsWithDocumentHeading(content)) return null;

  const title = extractFirstLineTitle(content);
  // Legacy summaries also use H1 for sections; only a calendar match proves
  // this heading is the missing meeting title.
  if (!matchesCalendarTitle(title, snapshot.event, sessionId)) return null;

  return { currentTitle: snapshot.title, note, content, title };
}

function toEditorContent(note: EnhancedNote): JSONContent {
  return note.contentFormat === "markdown"
    ? md2json(note.content)
    : parseJsonContent(note.content);
}

function startsWithDocumentHeading(content: JSONContent) {
  const firstBlock = content.content?.[0];
  return firstBlock?.type === "heading" && firstBlock.attrs?.level === 1;
}

function matchesCalendarTitle(
  title: string | null,
  event: unknown,
  sessionId: string,
): title is string {
  if (!title || !isCalendarEvent(event)) return false;
  return event.title.trim() === title && !hasLiveSessionTitleDraft(sessionId);
}

function isCalendarEvent(event: unknown): event is { title: string } {
  return (
    !!event &&
    typeof event === "object" &&
    "title" in event &&
    typeof event.title === "string"
  );
}

function buildTitleRequest(sessionId: string, candidate: TitleCandidate) {
  const { currentTitle, note, content, title } = candidate;
  return {
    sessionId,
    currentTitle,
    nextTitle: title,
    documents: [
      {
        id: note.id,
        currentContent: note.content,
        currentContentFormat: note.contentFormat,
        nextContent:
          note.contentFormat === "markdown"
            ? JSON.stringify(content)
            : note.content,
      },
    ],
  };
}

function isStaleTransactionError(error: unknown) {
  return error instanceof Error && STALE_TRANSACTION_ERROR.test(error.message);
}
