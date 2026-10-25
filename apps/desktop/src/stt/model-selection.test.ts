import { describe, expect, it } from "vitest";

import { normalizeStoredSttSelection } from "./model-selection";

describe("normalizeStoredSttSelection", () => {
  it.each(["deepgram", "custom", "soniox", "assemblyai"])(
    "clears_removed_cloud_stt_provider %s",
    (provider) => {
      expect(normalizeStoredSttSelection(provider, "nova-3")).toEqual({
        provider: undefined,
        model: undefined,
      });
    },
  );

  it("keeps_on_prem_selection", () => {
    expect(normalizeStoredSttSelection("openai", "whisper-large-v3")).toEqual({
      provider: "openai",
      model: "whisper-large-v3",
    });
  });
});
