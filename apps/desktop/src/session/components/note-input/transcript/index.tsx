import type { RefObject } from "react";
import { useCallback } from "react";

import { TranscriptViewer } from "./renderer";
import { BatchState } from "./screens/batch";
import { TranscriptEmptyState } from "./screens/empty";
import { LiveTranscriptInterruptedNotice } from "./screens/interrupted";
import { TranscriptListeningState } from "./screens/listening";
import { useTranscriptScreen } from "./state";

import { useIncompleteCapture } from "~/stt/capture-result";
import { useListener } from "~/stt/contexts";
import { formatInterruptions } from "~/stt/interruptions";
import { useUploadFile } from "~/stt/useUploadFile";

export function Transcript({
  sessionId,
  scrollRef,
  editMode = false,
  onEditModeChange,
}: {
  sessionId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  editMode?: boolean;
  onEditModeChange?: (editMode: boolean) => void;
}) {
  return (
    <TranscriptContent
      key={sessionId}
      sessionId={sessionId}
      scrollRef={scrollRef}
      editMode={editMode}
      onEditModeChange={onEditModeChange}
    />
  );
}

function TranscriptContent({
  sessionId,
  scrollRef,
  editMode,
  onEditModeChange,
}: {
  sessionId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  editMode: boolean;
  onEditModeChange?: (editMode: boolean) => void;
}) {
  const screen = useTranscriptScreen({ sessionId });
  const incompleteCapture = useIncompleteCapture(sessionId);
  const { uploadAudio, uploadTranscript } = useUploadFile(sessionId);
  const stopTranscription = useListener((state) => state.stopTranscription);
  const handleStopTranscription = useCallback(() => {
    void stopTranscription(sessionId);
  }, [sessionId, stopTranscription]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {incompleteCapture && (
        <div
          role="status"
          className="border-chart-3/30 bg-chart-3/10 text-foreground border-b px-4 py-2 text-sm"
        >
          {incompleteCapture.interruptions?.length
            ? `${formatInterruptions(incompleteCapture.interruptions)}.`
            : "Ce transcript est incomplet."}
        </div>
      )}
      {screen.kind === "running_batch" && (
        <TranscriptEmptyState
          isBatching
          percentage={screen.percentage}
          phase={screen.phase}
          onStopTranscription={
            screen.phase === "importing" ? undefined : handleStopTranscription
          }
        />
      )}
      {screen.kind === "batch_fallback" && (
        <BatchState
          requestedLiveTranscription={screen.requestedLiveTranscription}
        />
      )}
      {screen.kind === "listening" && (
        <TranscriptListeningState status={screen.status} />
      )}
      {screen.kind === "empty" && (
        <TranscriptEmptyState
          isBatching={false}
          error={screen.error}
          onUploadAudio={uploadAudio}
          onUploadTranscript={uploadTranscript}
        />
      )}
      {screen.kind === "ready" && (
        <TranscriptViewer
          transcriptIds={screen.transcriptIds}
          liveSegments={screen.liveSegments}
          currentActive={screen.currentActive}
          captureGeneration={screen.captureGeneration}
          scrollRef={scrollRef}
          editMode={editMode && !screen.currentActive}
          onEditModeChange={screen.currentActive ? undefined : onEditModeChange}
          footer={
            screen.liveTranscriptInterrupted ? (
              <LiveTranscriptInterruptedNotice />
            ) : null
          }
        />
      )}
    </div>
  );
}
