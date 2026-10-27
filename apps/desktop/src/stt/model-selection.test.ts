import { describe, expect, it } from "vitest";

import {
  getDefaultSttModel,
  getSttModelSuggestions,
  normalizeStoredSttSelection,
} from "./model-selection";

describe("normalizeStoredSttSelection", () => {
  it.each(["deepgram", "custom", "soniox", "assemblyai"])(
    "clears_removed_cloud_stt_provider %s",
    (provider) => {
      expect(normalizeStoredSttSelection(provider, "nova-3")).toEqual({
        provider: "",
        model: "",
      });
    },
  );

  it("clears_the_hosted_syntheo_model", () => {
    expect(normalizeStoredSttSelection("syntheo", "cloud")).toEqual({
      provider: "",
      model: "",
    });
  });

  it.each([
    ["soniqo", "soniqo-parakeet-streaming"],
    ["apple_speech", "apple-speech"],
    ["local_file", "local-file"],
    ["syntheo", "soniqo-parakeet-batch"],
    ["syntheo", "am-parakeet-v3"],
  ])("clears_local_stt_selection %s/%s", (provider, model) => {
    expect(normalizeStoredSttSelection(provider, model)).toEqual({
      provider: "",
      model: "",
    });
  });

  it("keeps_on_prem_selection", () => {
    expect(normalizeStoredSttSelection("openai", "whisper-large-v3")).toEqual({
      provider: "openai",
      model: "whisper-large-v3",
    });
  });

  it("defaults_nvidia_to_the_streaming_nemotron_model", () => {
    expect(getDefaultSttModel("nvidia")).toBe("nemotron-asr-streaming");
  });

  it("suggests_known_nim_models_for_nvidia", () => {
    expect(getSttModelSuggestions("nvidia")).toEqual([
      "nemotron-asr-streaming",
      "parakeet-tdt-0.6b-v3",
      "parakeet-tdt-0.6b-v2",
    ]);
  });

  it("has_no_suggestions_for_undiscoverable_or_missing_providers", () => {
    expect(getSttModelSuggestions("openai")).toEqual([]);
    expect(getSttModelSuggestions(undefined)).toEqual([]);
  });
});
