import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";

import { recordZoneDuration } from "./render-perf";

const handleRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  recordZoneDuration(id, actualDuration);
};

/**
 * Délimite une grande zone de l'interface pour le résumé `[render-perf]` :
 * chaque rendu d'un composant est attribué à la zone englobante la plus
 * proche. Toujours présent (le retirer en production changerait l'arbre et
 * remonterait les enfants) ; un `<Profiler>` de production ne mesure rien et
 * ne coûte qu'une fibre.
 */
export function PerfZone({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  );
}
