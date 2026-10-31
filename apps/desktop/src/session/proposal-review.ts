import type { QueryClient } from "@tanstack/react-query";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";
import {
  applySessionProposal,
  declineSessionProposal,
} from "~/session/queries";
import type { SessionProposalRecord } from "~/session/queries/proposals";
import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";

export function shouldAutoDeclineProposal(source?: string): boolean {
  return source !== "cli" && source !== "mcp";
}

export function closeProposalReviewTab(requestId: string): void {
  const tabs = useTabs.getState();
  const reviewTab = tabs.tabs.find(
    (tab) => tab.type === "edit" && tab.requestId === requestId,
  );
  if (reviewTab) {
    tabs.close(reviewTab);
  }
}

export function openProposalReview(requestId: string): void {
  useTabs.getState().openNew({ type: "edit", requestId });
}

export async function applyProposalReview(
  requestId: string,
  queryClient?: QueryClient,
): Promise<void> {
  await applySessionProposal(requestId);
  usePendingEditStore.getState().resolveEdit(requestId, true);
  closeProposalReviewTab(requestId);
  await invalidateSessionProposals(queryClient);
}

export async function declineProposalReview(
  requestId: string,
  queryClient?: QueryClient,
): Promise<void> {
  await declineSessionProposal(requestId);
  usePendingEditStore.getState().resolveEdit(requestId, false);
  closeProposalReviewTab(requestId);
  await invalidateSessionProposals(queryClient);
}

// Revue d'un compte-rendu dans le document vivant (étape Synthèse) plutôt
// que dans un onglet de diff : si la note est celle affichée et qu'elle
// n'écoute pas, on y montre le compte-rendu visé, qui affiche la revue.
export function revealSummaryReviewInNote(
  sessionId: string,
  enhancedNoteId: string,
): boolean {
  const { currentTab, updateSessionTabState } = useTabs.getState();
  if (currentTab?.type !== "sessions" || currentTab.id !== sessionId) {
    return false;
  }
  const mode = listenerStore.getState().getSessionMode(sessionId);
  if (mode === "active" || mode === "finalizing") {
    return false;
  }
  updateSessionTabState(currentTab, {
    ...currentTab.state,
    view: { type: "enhanced", id: enhancedNoteId },
  });
  return true;
}

export function reviewPendingProposal(
  proposal: Pick<
    SessionProposalRecord,
    "id" | "sessionId" | "kind" | "targetId"
  >,
): void {
  if (
    proposalKindLabel(proposal.kind) === "summary" &&
    revealSummaryReviewInNote(proposal.sessionId, proposal.targetId)
  ) {
    return;
  }
  openProposalReview(proposal.id);
}

export type MarkdownDiffChunk = {
  type: "same" | "removed" | "added";
  text: string;
};

// Diff ligne à ligne (plus longue sous-suite commune) entre le compte-rendu
// actuel et la proposition, regroupé en blocs pour être rendu en markdown.
export function diffMarkdownLines(
  current: string,
  proposed: string,
): MarkdownDiffChunk[] {
  const before = current.trim() ? current.split("\n") : [];
  const after = proposed.trim() ? proposed.split("\n") : [];
  const rows = before.length;
  const cols = after.length;
  const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const chunks: MarkdownDiffChunk[] = [];
  const push = (type: MarkdownDiffChunk["type"], line: string) => {
    const last = chunks[chunks.length - 1];
    if (last?.type === type) {
      last.text += `\n${line}`;
    } else {
      chunks.push({ type, text: line });
    }
  };
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && before[i] === after[j]) {
      push("same", before[i]);
      i++;
      j++;
    } else if (i < rows && (j >= cols || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // Suppressions avant ajouts : on lit l'ancien texte puis le nouveau.
      push("removed", before[i]);
      i++;
    } else {
      push("added", after[j]);
      j++;
    }
  }
  return chunks;
}

export function proposalKindLabel(
  kind: SessionProposalRecord["kind"],
): "memo" | "summary" {
  return kind === "memo_replace" ? "memo" : "summary";
}

async function invalidateSessionProposals(
  queryClient: QueryClient | undefined,
): Promise<void> {
  if (!queryClient) {
    return;
  }
  await queryClient.invalidateQueries({ queryKey: ["session-proposals"] });
}
