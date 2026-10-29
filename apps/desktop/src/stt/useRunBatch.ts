import { useCallback } from "react";

import {
  commands as transcriptionCommands,
  type BatchRefinementSource,
  type BatchProvider,
  type BatchTranscriptPromotion,
  type StoredSpeakerHint,
  type StoredTranscriptWord,
  type TranscriptionParams,
} from "@syntheo/plugin-transcription";

import { BatchResponseProcessingError } from "./batch-response-processing-error";
import { completeCaptureTranscript } from "./capture-completion";
import { useListener } from "./contexts";
import { persistTranscriptWrite } from "./persist-retry";
import { useSTTConnection } from "./useSTTConnection";

import { withCloudsyncActivity } from "~/db/cloudsync-activity";
import { deleteProcessedAudioForRetention } from "~/services/audio-retention";
import { useSession, useSessionParticipants } from "~/session/queries";
import { useConfigValue } from "~/shared/config";
import { id } from "~/shared/utils";
import {
  acknowledgeCompletedBatch,
  notifyBatchCompleted,
} from "~/store/zustand/listener/general-batch";
import type { BatchPersistCallback } from "~/store/zustand/listener/transcript";
import { serializeBatchResumeContext } from "~/stt/batch-resume-context";
import {
  getTranscriptionLanguages,
  isSupportedLanguagesBatch,
} from "~/stt/capabilities";
import type { TranscriptRecord } from "~/stt/queries";
import type { SpeakerHintWithId, WordWithId } from "~/stt/types";

type RunOptions = {
  signal?: AbortSignal;
  /**
   * Audio transmis en mémoire (dictée) : prioritaire sur le chemin de fichier,
   * et jamais écrit sur le disque. Base64, car Tauri sérialise `Vec<u8>` en
   * tableau de nombres.
   */
  audio?: { data_base64: string; file_name: string };
  recovery?: {
    persist: (words: WordWithId[], hints: SpeakerHintWithId[]) => Promise<void>;
  };
  deferAudioFinalization?: boolean;
  handlePersist?: BatchPersistCallback;
  notifyOnCompletion?: boolean;
  resume?: { provider: BatchProvider; model: string };
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  keywords?: string[];
  languages?: string[];
  numSpeakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
  promotion?: RunOptionsPromotion;
  captureInterval?: { startedAtMs: number; stoppedAtMs: number };
};

type RunOptionsPromotion =
  | { scope: "preserve_existing" }
  | { scope: "whole_session" }
  | {
      scope: "current_capture";
      audioOffsetMs: number;
      replaceTranscriptId?: string;
      startedAt: number;
    };

function toStoredTranscriptWord(word: WordWithId): StoredTranscriptWord {
  return {
    ...word,
    metadata: word.metadata as StoredTranscriptWord["metadata"],
  };
}

function toStoredSpeakerHint(hint: SpeakerHintWithId): StoredSpeakerHint {
  return {
    id: hint.id,
    word_id: hint.word_id ?? undefined,
    type: hint.type ?? "",
    value: hint.value as StoredSpeakerHint["value"],
  };
}

function toSpeakerHintWithId(hint: StoredSpeakerHint): SpeakerHintWithId {
  return {
    id: hint.id,
    word_id: hint.word_id ?? "",
    type: hint.type,
    value: hint.value as SpeakerHintWithId["value"],
  };
}

function toBatchRefinementSource(
  transcript: TranscriptRecord,
): BatchRefinementSource {
  return {
    id: transcript.id,
    started_at: transcript.startedAt,
    words: transcript.words.map(toStoredTranscriptWord),
    speaker_hints: transcript.speakerHints.map(toStoredSpeakerHint),
  };
}

export async function reconcileRefinedSpeakerClusters(
  source: TranscriptRecord,
  words: WordWithId[],
  hints: SpeakerHintWithId[],
): Promise<SpeakerHintWithId[]> {
  const result = await transcriptionCommands.reconcileRefinedSpeakerClusters({
    source: toBatchRefinementSource(source),
    words: words.map(toStoredTranscriptWord),
    hints: hints.map(toStoredSpeakerHint),
  });
  if (result.status === "error") throw new Error(result.error);
  return result.data.map(toSpeakerHintWithId);
}

const STOPPED_TRANSCRIPTION_ERROR_MESSAGE = "Transcription stopped.";
export const EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE =
  "Batch transcription did not include the current recording.";
const INCOMPLETE_BATCH_TRANSCRIPT_ERROR_MESSAGE =
  "The new transcription returned much less text. Your saved transcript and recording were kept. Try transcribing again.";
const NO_SPEECH_RECOVERY_ERROR_MESSAGE = "No speech was detected in the audio.";

export function getBatchProvider(
  provider: string,
  _model: string,
): TranscriptionParams["provider"] | null {
  // NVIDIA NIM ne propose que le temps réel ; l'import passe par le protocole
  // OpenAI (/v1/audio/transcriptions).
  if (provider === "openai") return "openai";
  return null;
}

export function canRunBatchTranscription(
  _conn: { provider: string; model: string } | null,
  _modelOverride?: string,
) {
  return true;
}

async function canUseBatchTarget(
  provider: TranscriptionParams["provider"],
  model: string,
  languages: readonly string[],
) {
  return isSupportedLanguagesBatch(provider, model, languages);
}

function selectedProviderLabel(
  conn: { provider: string; model: string } | null,
  modelOverride?: string,
) {
  if (!conn) {
    return "the selected speech-to-text provider";
  }

  return modelOverride ?? conn.model ?? conn.provider;
}

export function isStoppedTranscriptionError(error: unknown) {
  return (
    (error instanceof Error ? error.message : String(error)) ===
    STOPPED_TRANSCRIPTION_ERROR_MESSAGE
  );
}

function isTranscriptionAuthenticationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /authentication failed|invalid_token|unauthorized|\b401\b/i.test(
    message,
  );
}

export function isTerminalTranscriptionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    error instanceof BatchResponseProcessingError ||
    message === EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE ||
    message === INCOMPLETE_BATCH_TRANSCRIPT_ERROR_MESSAGE ||
    isTranscriptionAuthenticationError(error) ||
    /corrupt or unsupported|unsupported (?:audio|data)|invalid audio|no speech|empty transcript/i.test(
      message,
    ) ||
    /\b(?:400|403|404|413|415|422)\b|bad request|invalid api key/i.test(message)
  );
}

export function getSessionSpeakerCount(
  participantHumanIds: Iterable<string>,
  selfHumanId?: string | null,
): number | undefined {
  const humanIds = new Set(Array.from(participantHumanIds).filter(Boolean));

  if (typeof selfHumanId === "string" && selfHumanId) {
    humanIds.add(selfHumanId);
  }

  return humanIds.size > 1 ? humanIds.size : undefined;
}

function isRecoveryNoSpeechError(
  options: RunOptions | undefined,
  error: unknown,
): boolean {
  return (
    Boolean(options?.recovery) &&
    error instanceof Error &&
    error.message === NO_SPEECH_RECOVERY_ERROR_MESSAGE
  );
}

function isTerminalBatchSaveError(error: unknown): boolean {
  if (error instanceof BatchResponseProcessingError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message === EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE ||
    error.message === INCOMPLETE_BATCH_TRANSCRIPT_ERROR_MESSAGE
  );
}

function toBatchTranscriptPromotion(
  promotion: RunOptionsPromotion,
): BatchTranscriptPromotion {
  if (promotion.scope === "current_capture") {
    return {
      scope: "current_capture",
      audio_offset_ms: promotion.audioOffsetMs,
      replace_transcript_id: promotion.replaceTranscriptId,
      started_at: promotion.startedAt,
    };
  }
  return { scope: promotion.scope };
}

export const useRunBatch = (sessionId: string) => {
  const session = useSession(sessionId);
  const participants = useSessionParticipants(sessionId);

  const startTranscription = useListener((state) => state.startTranscription);
  const stopTranscription = useListener((state) => state.stopTranscription);
  const { conn } = useSTTConnection();
  const aiLanguage = useConfigValue("ai_language");
  const spokenLanguages = useConfigValue("spoken_languages");
  const dictionaryTerms = useConfigValue("personalization_dictionary_terms");
  // Règle audio de Syntheo : l'audio traité est toujours supprimé.
  const audioRetention = "none" as const;

  return useCallback(
    async (filePath: string, options?: RunOptions) => {
      options?.signal?.throwIfAborted();
      if (!startTranscription) {
        throw new Error(
          "STT connection is not available. Please configure your speech-to-text provider.",
        );
      }

      const languages =
        options?.languages ??
        getTranscriptionLanguages(aiLanguage, spokenLanguages);
      const selectedProviderId = options?.provider ?? conn?.provider;
      const selectedModel = options?.model ?? conn?.model;
      const selectedProvider =
        selectedProviderId && selectedModel
          ? getBatchProvider(selectedProviderId, selectedModel)
          : null;
      const selectedTarget =
        conn && selectedModel && selectedProvider
          ? {
              provider: selectedProvider,
              model: selectedModel,
              baseUrl: options?.baseUrl ?? conn.baseUrl,
              apiKey: options?.apiKey ?? conn.apiKey,
              label: selectedModel,
            }
          : null;
      const selectedTargetSupported = selectedTarget
        ? await canUseBatchTarget(
            selectedTarget.provider,
            selectedTarget.model,
            languages,
          )
        : false;
      options?.signal?.throwIfAborted();
      // Aucun repli : sans endpoint on-prem capable de batch, l'import échoue.
      const fallbackTarget = selectedTargetSupported ? selectedTarget : null;
      const target = options?.resume
        ? {
            provider: options.resume.provider,
            model: options.resume.model,
            baseUrl: conn?.baseUrl ?? "",
            apiKey: conn?.apiKey ?? "",
            label: options.resume.model,
          }
        : fallbackTarget;

      if (!target) {
        throw new Error(
          selectedTarget
            ? `${selectedProviderLabel(conn, selectedModel)} is not available for batch transcription with the selected languages. Choose languages it supports, or configure another speech-to-text provider.`
            : `${selectedProviderLabel(conn, selectedModel)} is not available for batch transcription on this platform. Configure a batch-capable speech-to-text provider.`,
        );
      }

      const createdAt = new Date().toISOString();
      const startedAt = options?.captureInterval?.startedAtMs ?? Date.now();
      const memoMd = session?.raw_md ?? "";
      let keywords = options?.keywords;
      if (keywords === undefined) {
        const { getSessionKeywords } = await import("./useKeywords");
        keywords = await getSessionKeywords({
          sessionId,
          dictionaryTerms,
        });
      }
      options?.signal?.throwIfAborted();
      let transcriptId: string | null = null;
      const inferredNumSpeakers =
        options?.numSpeakers === undefined &&
        options?.minSpeakers === undefined &&
        options?.maxSpeakers === undefined
          ? getSessionSpeakerCount(
              participants
                .filter((participant) => participant.source !== "excluded")
                .map((participant) => participant.humanId),
              session?.user_id,
            )
          : undefined;

      const handlePersist: BatchPersistCallback | undefined =
        options?.handlePersist;
      let stagedWords: WordWithId[] = [];
      let stagedHints: SpeakerHintWithId[] = [];

      const persist: BatchPersistCallback =
        handlePersist ??
        ((words, hints, persistOptions) => {
          if (words.length === 0) {
            return;
          }

          const newWords: WordWithId[] = [];
          const newWordIds: string[] = [];

          words.forEach((word) => {
            const wordId = id();

            newWords.push({
              id: wordId,
              text: word.text,
              start_ms: word.start_ms,
              end_ms: word.end_ms,
              channel: word.channel,
              metadata: word.metadata
                ? JSON.stringify(word.metadata)
                : undefined,
            });

            newWordIds.push(wordId);
          });

          const newHints: SpeakerHintWithId[] = [];

          hints.forEach((hint) => {
            if (hint.data.type !== "provider_speaker_index") {
              return;
            }

            const wordId = newWordIds[hint.wordIndex];
            const word = words[hint.wordIndex];

            if (!wordId || !word) {
              return;
            }

            newHints.push({
              id: id(),
              word_id: wordId,
              type: "provider_speaker_index",
              value: JSON.stringify({
                provider: hint.data.provider ?? target.provider,
                channel: hint.data.channel ?? word.channel,
                speaker_index: hint.data.speaker_index,
              }),
            });
          });

          transcriptId ??= id();
          if (persistOptions?.mode === "replace") {
            stagedWords = [];
            stagedHints = [];
          }
          stagedWords.push(...newWords);
          stagedHints.push(...newHints);
        });

      const jobId = options?.recovery ? `${sessionId}:recovery` : sessionId;
      const resumeContext =
        !handlePersist &&
        !options?.recovery &&
        !options?.deferAudioFinalization &&
        options?.promotion?.scope === "whole_session"
          ? serializeBatchResumeContext({ promotion: "whole_session" })
          : null;
      const params: TranscriptionParams = {
        session_id: jobId,
        provider: target.provider,
        file_path: filePath,
        audio: options?.audio,
        model: target.model,
        base_url: target.baseUrl,
        api_key: target.apiKey,
        keywords,
        languages,
        num_speakers: options?.numSpeakers ?? inferredNumSpeakers,
        min_speakers: options?.minSpeakers,
        max_speakers: options?.maxSpeakers,
        resume_context: resumeContext,
      };

      const run = async (batchParams: TranscriptionParams) => {
        options?.signal?.throwIfAborted();
        try {
          await startTranscription(batchParams, {
            signal: options?.signal,
            handlePersist: (...args) => {
              if (options?.signal?.aborted) return;
              return persist(...args);
            },
            notifyOnCompletion: false,
            recovery: Boolean(options?.recovery),
          });
          options?.signal?.throwIfAborted();
        } finally {
          if (options?.signal?.aborted) {
            await stopTranscription(jobId).catch(() => {});
          }
        }
      };

      const saveBatchResults = async () => {
        const promotion = options?.promotion ?? {
          scope: "preserve_existing",
        };
        const refinementPromotion = toBatchTranscriptPromotion(promotion);
        const saved = await persistTranscriptWrite(async () => {
          const result = await transcriptionCommands.saveBatchTranscript({
            session_id: sessionId,
            transcript_id: transcriptId,
            owner_user_id: session?.user_id ?? "",
            created_at: createdAt,
            started_at: startedAt,
            memo: memoMd,
            provider: target.provider,
            model: target.model,
            words: stagedWords.map(toStoredTranscriptWord),
            hints: stagedHints.map(toStoredSpeakerHint),
            promotion: refinementPromotion,
            mark_audio_complete: !options?.deferAudioFinalization,
          });
          if (result.status === "error") {
            throw new Error(result.error);
          }
          return result.data;
        });
        if (saved.status === "empty_current_capture") {
          throw new Error(EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE);
        }
        if (saved.status === "truncated") {
          throw new Error(INCOMPLETE_BATCH_TRANSCRIPT_ERROR_MESSAGE);
        }
        if (
          saved.status === "saved" &&
          saved.transcript_id &&
          options?.captureInterval
        ) {
          await persistTranscriptWrite(() =>
            completeCaptureTranscript(
              sessionId,
              saved.transcript_id!,
              options.captureInterval!.stoppedAtMs,
            ),
          );
        }
      };

      const cloudsyncLeaseKey = `${sessionId}:${id()}`;
      return withCloudsyncActivity(
        "transcription",
        cloudsyncLeaseKey,
        async () => {
          try {
            await run(params);
          } catch (error) {
            options?.signal?.throwIfAborted();
            if (!isRecoveryNoSpeechError(options, error)) {
              throw error;
            }
          }

          if (options?.recovery) {
            options.signal?.throwIfAborted();
            await options.recovery.persist(stagedWords, stagedHints);
            await acknowledgeCompletedBatch(jobId);
            return;
          }

          try {
            if (!handlePersist) {
              await saveBatchResults();
            }
            if (!options?.deferAudioFinalization) {
              await deleteProcessedAudioForRetention(audioRetention, sessionId);
            }
          } catch (error) {
            if (isTerminalBatchSaveError(error)) {
              throw error;
            }
            throw new BatchResponseProcessingError(error);
          }
          await acknowledgeCompletedBatch(jobId);
          if (options?.notifyOnCompletion !== false) {
            await notifyBatchCompleted();
          }
        },
      );
    },
    [
      conn,
      aiLanguage,
      dictionaryTerms,
      session,
      participants,
      spokenLanguages,
      startTranscription,
      stopTranscription,
      sessionId,
    ],
  );
};
