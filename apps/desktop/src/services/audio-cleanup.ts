import {
  commands,
  events,
  type CaptureStatusEvent,
} from "@syntheo/plugin-transcription";
import { toast } from "@syntheo/ui/components/ui/toast";

import {
  clearCaptureAudioDeletionFailure,
  saveIncompleteCapture,
} from "~/stt/capture-result";

async function reportDeletionFailure(sessionId: string) {
  const activeSession = Boolean(sessionId);
  toast.error(
    activeSession
      ? "Audio could not be deleted"
      : "Audio cleanup could not finish",
    {
      id: activeSession ? `audio-deletion-${sessionId}` : "audio-cleanup",
      duration: Infinity,
      description: activeSession
        ? "Syntheo could not remove temporary audio and will retry cleanup automatically."
        : "Syntheo could not finish audio cleanup or recovery and will retry automatically.",
    },
  );
  if (activeSession) {
    await saveIncompleteCapture(sessionId, "audio-cleanup", false, true);
  }
}

async function reportRecoveryFailure(sessionId: string) {
  toast.error("Audio could not be recovered", {
    id: `audio-recovery-${sessionId}`,
    duration: Infinity,
    description:
      "Syntheo could not restore interrupted audio and will retry recovery automatically.",
  });
  if (sessionId) {
    await saveIncompleteCapture(sessionId, "audio-recovery", false);
  }
}

async function confirmDeletionCompleted(sessionId: string) {
  if (!sessionId) {
    toast.dismiss("audio-cleanup");
    return;
  }
  await clearCaptureAudioDeletionFailure(sessionId);
  toast.dismiss(`audio-deletion-${sessionId}`);
}

type AudioErrorEvent = Extract<CaptureStatusEvent, { type: "audio_error" }>;

async function applyCleanupStatus(payload: AudioErrorEvent): Promise<boolean> {
  if (payload.error.startsWith("audio_deletion_failed:")) {
    await reportDeletionFailure(payload.session_id);
    return true;
  }
  if (payload.error.startsWith("audio_recovery_failed:")) {
    await reportRecoveryFailure(payload.session_id);
    return true;
  }
  if (payload.error === "audio_recovery_completed") {
    // Restoring audio does not prove that the missing transcript was repaired.
    toast.dismiss(`audio-recovery-${payload.session_id}`);
    return true;
  }
  if (payload.error === "audio_deletion_completed") {
    await confirmDeletionCompleted(payload.session_id);
    return true;
  }
  return false;
}

export async function handleCaptureCleanupStatus(payload: CaptureStatusEvent) {
  if (payload.type !== "audio_error") return;
  if (!(await applyCleanupStatus(payload))) return;
  const result = await commands.acknowledgeCaptureAudioCleanupStatus(
    payload.session_id,
    payload.error,
  );
  if (result.status === "error") throw new Error(result.error);
}

export async function listenForCaptureCleanup() {
  let changedDuringRead: Set<string> | undefined = new Set();
  let pending = Promise.resolve();
  const consume = (payload: CaptureStatusEvent) => {
    pending = pending
      .then(() => handleCaptureCleanupStatus(payload))
      .catch((error) => {
        console.error(
          "[audio-cleanup] failed to persist cleanup status",
          error,
        );
      });
    return pending;
  };
  const unlisten = await events.captureStatusEvent
    .listen(({ payload }) => {
      if (
        payload.type === "audio_error" &&
        (payload.error.startsWith("audio_deletion_failed:") ||
          payload.error.startsWith("audio_recovery_failed:") ||
          payload.error === "audio_deletion_completed" ||
          payload.error === "audio_recovery_completed")
      ) {
        changedDuringRead?.add(payload.session_id);
      }
      void consume(payload);
    })
    .catch((error) => {
      console.error(
        "[audio-cleanup] failed to subscribe to cleanup status",
        error,
      );
      return () => {};
    });
  try {
    const result = await commands.getCaptureAudioCleanupStatus();
    if (result.status === "error") throw new Error(result.error);
    await Object.entries(result.data).reduce(
      (chain, [sessionId, error]) =>
        chain.then(async () => {
          if (error && !changedDuringRead?.has(sessionId)) {
            await consume({
              type: "audio_error",
              session_id: sessionId,
              is_fatal: false,
              device: null,
              error,
            });
          }
        }),
      Promise.resolve(),
    );
  } catch (error) {
    console.error("[audio-cleanup] failed to read cleanup status", error);
  } finally {
    changedDuringRead = undefined;
  }
  return unlisten;
}
