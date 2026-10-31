import { tool } from "ai";
import { z } from "zod";

import {
  resolveCurrentSessionId,
  resolveViewedSummaryId,
} from "./current-session";
import type { ToolDependencies } from "./types";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";
import { loadSessionContentSnapshot } from "~/session/content-queries";
import { revealSummaryReviewInNote } from "~/session/proposal-review";
import {
  applySessionProposal,
  declineSessionProposal,
  persistChatSessionProposal,
} from "~/session/queries";

type SummaryCandidate = {
  enhancedNoteId: string;
  title: string;
  templateId?: string;
  position?: number;
};

function listSummaryCandidates(
  notes: NonNullable<
    Awaited<ReturnType<typeof loadSessionContentSnapshot>>
  >["enhancedNotes"],
): SummaryCandidate[] {
  return notes.map((note) => ({
    enhancedNoteId: note.id,
    title: note.title.trim() || "Summary",
    templateId: note.templateId || undefined,
    position: note.position,
  }));
}

function describeCandidates(candidates: SummaryCandidate[]): string {
  return candidates
    .map((candidate) => `"${candidate.enhancedNoteId}" (${candidate.title})`)
    .join(", ");
}

export const buildEditSummaryTool = (
  deps: Pick<
    ToolDependencies,
    "getSessionId" | "getEnhancedNoteId" | "openEditTab"
  >,
) =>
  tool({
    description:
      "Propose a complete replacement for an existing session summary and open a diff review where the user can apply or cancel it. Use this for broad rewrites such as refocusing, shortening, or restructuring a summary. The content must be the full replacement markdown, not instructions or a partial patch.",
    inputSchema: z.object({
      sessionId: z
        .string()
        .optional()
        .describe(
          "Session ID of the note to edit. Omit to edit the current note (the one marked as current in context). Pass another note's Session ID only when the user asks to edit that note.",
        ),
      enhancedNoteId: z
        .string()
        .optional()
        .describe(
          "Omit this to edit the summary the user is viewing. Only pass a summary ID returned by a previous edit_summary error (candidates); never pass a Session ID here.",
        ),
      content: z
        .string()
        .describe("The complete replacement summary in markdown format"),
    }),
    execute: async (
      params: {
        sessionId?: string;
        enhancedNoteId?: string;
        content: string;
      },
      options,
    ) => {
      const { toolCallId } = options;
      const sessionId =
        params.sessionId ?? resolveCurrentSessionId(deps, options);

      if (!sessionId) {
        return {
          status: "error",
          code: "no_session",
          message:
            "No active session selected. Provide sessionId explicitly when calling edit_summary.",
        };
      }

      const snapshot = await loadSessionContentSnapshot(sessionId);
      const notes = snapshot?.enhancedNotes ?? [];
      const noteIds = notes.map((note) => note.id);

      if (noteIds.length === 0) {
        return {
          status: "error",
          code: "no_summary",
          message: "No summaries found for this session",
        };
      }

      const noteIdSet = new Set(noteIds);

      const requestedEnhancedNoteId = params.enhancedNoteId;
      // Le compte-rendu que l'utilisateur a sous les yeux dans le document
      // vivant (et non la vue brute de l'onglet, parfois vide ou périmée).
      const viewedEnhancedNoteId = resolveViewedSummaryId(
        deps,
        sessionId,
        noteIds,
      );
      const candidates = listSummaryCandidates(notes);
      const requestedIsValid =
        !!requestedEnhancedNoteId && noteIdSet.has(requestedEnhancedNoteId);

      // Le contexte du modèle ne donne que l'id de la note (« Session ID »),
      // jamais celui des comptes-rendus : un id inconnu est le plus souvent
      // l'id de la note ou un id inventé. Quand un compte-rendu est affiché,
      // c'est lui que l'utilisateur veut modifier (et il valide le diff).
      if (
        requestedEnhancedNoteId &&
        !requestedIsValid &&
        !viewedEnhancedNoteId
      ) {
        return {
          status: "error",
          code: "summary_not_in_session",
          message: `Summary "${requestedEnhancedNoteId}" does not belong to session ${sessionId}. Retry with one of these enhancedNoteId values, or omit enhancedNoteId to edit the summary the user is viewing: ${describeCandidates(candidates)}.`,
          candidates,
        };
      }

      const defaultEnhancedNoteId =
        notes.find((note) => !note.templateId)?.id ?? null;

      const enhancedNoteId =
        (requestedIsValid ? requestedEnhancedNoteId : null) ??
        viewedEnhancedNoteId ??
        defaultEnhancedNoteId ??
        (noteIds.length === 1 ? noteIds[0] : null);

      if (!enhancedNoteId) {
        return {
          status: "error",
          code: "summary_ambiguous",
          message: `Multiple summaries exist for this session. Retry with one of these enhancedNoteId values: ${describeCandidates(candidates)}.`,
          candidates,
        };
      }

      const currentContent =
        notes.find((note) => note.id === enhancedNoteId)?.markdown ?? "";

      try {
        await persistChatSessionProposal({
          id: toolCallId,
          sessionId,
          kind: "summary_replace",
          targetId: enhancedNoteId,
          currentMarkdown: currentContent,
          proposedMarkdown: params.content,
        });
      } catch {
        return {
          status: "error",
          code: "save_failed",
          message: "Failed to save the proposed summary edit.",
        };
      }

      const approved = await new Promise<boolean>((resolve) => {
        usePendingEditStore.getState().addEdit({
          requestId: toolCallId,
          sessionId,
          target: { kind: "summary", enhancedNoteId },
          currentContent,
          proposedContent: params.content,
          source: "chat",
          resolve,
        });
        // Note affichée : la revue s'affiche dans le document vivant, sans
        // ouvrir d'onglet de diff par-dessus. Sinon, onglet de revue.
        if (!revealSummaryReviewInNote(sessionId, enhancedNoteId)) {
          deps.openEditTab(toolCallId);
        }
      });

      if (!approved) {
        await declineSessionProposal(toolCallId);
        return { status: "declined" };
      }

      try {
        await applySessionProposal(toolCallId);
      } catch {
        return {
          status: "error",
          code: "apply_failed",
          message: "Failed to apply the summary edit.",
        };
      }

      return { status: "applied" };
    },
  });
