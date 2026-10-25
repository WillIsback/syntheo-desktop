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

  it("clears_the_hosted_anarlog_model", () => {
    expect(normalizeStoredSttSelection("anarlog", "cloud")).toEqual({
      provider: "",
      model: "",
    });
    expect(
      normalizeStoredSttSelection("anarlog", "soniqo-parakeet-streaming"),
    ).toEqual({ provider: "soniqo", model: "soniqo-parakeet-streaming" });
  });

  it("keeps_on_prem_selection", () => {
    expect(normalizeStoredSttSelection("openai", "whisper-large-v3")).toEqual({
      provider: "openai",
      model: "whisper-large-v3",
    });
  });
});
