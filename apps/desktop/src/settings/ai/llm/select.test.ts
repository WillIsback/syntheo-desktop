import { describe, expect, test } from "vitest";

import { getLlmProviderStatus } from "./select";
import { PROVIDERS } from "./shared";

const custom = PROVIDERS.find((p) => p.id === "custom")!;

describe("getLlmProviderStatus", () => {
  test("stays unconfigured until a base URL is entered", () => {
    const status = getLlmProviderStatus({
      provider: custom,
      config: { api_key: "" },
      isAuthenticated: false,
      isPaid: false,
    });

    expect(custom.baseUrl).toBeUndefined();
    expect(status.configured).toBe(false);
  });

  test("configures an endpoint without a key", () => {
    const status = getLlmProviderStatus({
      provider: custom,
      config: { base_url: "https://inference.example.com/v1", api_key: "" },
      isAuthenticated: false,
      isPaid: false,
    });

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
