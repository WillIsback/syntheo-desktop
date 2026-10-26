import { describe, expect, it } from "vitest";

import {
  normalizeReasoningEffort,
  reasoningProviderOptions,
} from "./reasoning-effort";

describe("normalizeReasoningEffort", () => {
  it("normalizes unknown or missing levels to default", () => {
    expect(normalizeReasoningEffort("high")).toBe("high");
    expect(normalizeReasoningEffort(undefined)).toBe("default");
    expect(normalizeReasoningEffort("")).toBe("default");
    expect(normalizeReasoningEffort("xhigh")).toBe("default");
  });
});

describe("reasoningProviderOptions", () => {
  it.each([
    ["custom", "qwen", "default", null],
    ["custom", "qwen", "low", { custom: { reasoningEffort: "low" } }],
    ["custom", "gpt-oss-120b", "high", { custom: { reasoningEffort: "high" } }],
  ] as const)(
    "maps %s/%s with %s reasoning effort",
    (providerId, modelId, effort, expected) => {
      expect(reasoningProviderOptions(providerId, modelId, effort)).toEqual(
        expected,
      );
    },
  );
});
