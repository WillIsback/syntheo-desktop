import { createContext, useContext } from "react";

// Forme héritée de la facturation : Syntheo Desktop expose toujours le même
// plan « pro » local (LocalBillingProvider), sans compte ni abonnement.
export type BillingInfo = {
  entitlements: string[];
  subscriptionStatus: string | null;
  isPro: boolean;
  isLite: boolean;
  isPaid: boolean;
  isTrialing: boolean;
  isPaused: boolean;
  hasPaymentMethod: boolean;
  trialEnd: Date | null;
  trialDaysRemaining: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  plan: "free" | "trial" | "pro";
};

export type BillingAccess = BillingInfo & {
  isReady: boolean;
  canStartTrial: { data: boolean; isPending: boolean };
  upgradeToPro: () => void;
  isUpgradingToPro: boolean;
};

export const BillingContext = createContext<BillingAccess | null>(null);

export function useBillingAccess() {
  const context = useContext(BillingContext);

  if (!context) {
    throw new Error("useBillingAccess must be used within BillingProvider");
  }

  return context;
}
