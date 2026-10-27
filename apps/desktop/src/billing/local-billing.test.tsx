import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ toastWarning: vi.fn() }));

vi.mock("@syntheo/ui/components/ui/toast", () => ({
  toast: { warning: mocks.toastWarning },
}));

import { type BillingAccess, useBillingAccess } from "./billing-context";
import { LocalBillingProvider } from "./local-billing";

import { PlanGate } from "~/settings/plan-gate";

function renderWithProvider(): BillingAccess {
  let seen: BillingAccess | undefined;
  function Probe() {
    seen = useBillingAccess();
    return null;
  }
  render(
    <LocalBillingProvider>
      <Probe />
    </LocalBillingProvider>,
  );
  return seen!;
}

describe("LocalBillingProvider", () => {
  afterEach(cleanup);

  it("provides an unlocked pro plan without any session", () => {
    const seen = renderWithProvider();
    expect(seen).toMatchObject({
      isPro: true,
      isPaid: true,
      plan: "pro",
      isReady: true,
      isTrialing: false,
    });
    expect(seen.canStartTrial).toEqual({ data: false, isPending: false });
  });

  it("pro_settings_are_usable_without_session", () => {
    const onClick = vi.fn();
    function Gated() {
      const { isPro } = useBillingAccess();
      return (
        <PlanGate plan="pro" allowed={isPro}>
          <button type="button" onClick={onClick}>
            Activer
          </button>
        </PlanGate>
      );
    }
    render(
      <LocalBillingProvider>
        <Gated />
      </LocalBillingProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Activer" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});
