import { isTauri } from "@tauri-apps/api/core";

import {
  type DeepLink,
  commands as deeplink2Commands,
  events as deeplink2Events,
} from "@syntheo/plugin-deeplink2";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";

import { stopActiveWelcomeDemo } from "~/onboarding/welcome-note";
import { subscribeThenDrainDeepLinks } from "~/shared/deeplink";

export function useDeeplinkHandler() {
  useMountEffect(() => {
    if (!isTauri()) {
      return;
    }

    const handleDeepLink = (payload: DeepLink) => {
      // `/auth/callback` n'est plus traité ici : Syntheo n'a pas de compte, et
      // l'OAuth d'abonnement ChatGPT écoute ce lien dans son propre écran.
      // Les retours d'intégrations web (`/integration/callback`) ont disparu
      // avec les intégrations cloud.
      if (payload.to === "/onboarding-demo/complete") {
        void stopActiveWelcomeDemo().catch((error) => {
          console.error("[onboarding] failed to complete welcome demo", error);
        });
      }
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
