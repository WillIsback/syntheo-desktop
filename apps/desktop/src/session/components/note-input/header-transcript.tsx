import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";

import { CheckCircle, PencilSimple } from "@syntheo/ui/components/icons";
import { DancingSticks } from "@syntheo/ui/components/ui/dancing-sticks";
import { Spinner } from "@syntheo/ui/components/ui/spinner";
import { toast } from "@syntheo/ui/components/ui/toast";
import { cn } from "@syntheo/utils";

import { IconHeaderView, copyTextToClipboard } from "./header-shared";
import { TranscriptAudioIcon } from "./header-transcript-icon";

import {
  buildTranscriptExportSegments,
  formatTranscriptExportSegments,
} from "~/session/components/note-input/transcript/export-data";
import { getSessionTranscriptRenderRequest } from "~/session/components/note-input/transcript/render-request-hooks";
import { useHasTranscript } from "~/session/components/shared";
import {
  type MenuItemDef,
  useNativeContextMenu,
} from "~/shared/hooks/useNativeContextMenu";
import { useListener } from "~/stt/contexts";
import { useLiveAmplitude } from "~/stt/live-meters";
import { useSessionTranscriptMetadata } from "~/stt/queries";
import { useStartListeningWithBatchOverride } from "~/stt/useStartListeningWithBatchOverride";
import {
  isMainWebviewWindow,
  requestMainListenerControl,
} from "~/stt/window-control";

export function HeaderViewTranscript({
  isActive,
  isTranscribing,
  editMode = false,
  onEditModeChange,
  onClick = () => {},
  sessionId,
}: {
  isActive: boolean;
  isTranscribing: boolean;
  editMode?: boolean;
  onEditModeChange?: (editMode: boolean) => void;
  onClick?: () => void;
  sessionId: string;
}) {
  const liveState = useTranscriptLiveViewState(sessionId);

  if (!isActive) {
    return (
      <HeaderViewTranscriptButton
        isActive={isActive}
        isTranscribing={isTranscribing}
        onClick={onClick}
        live={liveState.live}
      />
    );
  }

  return (
    <HeaderViewTranscriptActive
      isActive={isActive}
      isTranscribing={isTranscribing}
      editMode={editMode}
      onEditModeChange={onEditModeChange}
      onClick={onClick}
      sessionId={sessionId}
      live={liveState.live}
    />
  );
}

function HeaderViewTranscriptButton({
  isActive,
  isTranscribing,
  onClick,
  onContextMenu,
  live,
  suffixIcon,
  pressed,
}: {
  isActive: boolean;
  isTranscribing: boolean;
  onClick?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  suffixIcon?: React.ReactNode;
  pressed?: boolean;
  live?: {
    sessionId: string;
    muted: boolean;
  };
}) {
  const { t } = useLingui();

  return (
    <IconHeaderView
      isActive={isActive}
      label={t`Transcript`}
      hoverLabel={undefined}
      icon={
        live ? (
          <HeaderViewTranscriptLiveIcon live={live} />
        ) : isTranscribing ? (
          <Spinner size={16} className="shrink-0" />
        ) : (
          <TranscriptAudioIcon />
        )
      }
      suffixIcon={suffixIcon}
      pressed={pressed}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={undefined}
      className={cn([
        live
          ? [
              "group/transcript-live",
              isActive
                ? "w-[98px] min-w-[98px] gap-1.5 px-2 @max-[480px]:w-10 @max-[480px]:min-w-10 @max-[480px]:gap-0"
                : null,
              isActive
                ? ["bg-alert text-alert-foreground hover:bg-alert-border"]
                : null,
            ]
          : null,
      ])}
    />
  );
}

function HeaderViewTranscriptLiveIcon({
  live,
}: {
  live: {
    sessionId: string;
    muted: boolean;
  };
}) {
  return (
    <span className="relative flex size-4 items-center justify-center">
      {live.muted ? (
        <TranscriptAudioIcon />
      ) : (
        <LiveDancingSticks sessionId={live.sessionId} />
      )}
    </span>
  );
}

// Seul consommateur du niveau sonore dans l'en-tête : il est le seul à se
// redessiner dix fois par seconde.
function LiveDancingSticks({ sessionId }: { sessionId: string }) {
  return (
    <DancingSticks
      amplitude={useLiveAmplitude(sessionId)}
      color="hsl(var(--recording))"
      height={16}
      width={16}
    />
  );
}

function useTranscriptLiveViewState(sessionId: string) {
  const { mode, muted } = useListener((state) => ({
    mode: state.getSessionMode(sessionId),
    muted: state.live.muted,
  }));
  return {
    live: mode === "active" ? { sessionId, muted } : undefined,
  };
}

function HeaderViewTranscriptActive({
  isActive,
  isTranscribing,
  editMode,
  onEditModeChange,
  onClick,
  sessionId,
  live,
}: {
  isActive: boolean;
  isTranscribing: boolean;
  editMode: boolean;
  onEditModeChange?: (editMode: boolean) => void;
  onClick?: () => void;
  sessionId: string;
  live?: {
    sessionId: string;
    muted: boolean;
  };
}) {
  const { t } = useLingui();
  const startListening = useStartListeningWithBatchOverride(sessionId);
  const hasTranscript = useHasTranscript(sessionId);
  const transcriptMetadata = useSessionTranscriptMetadata(sessionId);
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const canEdit =
    sessionMode === "inactive" && hasTranscript && Boolean(onEditModeChange);
  const handleClick = useCallback(() => {
    if (canEdit) {
      onEditModeChange?.(!editMode);
      return;
    }

    onClick?.();
  }, [canEdit, editMode, onClick, onEditModeChange]);
  const canCopyTranscript = transcriptMetadata.some((meta) => meta.hasWords);
  const handleCopyTranscript = useCallback(async () => {
    try {
      const transcriptExportRequest =
        await getSessionTranscriptRenderRequest(sessionId);
      if (!transcriptExportRequest) {
        return;
      }

      const transcriptSegments = await buildTranscriptExportSegments(
        transcriptExportRequest,
      );
      const transcriptText = formatTranscriptExportSegments(transcriptSegments);
      if (!transcriptText) {
        return;
      }

      await copyTextToClipboard(transcriptText, {
        success: t`Transcript copied to clipboard`,
        error: t`Failed to copy transcript`,
      });
    } catch (error) {
      console.error("Failed to copy transcript", error);
      toast.error(t`Failed to copy transcript`);
    }
  }, [sessionId, t]);
  const handleResumeListening = useCallback(() => {
    if (!isMainWebviewWindow()) {
      void requestMainListenerControl("start", sessionId);
      return;
    }

    void startListening();
  }, [sessionId, startListening]);
  const contextMenu = useMemo<MenuItemDef[]>(() => {
    const items: MenuItemDef[] = [
      {
        id: `copy-transcript-${sessionId}`,
        text: t`Copy`,
        action: () => {
          void handleCopyTranscript();
        },
        disabled: !canCopyTranscript,
      },
    ];

    if (sessionMode === "inactive" || sessionMode === "running_batch") {
      items.push({
        id: `resume-listening-${sessionId}`,
        text: t`Resume listening`,
        action: handleResumeListening,
      });
    }

    // Ni retranscription ni suppression d'enregistrement : aucun audio n'est
    // conservé.
    return items;
  }, [
    canCopyTranscript,
    handleCopyTranscript,
    handleResumeListening,
    sessionMode,
    sessionId,
    t,
  ]);
  const showContextMenu = useNativeContextMenu(contextMenu);

  return (
    <HeaderViewTranscriptButton
      isActive={isActive}
      isTranscribing={isTranscribing}
      onClick={handleClick}
      onContextMenu={showContextMenu}
      live={live}
      suffixIcon={
        canEdit ? (
          editMode ? (
            <CheckCircle aria-hidden className="size-3.5" />
          ) : (
            <PencilSimple aria-hidden className="size-3.5" />
          )
        ) : undefined
      }
      pressed={canEdit ? editMode : undefined}
    />
  );
}
