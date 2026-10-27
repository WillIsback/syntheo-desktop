import { describe, expect, it, vi } from "vitest";

import { createToastRegistry, getToastToShow } from "./registry";

type RegistryParams = Parameters<typeof createToastRegistry>[0];

const baseParams: RegistryParams = {
  hasLLMConfigured: true,
  hasSttConfigured: true,
  isAiTranscriptionTabActive: false,
  isAiIntelligenceTabActive: false,
  onOpenLLMSettings: vi.fn(),
  onOpenSTTSettings: vi.fn(),
};

type Toast = NonNullable<ReturnType<typeof getToastToShow>>;

function showToast(
  overrides: Partial<RegistryParams> = {},
  isDismissed: (toast: Toast) => boolean = () => false,
) {
  return getToastToShow(
    createToastRegistry({ ...baseParams, ...overrides }),
    isDismissed,
  );
}

describe("sidebar toast registry", () => {
  it.each([
    ["missing-llm", { hasLLMConfigured: false }],
    ["missing-stt", { hasSttConfigured: false }],
  ] as const)(
    "requires %s setup even if it was dismissed previously",
    (id, overrides) => {
      const toast = showToast(overrides, (toast) => toast.id === id);

      expect(toast?.id).toBe(id);
      expect(toast?.lifecycle).toEqual({ type: "condition-bound" });
    },
  );

  it("never shows sign-in or upgrade prompts (no account)", () => {
    // Fully configured on-prem providers: nothing to promote.
    expect(showToast()).toBeNull();
    const ids = createToastRegistry(baseParams).map((entry) => entry.toast.id);
    expect(ids).not.toContain("sign-in-benefits");
    expect(ids).not.toContain("upgrade-to-pro");
  });

  it("never shows desktop update prompts (no updater)", () => {
    const ids = createToastRegistry(baseParams).map((entry) => entry.toast.id);
    expect(ids.some((id) => id.startsWith("desktop-update:"))).toBe(false);
  });
});
