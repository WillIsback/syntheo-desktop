/**
 * Build de profilage React (issue 289).
 *
 * Avec `SYNTHEO_REACT_PROFILING=1` au moment du build Vite, `react-dom/client`
 * est remplacé par `react-dom/profiling` : même API (`createRoot`…), mais le
 * React de production y chronomètre ses rendus. `<Profiler onRender>` reçoit
 * alors un vrai `actualDuration`, et chaque fibre rendue une
 * `selfBaseDuration`, que `[render-perf]` affiche en `ms` par zone et par
 * composant.
 *
 * `scheduler/tracing` n'existe plus depuis React 18 : rien d'autre à
 * remplacer. Sans la variable, aucun alias : le build normal et la release
 * sont inchangés.
 */

export const REACT_PROFILING_ENV = "SYNTHEO_REACT_PROFILING";

export type ReactProfilingAlias = { find: RegExp; replacement: string };

export function isReactProfilingBuild(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env[REACT_PROFILING_ENV] === "1";
}

export function reactProfilingAliases(
  env: Readonly<Record<string, string | undefined>>,
): ReactProfilingAlias[] {
  if (!isReactProfilingBuild(env)) return [];
  return [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }];
}
