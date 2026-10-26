import { describe, expect, test } from "vitest";

import { getLlmProviderStatus } from "./select";
import { PROVIDERS } from "./shared";

const custom = PROVIDERS.find((p) => p.id === "custom")!;

describe("getLlmProviderStatus", () => {
  test("does not configure the endpoint without a base URL", () => {
    const status = getLlmProviderStatus({
      provider: custom,
      config: { base_url: "", api_key: "sk-test" },
      isAuthenticated: false,
      isPaid: false,
    });

    expect(status.configured).toBe(false);
    expect(status.listModels).toBeUndefined();
  });

  test("configures the endpoint once its credentials are verified", () => {
    const status = getLlmProviderStatus({
      provider: custom,
      config: { base_url: "http://192.168.1.87:30000/v1", api_key: "sk-test" },
      isAvailable: true,
      isAuthenticated: false,
      isPaid: false,
    });

    expect(status.configured).toBe(true);
    expect(status.listModels).toBeTypeOf("function");
  });

  test.each([undefined, false])(
    "does not expose an unverified endpoint (%s)",
    (isAvailable) => {
      const status = getLlmProviderStatus({
        provider: custom,
        config: {
          base_url: "http://192.168.1.87:30000/v1",
          api_key: "nonempty-invalid-key",
        },
        isAuthenticated: false,
        isPaid: false,
        isAvailable,
      });
      expect(status.configured).toBe(false);
      expect(status.listModels).toBeUndefined();
    },
  );
});
