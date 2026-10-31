import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";

import { streamdownIcons } from "@syntheo/ui/components/streamdown-icons";
import { Button } from "@syntheo/ui/components/ui/button";
import { cn } from "@syntheo/utils";

import { streamdownComponents } from "../streamdown";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";
import {
  applyProposalReview,
  declineProposalReview,
  diffMarkdownLines,
  type MarkdownDiffChunk,
} from "~/session/proposal-review";
import { usePendingSessionProposals } from "~/session/queries";

export type SummaryProposal = {
  id: string;
  currentMarkdown: string;
  proposedMarkdown: string;
};

// Proposition de réécriture en attente sur le compte-rendu affiché : celle
// du chat (instantanée, dans le store) ou, à défaut, celle enregistrée en
// base (CLI, MCP, ou après un redémarrage).
export function useSummaryProposal(
  sessionId: string,
  enhancedNoteId: string,
): SummaryProposal | null {
  const edit = usePendingEditStore((state) => {
    for (const pending of state.edits.values()) {
      if (
        pending.sessionId === sessionId &&
        pending.target.kind === "summary" &&
        pending.target.enhancedNoteId === enhancedNoteId
      ) {
        return pending;
      }
    }
    return null;
  });
  const stored = usePendingSessionProposals(sessionId).find(
    (proposal) =>
      proposal.kind === "summary_replace" &&
      proposal.status === "pending" &&
      proposal.targetId === enhancedNoteId,
  );

  return useMemo(() => {
    if (edit) {
      return {
        id: edit.requestId,
        currentMarkdown: edit.currentContent,
        proposedMarkdown: edit.proposedContent,
      };
    }
    return stored
      ? {
          id: stored.id,
          currentMarkdown: stored.currentMarkdown,
          proposedMarkdown: stored.proposedMarkdown,
        }
      : null;
  }, [edit, stored]);
}

// Revue d'une proposition dans l'étape Synthèse : le diff est rendu en
// markdown (comme le compte-rendu), suppressions barrées, ajouts surlignés,
// avec Refuser / Appliquer. Remplace l'onglet de diff en markdown brut.
export function SummaryProposalReview({
  proposal,
}: {
  proposal: SummaryProposal;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const chunks = useMemo(
    () =>
      diffMarkdownLines(proposal.currentMarkdown, proposal.proposedMarkdown),
    [proposal.currentMarkdown, proposal.proposedMarkdown],
  );

  const review = async (approved: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await (approved ? applyProposalReview : declineProposalReview)(
        proposal.id,
        queryClient,
      );
    } catch (error) {
      console.error("[living-document] failed to review proposal", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t`Proposed summary edit`}
      data-proposal-review
      className="border-border bg-card flex flex-col rounded-[14px] border"
    >
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-foreground text-[13px] font-medium">
            <Trans>Proposed edit to the summary</Trans>
          </p>
          <p className="text-muted-foreground text-[12px]">
            <Trans>
              Removed text is struck through, added text is highlighted.
            </Trans>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void review(false)}
          >
            <Trans>Decline</Trans>
          </Button>
          {/* Un seul bouton primary par écran : c'est celui de la capsule. */}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void review(true)}
          >
            <Trans>Apply to summary</Trans>
          </Button>
        </div>
      </header>
      {failed ? (
        <p
          role="alert"
          className="border-alert-border bg-alert text-alert-foreground border-b px-4 py-2 text-[13px]"
        >
          <Trans>This edit could not be saved. Try again.</Trans>
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5 px-4 py-3">
        {chunks.map((chunk, index) =>
          chunk.text.trim() ? <DiffChunk key={index} chunk={chunk} /> : null,
        )}
      </div>
    </section>
  );
}

function DiffChunk({ chunk }: { chunk: MarkdownDiffChunk }) {
  const { t } = useLingui();
  const markdown = (
    <Streamdown
      icons={streamdownIcons}
      components={streamdownComponents}
      className={cn(["note-typography", "flex flex-col"])}
      linkSafety={{ enabled: false }}
    >
      {chunk.text}
    </Streamdown>
  );

  if (chunk.type === "removed") {
    return (
      <del className="border-destructive/60 bg-destructive/5 text-muted-foreground block rounded-r-md border-l-2 pl-3 line-through">
        <span className="sr-only">{t`Removed:`}</span>
        {markdown}
      </del>
    );
  }
  if (chunk.type === "added") {
    return (
      <ins className="border-primary bg-accent/60 block rounded-r-md border-l-2 pl-3 no-underline">
        <span className="sr-only">{t`Added:`}</span>
        {markdown}
      </ins>
    );
  }
  return <div>{markdown}</div>;
}
