import { useCallback, useRef } from "react";

import { commands as fsSyncCommands } from "@syntheo/plugin-fs-sync";
import {
  commands as listenerCommands,
  type StoppedCapture,
} from "@syntheo/plugin-transcription";

import { getAudioDurationMs, useCaptureLifecycle } from "./capture-lifecycle";
import { useListener } from "./contexts";

import {
  clearCaptureAudioSaved,
  clearCaptureLifecycleMarker,
  hasPendingZeroRetentionAudio,
  loadCaptureLifecycleMarker,
} from "~/stt/capture-lifecycle-storage";

export function useResumeListeningLifecycle(sessionId: string) {
  const attachLiveSession = useListener((state) => state.attachLiveSession);
  const beginCaptureRecoveryFinalization = useListener(
    (state) => state.beginCaptureRecoveryFinalization,
  );
  const finishCaptureRecoveryFinalization = useListener(
    (state) => state.finishCaptureRecoveryFinalization,
  );
  const { createCaptureLifecycle } = useCaptureLifecycle(sessionId);
  const createCaptureLifecycleRef = useRef(createCaptureLifecycle);
  createCaptureLifecycleRef.current = createCaptureLifecycle;
  const recoveryAttemptRef = useRef<{
    sessionId: string;
    lifecycleState: Promise<{
      lifecycle: ReturnType<typeof createCaptureLifecycle>;
      ensureMarker: () => Promise<void>;
      hasMarker: () => boolean;
    }>;
    stoppedProcessingRef: { current: Promise<void> | null };
  } | null>(null);
  const ownsRecoveryFinalizationRef = useRef(false);

  return useCallback(
    async (options?: {
      abandonOnFailure?: boolean;
      // Stopped captures wait for the user unless they asked to process them.
      processStopped?: boolean;
    }) => {
      let attempt = recoveryAttemptRef.current;
      if (!attempt || attempt.sessionId !== sessionId) {
        const stoppedProcessingRef = {
          current: null as Promise<void> | null,
        };
        const lifecycleState = loadCaptureLifecycleMarker(sessionId).then(
          (recoveredMarker) => {
            let markerInstalled = Boolean(recoveredMarker);
            let markerWrite: Promise<void> | null = null;
            const lifecycle = createCaptureLifecycleRef.current(
              recoveredMarker ?? undefined,
            );
            return {
              lifecycle,
              hasMarker: () => markerInstalled,
              ensureMarker: () => {
                if (markerInstalled) {
                  return Promise.resolve();
                }
                markerWrite ??= lifecycle.persistMarker().then(
                  () => {
                    markerInstalled = true;
                  },
                  (error) => {
                    markerWrite = null;
                    throw error;
                  },
                );
                return markerWrite;
              },
            };
          },
        );
        attempt = { sessionId, lifecycleState, stoppedProcessingRef };
        recoveryAttemptRef.current = attempt;
        void lifecycleState.catch((error) => {
          console.error(
            "[listener] failed to load capture recovery state",
            error,
          );
        });
      }

      const { lifecycleState, stoppedProcessingRef } = attempt;
      let state: Awaited<typeof lifecycleState> | undefined;
      let stoppedCapture: StoppedCapture | null = null;
      const readStoppedCapture = async (): Promise<StoppedCapture | null> => {
        try {
          const result = await listenerCommands.getStoppedCapture(sessionId);
          if (result.status === "error") {
            console.error(
              "[listener] failed to get stopped capture",
              result.error,
            );
            return null;
          }
          return result.data;
        } catch (error) {
          console.error("[listener] failed to get stopped capture", error);
          return null;
        }
      };
      const acknowledgeStoppedOutcome = async () => {
        if (!stoppedCapture) return;
        const stoppedAtMs = stoppedCapture.stopped_at_ms;
        try {
          const result = await listenerCommands.acknowledgeStoppedCapture(
            sessionId,
            stoppedAtMs,
          );
          if (result.status === "error") {
            console.error(
              "[listener] failed to acknowledge stopped capture",
              result.error,
            );
          }
        } catch (error) {
          console.error(
            "[listener] failed to acknowledge stopped capture",
            error,
          );
        }
      };
      const failRecovery = async ({
        clearMarker = true,
      }: { clearMarker?: boolean } = {}) => {
        if (!options?.abandonOnFailure) {
          return "error" as const;
        }

        if (clearMarker) {
          try {
            const marker = await loadCaptureLifecycleMarker(sessionId);
            // Aucun audio à proposer à l'utilisateur : un marqueur qui
            // retient encore de l'audio (hérité) est seulement conservé.
            if (marker && !hasPendingZeroRetentionAudio(marker)) {
              await clearCaptureLifecycleMarker(sessionId, marker.transcriptId);
            }
          } catch (error) {
            console.error(
              "[listener] failed to clear exhausted capture recovery",
              error,
            );
          }
        }

        try {
          await state?.lifecycle.releaseCloudsyncLease();
        } catch (error) {
          console.error(
            "[listener] failed to release exhausted capture recovery",
            error,
          );
        }

        if (ownsRecoveryFinalizationRef.current) {
          finishCaptureRecoveryFinalization(sessionId);
          ownsRecoveryFinalizationRef.current = false;
        }
        recoveryAttemptRef.current = null;
        await acknowledgeStoppedOutcome();
        return "error" as const;
      };
      try {
        state = await lifecycleState;
        stoppedCapture = await readStoppedCapture();
        await state.lifecycle.acquireCloudsyncLease();
      } catch (error) {
        console.error(
          "[listener] failed to prepare capture recovery state",
          error,
        );
        const lifecycleStateUnavailable = !state;
        if (
          lifecycleStateUnavailable &&
          recoveryAttemptRef.current === attempt
        ) {
          recoveryAttemptRef.current = null;
        }
        return failRecovery({ clearMarker: !lifecycleStateUnavailable });
      }

      let result: Awaited<ReturnType<typeof attachLiveSession>>;
      try {
        result = await attachLiveSession(sessionId, {
          handlePersist: (delta) => {
            void state.lifecycle
              .acquireCloudsyncLease()
              .then(() => state.lifecycle.handlePersist(delta))
              .catch((error) => {
                console.error(
                  "[listener] failed to recover transcript persistence",
                  error,
                );
              });
          },
          onStopped: (stoppedSessionId, details) => {
            const processing = state.lifecycle
              .acquireCloudsyncLease()
              .then(() =>
                state.lifecycle.onStopped(stoppedSessionId, {
                  ...details,
                  needsBatchRepair: true,
                }),
              );
            stoppedProcessingRef.current = processing;
            return processing;
          },
        });
      } catch (error) {
        console.error("[listener] failed to attach capture recovery", error);
        return failRecovery();
      }

      if (result === "attached") {
        try {
          await state.lifecycle.startAudioRecovery();
          await state.ensureMarker();
        } catch (error) {
          console.error(
            "[listener] failed to prepare capture recovery state",
            error,
          );
          return options?.abandonOnFailure ? result : ("error" as const);
        }
        return result;
      }
      if (stoppedCapture === null) {
        stoppedCapture = await readStoppedCapture();
      }
      if (result === "error") {
        const stoppedProcessing = stoppedProcessingRef.current;
        if (stoppedProcessing) {
          try {
            await stoppedProcessing;
          } catch (error) {
            console.error(
              "[listener] failed to recover stopped capture",
              error,
            );
            if (stoppedProcessingRef.current === stoppedProcessing) {
              stoppedProcessingRef.current = null;
            }
          }
        }
        return failRecovery();
      }
      if (stoppedProcessingRef.current) {
        const stoppedProcessing = stoppedProcessingRef.current;
        try {
          await stoppedProcessing;
        } catch (error) {
          console.error("[listener] failed to recover stopped capture", error);
          if (stoppedProcessingRef.current === stoppedProcessing) {
            stoppedProcessingRef.current = null;
          }
          return failRecovery();
        }
        if (await loadCaptureLifecycleMarker(sessionId)) {
          if (stoppedProcessingRef.current === stoppedProcessing) {
            stoppedProcessingRef.current = null;
          }
        } else {
          await acknowledgeStoppedOutcome();
          if (ownsRecoveryFinalizationRef.current) {
            finishCaptureRecoveryFinalization(sessionId);
            ownsRecoveryFinalizationRef.current = false;
          }
          return "inactive" as const;
        }
      }

      const pendingMarker = state.hasMarker()
        ? await loadCaptureLifecycleMarker(sessionId)
        : null;
      if (!pendingMarker) {
        if (ownsRecoveryFinalizationRef.current) {
          finishCaptureRecoveryFinalization(sessionId);
          ownsRecoveryFinalizationRef.current = false;
        }
        await state.lifecycle.releaseCloudsyncLease();
        await acknowledgeStoppedOutcome();
        return "inactive" as const;
      }

      // Syntheo ne conserve pas l'audio : rien n'attend l'utilisateur. Une
      // capture arrêtée hors de l'interface est finalisée (transcript, résumé)
      // et l'audio hérité éventuel est traité puis supprimé (rétention nulle).
      if (!ownsRecoveryFinalizationRef.current) {
        if (!beginCaptureRecoveryFinalization(sessionId)) {
          return failRecovery({ clearMarker: false });
        }
        ownsRecoveryFinalizationRef.current = true;
      }

      let audioPath: string | null = null;
      let durationSeconds = 0;
      try {
        const pathResult = await fsSyncCommands.audioPath(sessionId);
        if (pathResult.status === "ok") {
          audioPath = pathResult.data;
          durationSeconds =
            ((await getAudioDurationMs(pathResult.data)) ?? 0) / 1_000;
        } else if (pathResult.error !== "audio_path_not_found") {
          throw new Error(pathResult.error);
        }
        await state.lifecycle.recoverStopped(sessionId, {
          durationSeconds,
          stoppedAtMs: stoppedCapture?.stopped_at_ms,
          audioPath,
          requestedLiveTranscription:
            stoppedCapture?.requested_live_transcription ?? true,
          liveTranscriptionActive:
            stoppedCapture?.live_transcription_active ?? false,
          chunkedAudio: stoppedCapture?.chunked_audio,
          needsBatchRepair: true,
        });
      } catch (error) {
        console.error("[listener] failed to recover stopped capture", error);
        return failRecovery();
      }

      if (await loadCaptureLifecycleMarker(sessionId)) {
        return failRecovery();
      }
      await clearCaptureAudioSaved(sessionId).catch((error) => {
        console.error("[listener] failed to clear capture audio state", error);
      });
      finishCaptureRecoveryFinalization(sessionId);
      ownsRecoveryFinalizationRef.current = false;
      await acknowledgeStoppedOutcome();
      return "inactive" as const;
    },
    [
      attachLiveSession,
      beginCaptureRecoveryFinalization,
      finishCaptureRecoveryFinalization,
      sessionId,
    ],
  );
}
