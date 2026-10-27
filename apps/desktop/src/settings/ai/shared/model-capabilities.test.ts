import { describe, expect, it } from "vitest";

import { modelSupportsImageInput } from "./model-capabilities";

describe("modelSupportsImageInput", () => {
  it("allows known multimodal served models", () => {
    expect(modelSupportsImageInput("custom", "Qwen2.5-VL-7B-Instruct")).toBe(
      true,
    );
    expect(modelSupportsImageInput("custom", "gemma-3-27b-it")).toBe(true);
  });

  it("blocks known text-only or non-chat models", () => {
    expect(modelSupportsImageInput("openai", "gpt-3.5-turbo")).toBe(false);
    expect(
      modelSupportsImageInput("syntheo", "~deepseek/deepseek-pro-latest"),
    ).toBe(false);
    expect(modelSupportsImageInput("openai", "gpt-4")).toBe(false);
    expect(modelSupportsImageInput("anthropic", "claude-2.1")).toBe(false);
    expect(modelSupportsImageInput("anthropic", "custom-text-model")).toBe(
      false,
    );
    expect(modelSupportsImageInput("openai", "text-embedding-3-large")).toBe(
      false,
    );
  });

  it("requires a vision-like model name for unknown local providers", () => {
    expect(modelSupportsImageInput("ollama", "llava:latest")).toBe(true);
    expect(modelSupportsImageInput("custom", "llama-3.1-8b")).toBe(false);
  });
});
