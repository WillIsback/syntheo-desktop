import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  beginCloudsyncActivity,
  endCloudsyncActivity,
} from "@syntheo/plugin-db";

import { BatchResponseProcessingError } from "./batch-response-processing-error";
import { completeCaptureTranscript } from "./capture-completion";
import {
  canRunBatchTranscription,
  EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE,
  getBatchProvider,
  getSessionSpeakerCount,
  isTerminalTranscriptionError,
} from "./useRunBatch";
import { useRunBatch } from "./useRunBatch";

vi.mock("./capture-completion", () => ({
  completeCaptureTranscript: vi.fn().mockResolvedValue(undefined),
}));

const {
  startTranscriptionMock,
  stopTranscriptionMock,
  useListenerMock,
  useSessionMock,
  useSessionParticipantsMock,
  useSTTConnectionMock,
  useBillingAccessMock,
  useConfigValueMock,
  isSupportedLanguagesBatchMock,
  toastWarningMock,
  deleteProcessedAudioForRetentionMock,
  saveBatchTranscriptMock,
  reconcileRefinedSpeakerClustersMock,
  notifyBatchCompletedMock,
  idMock,
  archMock,
  platformMock,
} = vi.hoisted(() => ({
  startTranscriptionMock: vi.fn(),
  stopTranscriptionMock: vi.fn(),
  useListenerMock: vi.fn(),
  useSessionMock: vi.fn(),
  useSessionParticipantsMock: vi.fn(),
  useSTTConnectionMock: vi.fn(),
  useBillingAccessMock: vi.fn(),
  useConfigValueMock: vi.fn(),
  isSupportedLanguagesBatchMock: vi.fn(),
  toastWarningMock: vi.fn(),
  deleteProcessedAudioForRetentionMock: vi.fn(),
  saveBatchTranscriptMock: vi.fn(),
  reconcileRefinedSpeakerClustersMock: vi.fn(),
  notifyBatchCompletedMock: vi.fn(),
  idMock: vi.fn(),
  archMock: vi.fn(),
  platformMock: vi.fn(),
}));

vi.mock("@syntheo/plugin-transcription", () => ({
  commands: {
    saveBatchTranscript: saveBatchTranscriptMock,
    reconcileRefinedSpeakerClusters: reconcileRefinedSpeakerClustersMock,
  },
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  arch: archMock,
  platform: platformMock,
}));

vi.mock("./contexts", () => ({
  useListener: useListenerMock,
}));

vi.mock("./useKeywords", () => ({
  getSessionKeywords: vi.fn(async () => []),
  useKeywords: vi.fn(() => []),
}));

vi.mock("./useSTTConnection", () => ({
  useSTTConnection: useSTTConnectionMock,
}));

vi.mock("@syntheo/ui/components/ui/toast", () => ({
  toast: {
    warning: toastWarningMock,
  },
}));

vi.mock("~/billing/billing-context", () => ({
  useBillingAccess: useBillingAccessMock,
}));

vi.mock("~/env", () => ({
  env: {
    VITE_API_URL: "https://api.test",
  },
}));

vi.mock("~/services/audio-retention", () => ({
  deleteProcessedAudioForRetention: deleteProcessedAudioForRetentionMock,
  normalizeAudioRetention: (value: unknown) =>
    typeof value === "string" ? value : "forever",
}));

vi.mock("~/session/queries", () => ({
  useSession: useSessionMock,
  useSessionParticipants: useSessionParticipantsMock,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: useConfigValueMock,
}));

vi.mock("~/shared/utils", () => ({
  id: idMock,
}));

vi.mock("~/stt/capabilities", () => {
  const baseLanguageCode = (language: string) =>
    language.split(/[-_]/)[0]?.toLowerCase() ?? "";

  return {
    getTranscriptionLanguages: (
      mainLanguage: string | null | undefined,
      spokenLanguages: readonly string[] | null | undefined,
    ) => {
      const seen = new Set<string>();
      const languages: string[] = [];

      for (const language of [mainLanguage, ...(spokenLanguages ?? [])]) {
        if (!language) {
          continue;
        }

        const baseCode = baseLanguageCode(language);
        if (!baseCode || seen.has(baseCode)) {
          continue;
        }

        seen.add(baseCode);
        languages.push(language);
      }

      return languages;
    },
    isSupportedLanguagesBatch: isSupportedLanguagesBatchMock,
  };
});

vi.mock("~/store/zustand/listener/general-batch", () => ({
  acknowledgeCompletedBatch: vi.fn(async () => {}),
  notifyBatchCompleted: notifyBatchCompletedMock,
}));

describe("getBatchProvider", () => {
  test.each([
    ["openai", "gpt-4o-transcribe", "openai"],
    ["openai", "mistralai/Voxtral-Mini-3B-2507", "openai"],
    ["nvidia", "nemotron-asr-streaming", null],
    ["deepgram", "nova-3", null],
  ] as const)("maps %s/%s to %s", (provider, model, expected) => {
    expect(getBatchProvider(provider, model)).toBe(expected);
  });
});

describe("canRunBatchTranscription", () => {
  test("allows post-capture batch so useRunBatch can choose a fallback", () => {
    expect(canRunBatchTranscription(null)).toBe(true);
    expect(
      canRunBatchTranscription({
        provider: "custom",
        model: "realtime-only",
      }),
    ).toBe(true);
  });
});

describe("isTerminalTranscriptionError", () => {
  test("stops retries after a provider response cannot be processed", () => {
    expect(
      isTerminalTranscriptionError(
        new BatchResponseProcessingError(new Error("database is locked")),
      ),
    ).toBe(true);
  });

  test.each([
    "Bad Request: failed to process audio: corrupt or unsupported data",
    "No speech detected",
    "Authentication failed: 401 Unauthorized",
    EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE,
  ])("classifies permanent failures: %s", (message) => {
    expect(isTerminalTranscriptionError(new Error(message))).toBe(true);
  });

  test.each([
    "request timed out",
    "429 Too Many Requests",
    "503 Service Unavailable",
    "database is locked",
    "nova-3 is not available for batch transcription",
    "STT connection is not available",
  ])("leaves transient failures retryable: %s", (message) => {
    expect(isTerminalTranscriptionError(new Error(message))).toBe(false);
  });
});

describe("useRunBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveBatchTranscriptMock.mockImplementation(async (request) => ({
      status: "ok",
      data: {
        status: "saved",
        transcript_id: request.transcript_id,
      },
    }));
    stopTranscriptionMock.mockResolvedValue(undefined);
    archMock.mockReturnValue("aarch64");
    platformMock.mockReturnValue("macos");

    let nextId = 0;
    idMock.mockImplementation(() => `generated-${++nextId}`);
    notifyBatchCompletedMock.mockResolvedValue(undefined);
    deleteProcessedAudioForRetentionMock.mockResolvedValue(undefined);
    isSupportedLanguagesBatchMock.mockResolvedValue(true);
    useListenerMock.mockImplementation((selector) =>
      selector({
        startTranscription: startTranscriptionMock,
        stopTranscription: stopTranscriptionMock,
      }),
    );
    useSessionMock.mockReturnValue({
      id: "session-1",
      user_id: "user-1",
      raw_md: "Existing memo",
    });
    useSessionParticipantsMock.mockReturnValue([]);
    useSTTConnectionMock.mockReturnValue({
      conn: {
        provider: "openai",
        model: "whisper-large-v3",
        baseUrl: "http://192.168.1.87:8000/v1",
        apiKey: "test-key",
      },
    });
    useBillingAccessMock.mockReturnValue({
      isPaid: false,
    });
    useConfigValueMock.mockImplementation((key) =>
      key === "ai_language" ? "en" : [],
    );
  });

  test("does not start a dictation transcription after a pre-aborted signal", async () => {
    const abort = new AbortController();
    abort.abort();
    const { result } = renderHook(() => useRunBatch("dictation"));
    await expect(
      result.current("/tmp/voice.wav", { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(startTranscriptionMock).not.toHaveBeenCalled();
  });

  test("run_batch_uses_local_provider_without_cloud_session", async () => {
    // Même un état « payant » hérité ne déclenche plus de session cloud :
    // le batch part sur l'endpoint on-premise configuré.
    useBillingAccessMock.mockReturnValue({ isPaid: true });
    useSTTConnectionMock.mockReturnValue({
      conn: {
        provider: "openai",
        model: "voxtral",
        baseUrl: "http://192.168.1.87:8000/v1",
        apiKey: "local-key",
      },
    });
    startTranscriptionMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useRunBatch("dictation"));
    await result.current("/tmp/voice.wav").catch(() => undefined);
    expect(startTranscriptionMock).toHaveBeenCalledOnce();
    expect(startTranscriptionMock.mock.calls[0]?.[0]).toMatchObject({
      provider: "openai",
      model: "voxtral",
      base_url: "http://192.168.1.87:8000/v1",
      api_key: "local-key",
    });
  });

  test("cancels the active provider and never retries authentication after abort", async () => {
    const abort = new AbortController();
    useSTTConnectionMock.mockReturnValue({
      conn: {
        provider: "openai",
        model: "whisper-large-v3",
        baseUrl: "http://192.168.1.87:8000/v1",
        apiKey: "local-key",
      },
    });
    let fail!: (reason: Error) => void;
    startTranscriptionMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const { result } = renderHook(() => useRunBatch("dictation"));
    const run = result.current("/tmp/voice.wav", { signal: abort.signal });
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(startTranscriptionMock).toHaveBeenCalledOnce());
    abort.abort();
    const persist = startTranscriptionMock.mock.calls[0]?.[1]?.handlePersist;
    expect(() =>
      persist?.(
        [{ text: "cancelled", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      ),
    ).not.toThrow();
    fail(
      new Error(
        "Authentication failed. Please check your API key in settings.",
      ),
    );
    await rejected;
    expect(stopTranscriptionMock).toHaveBeenCalledWith("dictation");
    expect(startTranscriptionMock).toHaveBeenCalledOnce();
    expect(saveBatchTranscriptMock).not.toHaveBeenCalled();
  });

  test("retries cancellation after native startup finishes", async () => {
    const abort = new AbortController();
    let started!: () => void;
    startTranscriptionMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          started = resolve;
        }),
    );
    const { result } = renderHook(() => useRunBatch("dictation"));
    const run = result.current("/tmp/voice.wav", { signal: abort.signal });
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(startTranscriptionMock).toHaveBeenCalledOnce());
    abort.abort();
    expect(stopTranscriptionMock).not.toHaveBeenCalled();
    started();
    await rejected;
    expect(stopTranscriptionMock).toHaveBeenCalledTimes(1);
  });

  test("imported_audio_is_deleted_after_transcription", async () => {
    useConfigValueMock.mockImplementation((key) =>
      key === "audio_retention" ? "forever" : key === "ai_language" ? "en" : [],
    );
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "hello", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      );
    });
    const { result } = renderHook(() => useRunBatch("session-1"));
    await act(async () => {
      await result.current("/tmp/imported.mp3");
    });
    expect(deleteProcessedAudioForRetentionMock).toHaveBeenCalledWith(
      "none",
      "session-1",
    );
  });

  test("promotes the complete streamed transcript before retention", async () => {
    let finishTranscription: (() => void) | undefined;
    startTranscriptionMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishTranscription = resolve;
        }),
    );

    const { result } = renderHook(() => useRunBatch("session-1"));
    const run = result.current("/tmp/session.wav", {
      promotion: { scope: "whole_session" },
    });

    await waitFor(() => {
      expect(startTranscriptionMock).toHaveBeenCalledTimes(1);
    });
    const persist = startTranscriptionMock.mock.calls[0]?.[1]?.handlePersist;
    persist?.([{ text: "hello", start_ms: 0, end_ms: 100, channel: 0 }], []);
    persist?.([{ text: "world", start_ms: 100, end_ms: 200, channel: 0 }], []);

    expect(saveBatchTranscriptMock).not.toHaveBeenCalled();
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
    expect(notifyBatchCompletedMock).not.toHaveBeenCalled();

    finishTranscription?.();
    await act(async () => await run);

    expect(beginCloudsyncActivity).toHaveBeenCalledWith(
      "transcription",
      "session-1:generated-1",
    );
    expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "session-1",
        transcript_id: expect.any(String),
        owner_user_id: "user-1",
        created_at: expect.any(String),
        started_at: expect.any(Number),
        memo: "Existing memo",
        provider: "openai",
        model: "whisper-large-v3",
        promotion: { scope: "whole_session" },
        mark_audio_complete: true,
        words: [
          expect.objectContaining({ text: "hello" }),
          expect.objectContaining({ text: "world" }),
        ],
        hints: [],
      }),
    );
    expect(deleteProcessedAudioForRetentionMock).toHaveBeenCalledTimes(1);
    expect(startTranscriptionMock.mock.calls[0]?.[1]?.notifyOnCompletion).toBe(
      false,
    );
    expect(notifyBatchCompletedMock).toHaveBeenCalledOnce();
    expect(saveBatchTranscriptMock.mock.invocationCallOrder[0]).toBeLessThan(
      notifyBatchCompletedMock.mock.invocationCallOrder[0],
    );
    expect(saveBatchTranscriptMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteProcessedAudioForRetentionMock.mock.invocationCallOrder[0],
    );
    expect(
      deleteProcessedAudioForRetentionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(endCloudsyncActivity).mock.invocationCallOrder[0]!,
    );
  });

  test("capture repair saves its original interval while deferring audio finalization", async () => {
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "recovered", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      );
    });

    const { result } = renderHook(() => useRunBatch("session-1"));

    await act(async () => {
      await result.current("/tmp/session.wav", {
        deferAudioFinalization: true,
        captureInterval: { startedAtMs: 1000, stoppedAtMs: 2000 },
        promotion: { scope: "whole_session" },
      });
    });

    expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({ mark_audio_complete: false, started_at: 1000 }),
    );
    expect(completeCaptureTranscript).toHaveBeenCalledWith(
      "session-1",
      saveBatchTranscriptMock.mock.calls[0][0].transcript_id,
      2000,
    );
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
  });

  test("repairs a chunk separately from live capture and waits for its database commit", async () => {
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "recovered", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      );
    });
    let commit!: () => void;
    const persist = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          commit = resolve;
        }),
    );
    const { result } = renderHook(() => useRunBatch("session-1"));
    let completed = false;
    const run = result
      .current("/tmp/chunk.mp3", { recovery: { persist } })
      .then(() => {
        completed = true;
      });
    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(startTranscriptionMock.mock.calls[0]?.[0]).toMatchObject({
      session_id: "session-1:recovery",
    });
    expect(startTranscriptionMock.mock.calls[0]?.[1]).toMatchObject({
      recovery: true,
    });
    expect(completed).toBe(false);
    expect(saveBatchTranscriptMock).not.toHaveBeenCalled();
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
    commit();
    await act(async () => await run);
    expect(completed).toBe(true);
  });

  test("cancels only the background repair when its capture ends", async () => {
    const abort = new AbortController();
    let finish!: () => void;
    startTranscriptionMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const persist = vi.fn();
    const { result } = renderHook(() => useRunBatch("session-1"));
    const run = result.current("/tmp/chunk.mp3", {
      signal: abort.signal,
      recovery: { persist },
    });
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(startTranscriptionMock).toHaveBeenCalledOnce());
    abort.abort();
    finish();
    await rejected;
    expect(stopTranscriptionMock).toHaveBeenCalledWith("session-1:recovery");
    expect(stopTranscriptionMock).not.toHaveBeenCalledWith("session-1");
    expect(persist).not.toHaveBeenCalled();
  });

  test("does not make completed provider work retryable when persistence fails", async () => {
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "recovered", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      );
    });
    saveBatchTranscriptMock.mockRejectedValueOnce(
      new Error("disk write failed"),
    );

    const { result } = renderHook(() => useRunBatch("session-1"));
    let processingError: unknown;

    await act(async () => {
      try {
        await result.current("/tmp/session.wav", {
          deferAudioFinalization: true,
          promotion: { scope: "whole_session" },
        });
      } catch (error) {
        processingError = error;
      }
    });

    expect(processingError).toBeInstanceOf(BatchResponseProcessingError);
    expect(isTerminalTranscriptionError(processingError)).toBe(true);
    expect(startTranscriptionMock).toHaveBeenCalledOnce();
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
  });

  test("does not save for custom batch persist handlers", async () => {
    const handlePersist = vi.fn();
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "custom", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      );
    });

    const { result } = renderHook(() => useRunBatch("session-1"));

    await act(async () => {
      await result.current("/tmp/session.wav", { handlePersist });
    });

    expect(handlePersist).toHaveBeenCalledTimes(1);
    expect(saveBatchTranscriptMock).not.toHaveBeenCalled();
  });

  test("promotes post-stop batch by replacing the live current capture", async () => {
    useConfigValueMock.mockImplementation((key) =>
      key === "remember_speakers" ? true : key === "ai_language" ? "en" : [],
    );
    saveBatchTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      data: {
        status: "saved",
        transcript_id: "saved-transcript-id",
      },
    });
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [
          { text: "old", start_ms: 10_000, end_ms: 10_500, channel: 0 },
          { text: "new", start_ms: 60_100, end_ms: 60_500, channel: 0 },
        ],
        [
          {
            wordIndex: 0,
            data: {
              type: "provider_speaker_index",
              speaker_index: 0,
            },
          },
          {
            wordIndex: 1,
            data: {
              type: "provider_speaker_index",
              speaker_index: 1,
            },
          },
        ],
        { mode: "replace" },
      );
    });

    const { result } = renderHook(() => useRunBatch("session-1"));

    await act(async () => {
      await result.current("/tmp/session.wav", {
        promotion: {
          scope: "current_capture",
          audioOffsetMs: 60_000,
          replaceTranscriptId: "transcript-current-live",
          startedAt: 123_000,
        },
      });
    });

    expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "session-1",
        transcript_id: expect.any(String),
        promotion: {
          scope: "current_capture",
          audio_offset_ms: 60_000,
          replace_transcript_id: "transcript-current-live",
          started_at: 123_000,
        },
        mark_audio_complete: true,
        words: expect.arrayContaining([
          expect.objectContaining({ text: "old", start_ms: 10_000 }),
          expect.objectContaining({ text: "new", start_ms: 60_100 }),
        ]),
        hints: expect.arrayContaining([
          expect.objectContaining({ type: "provider_speaker_index" }),
        ]),
      }),
    );
  });

  test("passes staged speaker hints to the atomic save command", async () => {
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [
          {
            text: "answer",
            start_ms: 60_100,
            end_ms: 60_500,
            channel: 1,
          },
        ],
        [
          {
            wordIndex: 0,
            data: {
              type: "provider_speaker_index",
              channel: 1,
              speaker_index: 3,
            },
          },
        ],
        { mode: "replace" },
      );
    });

    const { result } = renderHook(() => useRunBatch("session-1"));
    await act(async () => {
      await result.current("/tmp/session.wav", {
        promotion: {
          scope: "current_capture",
          audioOffsetMs: 60_000,
          replaceTranscriptId: "transcript-current-live",
          startedAt: 123_000,
        },
      });
    });

    expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: {
          scope: "current_capture",
          audio_offset_ms: 60_000,
          replace_transcript_id: "transcript-current-live",
          started_at: 123_000,
        },
        words: [expect.objectContaining({ text: "answer", channel: 1 })],
        hints: [
          expect.objectContaining({
            type: "provider_speaker_index",
            value: '{"provider":"openai","channel":1,"speaker_index":3}',
          }),
        ],
      }),
    );
  });

  test.each(["current_capture", "whole_session"] as const)(
    "keeps saved data when Rust reports truncation for %s refinement",
    async (scope) => {
      saveBatchTranscriptMock.mockResolvedValueOnce({
        status: "ok",
        data: { status: "truncated" },
      });
      startTranscriptionMock.mockImplementation(async (_params, options) => {
        options.handlePersist(
          [
            {
              text: "replacement",
              start_ms: 60_100,
              end_ms: 61_000,
              channel: 0,
            },
          ],
          [],
          { mode: "replace" },
        );
      });

      const { result } = renderHook(() => useRunBatch("session-1"));
      let error: unknown;
      await act(async () => {
        try {
          await result.current("/tmp/session.wav", {
            promotion:
              scope === "current_capture"
                ? {
                    scope,
                    audioOffsetMs: 60_000,
                    replaceTranscriptId: "transcript-current-live",
                    startedAt: 123_000,
                  }
                : { scope },
          });
        } catch (caught) {
          error = caught;
        }
      });

      expect(error).toMatchObject({
        message:
          "The new transcription returned much less text. Your saved transcript and recording were kept. Try transcribing again.",
      });
      expect(isTerminalTranscriptionError(error)).toBe(true);
      expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          promotion:
            scope === "current_capture"
              ? {
                  scope,
                  audio_offset_ms: 60_000,
                  replace_transcript_id: "transcript-current-live",
                  started_at: 123_000,
                }
              : { scope },
        }),
      );
      expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
      expect(notifyBatchCompletedMock).not.toHaveBeenCalled();
    },
  );

  test.each(["current_capture", "whole_session"] as const)(
    "keeps existing data when Rust cannot save the %s transcript",
    async (scope) => {
      saveBatchTranscriptMock.mockResolvedValueOnce({
        status: "error",
        error: "database is unavailable",
      });
      startTranscriptionMock.mockImplementation(async (_params, options) => {
        options.handlePersist(
          [{ text: "replacement", start_ms: 0, end_ms: 100, channel: 0 }],
          [],
        );
      });
      const { result } = renderHook(() => useRunBatch("session-1"));

      await expect(
        act(async () => {
          await result.current("/tmp/session.wav", {
            promotion:
              scope === "current_capture"
                ? {
                    scope,
                    audioOffsetMs: 0,
                    replaceTranscriptId: "live-current",
                    startedAt: 123_000,
                  }
                : { scope },
          });
        }),
      ).rejects.toBeInstanceOf(BatchResponseProcessingError);

      expect(saveBatchTranscriptMock).toHaveBeenCalledOnce();
      expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
      expect(notifyBatchCompletedMock).not.toHaveBeenCalled();
    },
  );

  test("retains recovery audio when the batch has no current-capture words", async () => {
    saveBatchTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      data: { status: "empty_current_capture" },
    });
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "old", start_ms: 10_000, end_ms: 10_500, channel: 0 }],
        [],
        { mode: "replace" },
      );
    });

    const { result } = renderHook(() => useRunBatch("session-1"));

    await expect(
      act(async () => {
        await result.current("/tmp/session.wav", {
          promotion: {
            scope: "current_capture",
            audioOffsetMs: 60_000,
            replaceTranscriptId: "transcript-current-live",
            startedAt: 123_000,
          },
        });
      }),
    ).rejects.toThrow(EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE);

    expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: {
          scope: "current_capture",
          audio_offset_ms: 60_000,
          replace_transcript_id: "transcript-current-live",
          started_at: 123_000,
        },
        words: [expect.objectContaining({ text: "old", start_ms: 10_000 })],
      }),
    );
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
  });

  test("retains recovery audio when the batch emits no words", async () => {
    saveBatchTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      data: { status: "empty_current_capture" },
    });
    startTranscriptionMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRunBatch("session-1"));

    await expect(
      act(async () => {
        await result.current("/tmp/session.wav", {
          promotion: {
            scope: "current_capture",
            audioOffsetMs: 60_000,
            replaceTranscriptId: "transcript-current-live",
            startedAt: 123_000,
          },
        });
      }),
    ).rejects.toThrow(EMPTY_CURRENT_CAPTURE_TRANSCRIPT_ERROR_MESSAGE);

    expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: {
          scope: "current_capture",
          audio_offset_ms: 60_000,
          replace_transcript_id: "transcript-current-live",
          started_at: 123_000,
        },
        words: [],
      }),
    );
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
  });

  test("does not finalize a batch when Rust saving returns an error result", async () => {
    saveBatchTranscriptMock.mockResolvedValueOnce({
      status: "error",
      error: "save IPC failed",
    });
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "replacement", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      );
    });
    const { result } = renderHook(() => useRunBatch("session-1"));

    await expect(
      act(async () => await result.current("/tmp/session.wav")),
    ).rejects.toBeInstanceOf(BatchResponseProcessingError);

    expect(saveBatchTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: { scope: "preserve_existing" },
        mark_audio_complete: true,
      }),
    );
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
  });

  test("does not replace the live transcript when batch transcription fails", async () => {
    startTranscriptionMock.mockImplementation(async (_params, options) => {
      options.handlePersist(
        [{ text: "partial", start_ms: 0, end_ms: 100, channel: 0 }],
        [],
      );
      throw new Error("provider failed");
    });

    const { result } = renderHook(() => useRunBatch("session-1"));

    await expect(
      act(async () => {
        await result.current("/tmp/session.wav");
      }),
    ).rejects.toThrow("provider failed");

    expect(saveBatchTranscriptMock).not.toHaveBeenCalled();
    expect(deleteProcessedAudioForRetentionMock).not.toHaveBeenCalled();
  });

  test("passes selected transcription languages to batch transcription", async () => {
    useSTTConnectionMock.mockReturnValue({
      conn: {
        provider: "openai",
        model: "whisper-large-v3",
        baseUrl: "http://192.168.1.87:8000/v1",
        apiKey: "",
      },
    });
    useConfigValueMock.mockImplementation((key) =>
      key === "ai_language" ? "de" : ["en"],
    );
    startTranscriptionMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRunBatch("session-1"));

    await act(async () => {
      await result.current("/tmp/session.wav");
    });

    expect(startTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "whisper-large-v3",
        languages: ["de", "en"],
      }),
      expect.any(Object),
    );
  });

  test.each(["windows", "linux"] as const)(
    "reports a language mismatch instead of a platform gap when an on-prem model is configured on %s",
    async (currentPlatform) => {
      platformMock.mockReturnValue(currentPlatform);
      isSupportedLanguagesBatchMock.mockResolvedValue(false);
      useSTTConnectionMock.mockReturnValue({
        conn: {
          provider: "openai",
          model: "voxtral-mini-2602",
          baseUrl: "http://192.168.1.87:8000/v1",
          apiKey: "",
        },
      });

      const { result } = renderHook(() => useRunBatch("session-1"));

      await expect(
        act(async () => {
          await result.current("/tmp/session.wav");
        }),
      ).rejects.toThrow(
        "voxtral-mini-2602 is not available for batch transcription with the selected languages",
      );

      expect(startTranscriptionMock).not.toHaveBeenCalled();
      expect(toastWarningMock).not.toHaveBeenCalled();
    },
  );

  test.each(["windows", "linux", "macos"] as const)(
    "uses on-prem OpenAI-compatible batch endpoints on %s",
    async (currentPlatform) => {
      platformMock.mockReturnValue(currentPlatform);
      useSTTConnectionMock.mockReturnValue({
        conn: {
          provider: "openai",
          model: "realtime-only",
          baseUrl: "https://custom.test",
          apiKey: "custom-key",
        },
      });

      const { result } = renderHook(() => useRunBatch("session-1"));

      await act(async () => {
        await result.current("/tmp/session.wav");
      });

      expect(startTranscriptionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openai",
          model: "realtime-only",
          base_url: "https://custom.test",
          api_key: "custom-key",
        }),
        expect.any(Object),
      );
      expect(toastWarningMock).not.toHaveBeenCalled();
    },
  );
});

describe("no local fallback", () => {
  test("no_local_fallback_when_endpoint_has_no_batch", async () => {
    platformMock.mockReturnValue("macos");
    archMock.mockReturnValue("aarch64");
    useBillingAccessMock.mockReturnValue({ isPaid: true });
    useSTTConnectionMock.mockReturnValue({
      conn: {
        provider: "nvidia",
        model: "nemotron-asr-streaming",
        baseUrl: "http://192.168.1.87:9000?provider=nvidia",
        apiKey: "",
      },
    });
    startTranscriptionMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRunBatch("session-1"));

    await expect(
      act(async () => {
        await result.current("/tmp/session.wav");
      }),
    ).rejects.toThrow();
    expect(startTranscriptionMock).not.toHaveBeenCalled();
  });
});

describe("getSessionSpeakerCount", () => {
  test("counts distinct session participants plus the current user", () => {
    expect(
      getSessionSpeakerCount(["human-a", "human-a", "human-b"], "self"),
    ).toBe(3);
  });

  test("returns undefined until at least two speakers are known", () => {
    expect(getSessionSpeakerCount(["human-a"], null)).toBe(undefined);
  });
});
