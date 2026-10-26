import { describe, expect, test } from "vitest";

import { getLlmProviderStatus } from "./select";
import { LLM_VLLM_PRESET_URL, PROVIDERS } from "./shared";

const custom = PROVIDERS.find((p) => p.id === "custom")!;

describe("getLlmProviderStatus", () => {
  test("configures the vLLM preset without a key", () => {
    const status = getLlmProviderStatus({
      provider: custom,
      config: { api_key: "" },
      isAuthenticated: false,
      isPaid: false,
    });

    expect(custom.baseUrl).toBe(LLM_VLLM_PRESET_URL);
    expect(status.configured).toBe(true);
    expect(status.listModels).toBeTypeOf("function");
  });

  test("configures a saved on-prem endpoint", () => {
    const status = getLlmProviderStatus({
      provider: custom,
      config: { base_url: "http://192.168.1.87:30000/v1", api_key: "sk-test" },
      isAuthenticated: false,
      isPaid: false,
    });

    expect(status.configured).toBe(true);
    expect(status.listModels).toBeTypeOf("function");
  });
});
