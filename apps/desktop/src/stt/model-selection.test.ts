import { describe, expect, it } from "vitest";

import { normalizeStoredSttSelection } from "./model-selection";

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
});
