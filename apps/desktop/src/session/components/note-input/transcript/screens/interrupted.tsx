import { useEffect, useState } from "react";

import { cn } from "@syntheo/utils";

import { useStoredSettingValue } from "~/settings/queries";
import { useListener } from "~/stt/contexts";
import {
  getLiveTranscriptPausedMessage,
  getLiveTranscriptResumedMessage,
} from "~/stt/live-transcript-interrupted";

// Durée d'affichage de « Transcription en direct reprise. » après une coupure.
const RESUMED_NOTICE_MS = 4_000;

export function LiveTranscriptInterruptedNotice({
  className,
}: {
  className?: string;
}) {
  const degraded = useListener((state) => state.live.degraded);
  const sttProvider = useStoredSettingValue("current_stt_provider").value;

  return (
    <p
      role="status"
      data-live-transcript-state="paused"
      className={cn([
        "text-muted-foreground mx-auto max-w-md px-6 text-center text-sm leading-relaxed",
        className,
      ])}
    >
      {getLiveTranscriptPausedMessage({ degraded, sttProvider })}
    </p>
  );
}

// Bas de la marge pendant l'écoute : « en pause / reconnexion » tant que le
// flux est coupé, puis une confirmation brève de la reprise.
export function LiveTranscriptStatusNotice({
  interrupted,
}: {
  interrupted: boolean;
}) {
  const [wasInterrupted, setWasInterrupted] = useState(interrupted);
  const [showResumed, setShowResumed] = useState(false);

  if (interrupted !== wasInterrupted) {
    setWasInterrupted(interrupted);
    setShowResumed(!interrupted);
  }

  useEffect(() => {
    if (!showResumed) {
      return;
    }
    const timeout = setTimeout(() => setShowResumed(false), RESUMED_NOTICE_MS);
    return () => clearTimeout(timeout);
  }, [showResumed]);

  if (interrupted) {
    return <LiveTranscriptInterruptedNotice />;
  }

  if (!showResumed) {
    return null;
  }

  return (
    <p
      role="status"
      data-live-transcript-state="resumed"
      className="text-muted-foreground mx-auto max-w-md px-6 text-center text-sm leading-relaxed"
    >
      {getLiveTranscriptResumedMessage()}
    </p>
  );
}
