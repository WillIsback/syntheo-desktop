import { startTransition, useEffect, useState } from "react";

import { useListenerStore } from "./contexts";
import { createLiveDisplayCadence } from "./live-display-cadence";
import type { Segment } from "./live-segment";

type ListenerSnapshot = ReturnType<
  ReturnType<typeof useListenerStore>["getState"]
>;

// Les changements d'état de l'écoute (début, fin, autre session) et
// l'apparition ou la disparition de la transcription s'affichent tout de
// suite, en même temps que le reste de l'écran : sinon la marge montrerait un
// instant des segments vivants à côté de la transcription finale.
function needsImmediateDisplay(
  state: ListenerSnapshot,
  previous: ListenerSnapshot,
) {
  return (
    state.live.status !== previous.live.status ||
    state.live.sessionId !== previous.live.sessionId ||
    (state.liveSegments.length === 0) !== (previous.liveSegments.length === 0)
  );
}

/**
 * Segments vivants pour l'affichage de la marge, au rythme de
 * `live-display-cadence.ts` (4 Hz, 2 Hz pendant la frappe, rien fenêtre
 * masquée) et en basse priorité : une frappe passe devant le rendu.
 *
 * Le magasin, lui, applique chaque delta dès son arrivée ; ce hook relit son
 * dernier état à chaque battement. Ne l'utiliser que pour l'affichage : un
 * traitement métier doit lire `state.liveSegments` directement.
 */
export function useLiveSegmentsForDisplay(): Segment[] {
  const store = useListenerStore();
  const [initial] = useState(() => store.getState().liveSegments);
  const [segments, setSegments] = useState<Segment[]>(initial);

  useEffect(() => {
    const cadence = createLiveDisplayCadence(() => {
      const next = store.getState().liveSegments;
      startTransition(() => setSegments(next));
    });
    const unsubscribe = store.subscribe((state, previous) => {
      if (needsImmediateDisplay(state, previous)) {
        cadence.cancel();
        setSegments(state.liveSegments);
      } else if (state.liveSegments !== previous.liveSegments) {
        cadence.request();
      }
    });
    // Ce qui a pu arriver entre le rendu et l'abonnement.
    if (store.getState().liveSegments !== initial) {
      setSegments(store.getState().liveSegments);
    }
    return () => {
      unsubscribe();
      cadence.dispose();
    };
  }, [initial, store]);

  return segments;
}
