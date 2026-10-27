import { beforeEach, describe, expect, test, vi } from "vitest";

const { isSupportedLanguagesBatchMock, isSupportedLanguagesLiveMock } =
  vi.hoisted(() => ({
    isSupportedLanguagesBatchMock: vi.fn(),
    isSupportedLanguagesLiveMock: vi.fn(),
  }));

vi.mock("@syntheo/plugin-transcription", () => ({
  commands: {
    isSupportedLanguagesBatch: isSupportedLanguagesBatchMock,
    isSupportedLanguagesLive: isSupportedLanguagesLiveMock,
  },
}));

import {
  getLiveTranscriptionConfig,
  getSttModelTranscriptionMode,
  getTranscriptionLanguages,
  isConfiguredSttModel,
  isSupportedLanguagesBatch,
  isSupportedLanguagesLive,
} from "./capabilities";

beforeEach(() => {
  vi.clearAllMocks();
  isSupportedLanguagesLiveMock.mockResolvedValue({
    status: "ok",
    data: true,
  });
  isSupportedLanguagesBatchMock.mockResolvedValue({
    status: "ok",
    data: true,
  });
});

describe("getSttModelTranscriptionMode", () => {
  test("distinguishes external batch and realtime model variants", () => {
    expect(getSttModelTranscriptionMode("openai", "gpt-live-transcribe")).toBe(
      "live",
    );
    expect(getSttModelTranscriptionMode("openai", "gpt-transcribe")).toBe(
      "batch",
    );
    expect(
      getSttModelTranscriptionMode("openai", "gpt-4o-transcribe-diarize"),
    ).toBe("batch");
    expect(getSttModelTranscriptionMode("openai", "whisper-1")).toBe("batch");
    expect(
      getSttModelTranscriptionMode(
        "openai",
        "mistralai/Voxtral-Mini-4B-Realtime-2602",
      ),
    ).toBe("live");
    expect(
      getSttModelTranscriptionMode("nvidia", "nemotron-asr-streaming"),
    ).toBe("live");
  });

  test("leaves models without an explicit mode to provider inference", () => {
    expect(getSttModelTranscriptionMode("openai", undefined)).toBeUndefined();
    expect(getSttModelTranscriptionMode("deepgram", "nova-3")).toBeUndefined();
  });
});

describe("isConfiguredSttModel", () => {
  test.each([
    { provider: "openai", model: "whisper-large-v3", expected: true },
    { provider: "nvidia", model: "nemotron-asr-streaming", expected: true },
    { provider: "openai", model: "", expected: false },
    { provider: "", model: "whisper-large-v3", expected: false },
  ])("$provider/$model -> $expected", ({ provider, model, expected }) => {
    expect(isConfiguredSttModel(provider, model)).toBe(expected);
  });
});

describe("getLiveTranscriptionConfig", () => {
  test.each([
    {
      provider: "openai",
      model: "gpt-live-transcribe",
      languages: ["en", "ko"],
      expected: { languages: ["en", "ko"], transcriptionMode: "live" },
      checksLiveLanguages: true,
    },
    {
      provider: "openai",
      model: "gpt-transcribe",
      languages: ["en", "ko"],
      expected: { languages: ["en", "ko"], transcriptionMode: "batch" },
      checksLiveLanguages: false,
    },
    {
      provider: "openai",
      model: "mistralai/Voxtral-Mini-4B-Realtime-2602",
      languages: ["fr"],
      expected: { languages: ["fr"], transcriptionMode: "live" },
      checksLiveLanguages: true,
    },
  ])(
    "resolves $provider/$model to $expected.transcriptionMode",
    async ({ provider, model, languages, expected, checksLiveLanguages }) => {
      await expect(
        getLiveTranscriptionConfig({ provider, model, languages }),
      ).resolves.toEqual(expected);
      if (!checksLiveLanguages) {
        expect(isSupportedLanguagesLiveMock).not.toHaveBeenCalled();
      }
    },
  );

  test("keeps all languages when the selected provider supports them live", async () => {
    const config = await getLiveTranscriptionConfig({
      provider: "nvidia",
      model: "nemotron-asr-streaming",
      languages: ["en", "es"],
    });

    expect(config).toEqual({
      languages: ["en", "es"],
      transcriptionMode: "live",
    });
    expect(isSupportedLanguagesLiveMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to the main language when additional languages are unsupported live", async () => {
    isSupportedLanguagesLiveMock.mockImplementation(
      (_provider, _model, languages) =>
        Promise.resolve({
          status: "ok",
          data: languages.length === 1 && languages[0] === "en",
        }),
    );

    await expect(
      getLiveTranscriptionConfig({
        provider: "nvidia",
        model: "nemotron-asr-streaming",
        languages: ["en", "ko"],
      }),
    ).resolves.toEqual({
      languages: ["en"],
      omittedLanguages: ["ko"],
      transcriptionMode: "live",
    });
  });

  test.each([
    {
      name: "the on-prem OpenAI protocol checks batch languages under its own id",
      mockLive: false,
      invoke: () =>
        isSupportedLanguagesBatch("openai", "whisper-large-v3", ["fr"]),
      source: "batch" as const,
      expected: ["openai", "whisper-large-v3", ["fr"]],
    },
    {
      name: "the NVIDIA protocol checks live languages under its own id",
      mockLive: false,
      invoke: () =>
        isSupportedLanguagesLive("nvidia", "nemotron-asr-streaming", ["fr"]),
      source: "live" as const,
      expected: ["nvidia", "nemotron-asr-streaming", ["fr"]],
    },
  ])("$name", async ({ mockLive, invoke, source, expected }) => {
    if (mockLive) {
      isSupportedLanguagesLiveMock.mockImplementation(
        (_provider, _model, languages) =>
          Promise.resolve({
            status: "ok" as const,
            data: languages.length === 1 && languages[0] === "en",
          }),
      );
    }

    await invoke();

    const mock =
      source === "live"
        ? isSupportedLanguagesLiveMock
        : isSupportedLanguagesBatchMock;
    expected.forEach((value, index) => {
      expect(mock.mock.calls[0]?.[index]).toEqual(value);
    });
  });
});

describe("getTranscriptionLanguages", () => {
  test("prefers the main language before additional spoken languages", () => {
    expect(getTranscriptionLanguages("en", ["ko"])).toEqual(["en", "ko"]);
  });

  test("deduplicates regional variants by base language", () => {
    expect(getTranscriptionLanguages("en-US", ["en", "ko"])).toEqual([
      "en-US",
      "ko",
    ]);
  });
});
