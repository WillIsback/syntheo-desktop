import { Trans } from "@lingui/react/macro";
import { useCallback } from "react";

import { Trash } from "@syntheo/ui/components/icons";
import { DropdownMenuItem } from "@syntheo/ui/components/ui/dropdown-menu";
import { cn } from "@syntheo/utils";

import { useDeleteSession } from "~/session/hooks/useDeleteSession";
import { useSessionSummary } from "~/session/queries";

export function DeleteNote({ sessionId }: { sessionId: string }) {
  const deleteSession = useDeleteSession();
  const title = useSessionSummary(sessionId)?.title;

  const handleDeleteNote = useCallback(() => {
    deleteSession(sessionId, { title });
  }, [sessionId, deleteSession, title]);

  return (
    <DropdownMenuItem
      onClick={handleDeleteNote}
      className={cn([
        "text-destructive cursor-pointer",
        "hover:bg-alert hover:text-alert-foreground",
      ])}
    >
      <Trash />
      <span>
        <Trans>Delete</Trans>
      </span>
    </DropdownMenuItem>
  );
}
