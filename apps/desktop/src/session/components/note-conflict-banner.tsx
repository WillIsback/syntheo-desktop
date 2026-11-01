import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Warning } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";

import { VersionHistoryDialog } from "./version-history-dialog";

import {
  applySessionConflict,
  resolveSessionConflicts,
  useSessionConflicts,
} from "~/session/queries";

export function NoteConflictBanner({ sessionId }: { sessionId: string }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMounted, setHistoryMounted] = useState(false);
  const conflicts = useSessionConflicts(sessionId);
  const newestConflict = conflicts[0];

  const keepMutation = useMutation({
    mutationFn: () => resolveSessionConflicts(sessionId),
  });
  const useOtherMutation = useMutation({
    mutationFn: () => {
      if (!newestConflict) return Promise.resolve();
      return applySessionConflict(sessionId, newestConflict);
    },
  });
  const busy = keepMutation.isPending || useOtherMutation.isPending;

  const openHistory = () => {
    setHistoryMounted(true);
    setHistoryOpen(true);
  };

  return (
    <>
      {conflicts.length > 0 && (
        <div className="shrink-0 px-1 pt-1 pb-2">
          <div className="border-chart-3/35 bg-chart-3/10 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border px-3 py-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <Warning
                className="text-chart-3 mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p className="text-foreground text-[13px] leading-5 font-medium">
                <Trans>
                  This note was edited on another device at the same time. The
                  later edit was kept.
                </Trans>
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => keepMutation.mutate()}
              >
                <Trans>Keep this version</Trans>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !newestConflict}
                onClick={() => useOtherMutation.mutate()}
              >
                <Trans>Use the other version</Trans>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={openHistory}
              >
                <Trans>History</Trans>
              </Button>
            </div>
          </div>
        </div>
      )}
      {historyMounted && (
        <VersionHistoryDialog
          sessionId={sessionId}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      )}
    </>
  );
}
