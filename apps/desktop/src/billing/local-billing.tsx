import type { ReactNode } from "react";

import { type BillingAccess, BillingContext } from "./billing-context";

// Syntheo Desktop n'a ni compte ni abonnement : toutes les fonctionnalités sont
// disponibles, sans aucune requête réseau.
export const UNLOCKED_BILLING: BillingAccess = {
  entitlements: ["hyprnote_pro"],
  subscriptionStatus: null,
  isPro: true,
  isLite: false,
  isPaid: true,
  isTrialing: false,
  isPaused: false,
  hasPaymentMethod: false,
  trialEnd: null,
  trialDaysRemaining: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  plan: "pro",
  isReady: true,
  canStartTrial: { data: false, isPending: false },
  upgradeToPro: () => {},
  isUpgradingToPro: false,
};

export function LocalBillingProvider({ children }: { children: ReactNode }) {
  return (
    <BillingContext.Provider value={UNLOCKED_BILLING}>
      {children}
    </BillingContext.Provider>
  );
}
