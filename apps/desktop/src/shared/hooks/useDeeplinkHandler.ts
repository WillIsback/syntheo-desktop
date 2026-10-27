import { isTauri } from "@tauri-apps/api/core";

import {
  type DeepLink,
  commands as deeplink2Commands,
  events as deeplink2Events,
} from "@syntheo/plugin-deeplink2";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";

import { subscribeThenDrainDeepLinks } from "~/shared/deeplink";

export function useDeeplinkHandler() {
  useMountEffect(() => {
    if (!isTauri()) {
      return;
    }

    const handleDeepLink = (_payload: DeepLink) => {
      // Aucun lien profond entrant n'est traité : Syntheo n'a pas de compte (les
      // jetons d'un ancien `/auth/callback` sont ignorés), les retours
      // d'intégrations web (`/integration/callback`) ont disparu avec le cloud,
      // et la démo d'onboarding n'existe plus.
    };
    const deepLinkSubscription = subscribeThenDrainDeepLinks({
      listen: (handler) =>
        deeplink2Events.deepLinkEvent.listen(({ payload }) => {
          handler(payload);
        }),
      takePendingDeepLinks: deeplink2Commands.takePendingDeepLinks,
      handle: handleDeepLink,
    });

    return () => {
      void deepLinkSubscription.then((fn) => fn()).catch(() => {});
    };
  });
}
