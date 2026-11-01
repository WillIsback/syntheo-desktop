import { Trans, useLingui } from "@lingui/react/macro";
import { useRef } from "react";

import { cn } from "@syntheo/utils";

import { PerfZone } from "~/devtools-bar/perf-zone";
import { Transcript } from "~/session/components/note-input/transcript";

// Marge droite (280px) : la transcription défile pendant l'écoute et reste
// consultable en entier une fois la réunion terminée.
export function TranscriptMargin({
  sessionId,
  editMode = false,
  canEdit = false,
  onEditModeChange,
}: {
  sessionId: string;
  editMode?: boolean;
  canEdit?: boolean;
  onEditModeChange?: (editMode: boolean) => void;
}) {
  const { t } = useLingui();
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <aside
      id={`transcript-margin-${sessionId}`}
      aria-label={t`Transcription`}
      data-transcript-margin
      className="border-border text-muted-foreground flex h-full min-h-0 flex-col gap-3 border-l pl-4 text-[13px]"
    >
      <div className="flex items-center justify-between gap-2 pt-1">
        <h2 className="text-faint text-[11px] font-semibold tracking-[0.08em] uppercase">
          <Trans>Transcription</Trans>
        </h2>
        {canEdit && onEditModeChange ? (
          <button
            type="button"
            aria-pressed={editMode}
            onClick={() => onEditModeChange(!editMode)}
            className={cn([
              "text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-1.5 py-0.5 text-xs transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            ])}
          >
            {editMode ? <Trans>Done</Trans> : <Trans>Edit</Trans>}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <PerfZone id="transcript-margin">
          <Transcript
            sessionId={sessionId}
            scrollRef={scrollRef}
            editMode={editMode}
            onEditModeChange={onEditModeChange}
          />
        </PerfZone>
      </div>
    </aside>
  );
}
