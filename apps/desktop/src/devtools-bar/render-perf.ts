import { type AnimationSample, describeAnimation } from "./animation-describe";
import {
  type EncodeSample,
  installImageEncodeProbe,
} from "./image-encode-probe";
import { type Fiber, type FiberRoot, onReactCommit } from "./render-hook";
import { getDisplayName, traverseRenderedFibers } from "./render-tracker";

/**
 * Résumé périodique du coût de rendu pendant l'écoute, écrit dans le journal
 * de l'app (builds devtools seulement, démarré depuis `main.tsx`).
 *
 * Toutes les 10 s, tant qu'une écoute est en cours (et 2 min après l'arrêt),
 * des lignes `[render-perf] <type> clé=valeur …` passent par `console.info`,
 * que le plugin tracing recopie telles quelles (préfixe autorisé, 200
 * caractères au plus par ligne). Elles ne contiennent que des noms de code
 * (composants, zones, propriétés CSS) et des nombres, jamais de contenu.
 *
 * Hors écoute, rien n'est observé : pas d'abonnement aux commits React, pas
 * d'observateur DOM, pas de boucle rAF, pas de sonde d'encodage d'image.
 *
 * Les durées (`ms`, `self_ms`) ne sont réelles qu'avec un React qui
 * chronomètre : build de développement, ou build de profilage
 * (`SYNTHEO_REACT_PROFILING=1`, voir `plugins/react-profiling.ts`). Sinon
 * elles valent `na`.
 */

export const RENDER_PERF_PREFIX = "[render-perf]";
export const RENDER_PERF_WINDOW_MS = 10_000;
/** `localStorage[RENDER_PERF_ALWAYS_KEY] = "always"` résume aussi hors écoute. */
export const RENDER_PERF_ALWAYS_KEY = "syntheo:render-perf";

const TICK_MS = 1_000;
const AFTER_STOP_MS = 120_000;
// Échantillon rAF court : une boucle rAF permanente ferait elle-même tourner
// le moteur de rendu à 60 Hz et fausserait la mesure.
const FRAME_SAMPLE_MS = 2_000;
const LONG_FRAME_MS = 34;
const TOP_COMPONENTS = 12;
const TOP_ANIMATIONS = 6;
const TOP_ENCODES = 6;
const MAX_FIELD_LENGTH = 48;
const MAX_SITE_LENGTH = 64;
const MAX_TYPE_LENGTH = 24;
const NO_ZONE = "none";

export type RenderPerfPhase =
  | "idle"
  | "listening"
  | "finalizing"
  | "after_stop";

type ZoneStats = {
  renders: number;
  /** Somme des `actualDuration` du `<Profiler>` : zones imbriquées incluses. */
  durationMs: number;
  timed: boolean;
  /** Somme des durées propres des composants attribués à la zone. */
  selfMs: number;
  selfTimed: boolean;
};

type ComponentStats = { renders: number; selfMs: number; timed: boolean };

type EncodeStats = { count: number; durationMs: number };

/**
 * Durée propre du dernier rendu d'une fibre (hors enfants), que seuls les
 * React qui chronomètrent renseignent.
 */
function selfDurationOf(fiber: Fiber): number | null {
  const value = (fiber as Fiber & { selfBaseDuration?: unknown })
    .selfBaseDuration;
  return typeof value === "number" && value >= 0 ? value : null;
}

export type RenderPerfCollector = {
  recordCommit(root: FiberRoot): void;
  recordZoneDuration(zone: string, durationMs: number): void;
  recordFrames(frames: number, longFrames: number, sampleMs: number): void;
  recordMutations(count: number): void;
  recordAnimations(samples: readonly AnimationSample[]): void;
  recordEncode(sample: EncodeSample): void;
  /** Rendus comptés depuis le dernier `drain`, toutes zones confondues. */
  rendersOf(component: string): number;
  drain(context: {
    seq: number;
    phase: RenderPerfPhase;
    elapsedMs: number;
  }): string[];
};

export function createRenderPerfCollector(): RenderPerfCollector {
  let commits = 0;
  let renders = 0;
  let components = new Map<string, ComponentStats>();
  let zones = new Map<string, ZoneStats>();
  let frames = 0;
  let longFrames = 0;
  let frameSampleMs = 0;
  let mutations = 0;
  let animationSamples = 0;
  let runningAnimations = 0;
  let animations = new Map<string, number>();
  let encodes = 0;
  let encodeSites = new Map<string, EncodeStats>();

  const zoneStats = (zone: string) => {
    let stats = zones.get(zone);
    if (!stats) {
      stats = {
        renders: 0,
        durationMs: 0,
        timed: false,
        selfMs: 0,
        selfTimed: false,
      };
      zones.set(zone, stats);
    }
    return stats;
  };

  return {
    recordCommit(root) {
      commits += 1;
      traverseRenderedFibers(root, (fiber, zone) => {
        const name = sanitize(getDisplayName(fiber.type));
        const zoneName = sanitize(zone ?? NO_ZONE);
        const key = `${name}\u0000${zoneName}`;
        const selfMs = selfDurationOf(fiber);
        renders += 1;
        let component = components.get(key);
        if (!component) {
          component = { renders: 0, selfMs: 0, timed: false };
          components.set(key, component);
        }
        component.renders += 1;
        const stats = zoneStats(zoneName);
        stats.renders += 1;
        if (selfMs !== null) {
          component.selfMs += selfMs;
          component.timed = true;
          stats.selfMs += selfMs;
          stats.selfTimed = true;
        }
      });
    },
    recordZoneDuration(zone, durationMs) {
      const stats = zoneStats(sanitize(zone));
      stats.durationMs += durationMs;
      stats.timed = true;
    },
    recordFrames(count, long, sampleMs) {
      frames += count;
      longFrames += long;
      frameSampleMs += sampleMs;
    },
    recordMutations(count) {
      mutations += count;
    },
    recordAnimations(samples) {
      animationSamples += 1;
      runningAnimations += samples.length;
      for (const sample of samples) {
        const key = [sample.kind, sample.name, sample.target]
          .map((value) => sanitize(value))
          .join("\u0000");
        animations.set(key, (animations.get(key) ?? 0) + 1);
      }
    },
    recordEncode(sample) {
      encodes += 1;
      const key = [
        sanitize(sample.kind),
        sanitize(sample.type, MAX_TYPE_LENGTH),
        sanitize(sample.size),
        sanitize(sample.site, MAX_SITE_LENGTH),
      ].join("\u0000");
      const stats = encodeSites.get(key) ?? { count: 0, durationMs: 0 };
      stats.count += 1;
      stats.durationMs += sample.durationMs;
      encodeSites.set(key, stats);
    },
    rendersOf(component) {
      let total = 0;
      for (const [key, stats] of components) {
        if (key.slice(0, key.indexOf("\u0000")) === component) {
          total += stats.renders;
        }
      }
      return total;
    },
    drain({ seq, phase, elapsedMs }) {
      const fps =
        frameSampleMs > 0 ? ((frames * 1000) / frameSampleMs).toFixed(1) : "na";
      const animationAverage =
        animationSamples > 0
          ? (runningAnimations / animationSamples).toFixed(1)
          : "na";
      const lines = [
        line("window", {
          seq,
          phase,
          ms: Math.round(elapsedMs),
          commits,
          renders,
          raf_fps: fps,
          long_frames: frameSampleMs > 0 ? longFrames : "na",
          mutations,
          animations: animationAverage,
          encodes,
        }),
      ];

      for (const [name, stats] of sortByCount(zones, (s) => s.renders)) {
        lines.push(
          line("zone", {
            seq,
            name,
            renders: stats.renders,
            ms: stats.timed ? stats.durationMs.toFixed(1) : "na",
            self_ms: stats.selfTimed ? stats.selfMs.toFixed(1) : "na",
          }),
        );
      }
      // Avec des durées, les plus coûteux d'abord ; sinon les plus rendus.
      const timed = [...components.values()].some((c) => c.timed);
      for (const [key, stats] of sortByCount(components, (c) =>
        timed ? c.selfMs : c.renders,
      ).slice(0, TOP_COMPONENTS)) {
        const [name, zone] = key.split("\u0000");
        lines.push(
          line("component", {
            seq,
            name,
            zone,
            renders: stats.renders,
            ms: stats.timed ? stats.selfMs.toFixed(1) : "na",
          }),
        );
      }
      for (const [key, count] of sortByCount(animations, (c) => c).slice(
        0,
        TOP_ANIMATIONS,
      )) {
        const [kind, name, target] = key.split("\u0000");
        lines.push(
          line("animation", {
            seq,
            kind,
            name,
            target,
            avg: (count / Math.max(animationSamples, 1)).toFixed(1),
          }),
        );
      }
      for (const [key, stats] of sortByCount(encodeSites, (e) => e.count).slice(
        0,
        TOP_ENCODES,
      )) {
        const [kind, type, size, site] = key.split("\u0000");
        lines.push(
          line("encode", {
            seq,
            kind,
            type,
            size,
            count: stats.count,
            ms: stats.durationMs.toFixed(1),
            site,
          }),
        );
      }

      commits = 0;
      renders = 0;
      components = new Map();
      zones = new Map();
      frames = 0;
      longFrames = 0;
      frameSampleMs = 0;
      mutations = 0;
      animationSamples = 0;
      runningAnimations = 0;
      animations = new Map();
      encodes = 0;
      encodeSites = new Map();
      return lines;
    },
  };
}

function sortByCount<V>(map: Map<string, V>, count: (value: V) => number) {
  return [...map].sort(
    ([leftKey, left], [rightKey, right]) =>
      count(right) - count(left) || leftKey.localeCompare(rightKey),
  );
}

function line(kind: string, fields: Record<string, string | number>) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `${RENDER_PERF_PREFIX} ${kind} ${body}`;
}

/** Garde une valeur lisible par un script : pas d'espace ni de `=`. */
function sanitize(value: string, maxLength = MAX_FIELD_LENGTH): string {
  const cleaned = value.replace(/[^\w.:/\-[\]>#()@$+]/g, "_");
  return cleaned.slice(0, maxLength) || "_";
}

// Les durées par zone ne sont fournies que par un React qui chronomètre
// (développement ou build de profilage) : `<Profiler onRender>` est inerte
// dans le React de production ordinaire.
let activeCollector: RenderPerfCollector | null = null;

export function recordZoneDuration(zone: string, durationMs: number): void {
  activeCollector?.recordZoneDuration(zone, durationMs);
}

export function resolveRenderPerfPhase(
  status: string,
  lastActiveAt: number | null,
  now: number,
): RenderPerfPhase {
  if (status === "active") return "listening";
  if (status === "finalizing") return "finalizing";
  if (lastActiveAt !== null && now - lastActiveAt < AFTER_STOP_MS) {
    return "after_stop";
  }
  return "idle";
}

export type RenderPerfMonitorOptions = {
  /** `live.status` du listener : `inactive`, `active` ou `finalizing`. */
  getListenerStatus: () => string;
  log?: (line: string) => void;
  windowMs?: number;
};

export function startRenderPerfMonitor({
  getListenerStatus,
  log = (entry) => console.info(entry),
  windowMs = RENDER_PERF_WINDOW_MS,
}: RenderPerfMonitorOptions): () => void {
  const collector = createRenderPerfCollector();
  const ticksPerWindow = Math.max(1, Math.round(windowMs / TICK_MS));
  let seq = 0;
  let ticks = 0;
  let windowStartedAt = performance.now();
  let lastActiveAt: number | null = null;
  let stopCommits: (() => void) | null = null;
  let mutationObserver: MutationObserver | null = null;
  let stopEncodeProbe: (() => void) | null = null;
  let frameHandle: number | null = null;

  const alwaysOn = () => {
    try {
      return localStorage.getItem(RENDER_PERF_ALWAYS_KEY) === "always";
    } catch {
      return false;
    }
  };

  const observe = (enabled: boolean) => {
    if (enabled && !stopCommits) {
      activeCollector = collector;
      stopCommits = onReactCommit(collector.recordCommit);
      stopEncodeProbe = installImageEncodeProbe((sample) =>
        collector.recordEncode(sample),
      );
      if (typeof MutationObserver !== "undefined") {
        mutationObserver = new MutationObserver((records) =>
          collector.recordMutations(records.length),
        );
        mutationObserver.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      }
    } else if (!enabled && stopCommits) {
      stopCommits();
      stopCommits = null;
      stopEncodeProbe?.();
      stopEncodeProbe = null;
      mutationObserver?.disconnect();
      mutationObserver = null;
      activeCollector = null;
      cancelFrameSample();
    }
  };

  const cancelFrameSample = () => {
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
  };

  const sampleFrames = () => {
    if (typeof requestAnimationFrame !== "function") return;
    cancelFrameSample();
    let first: number | null = null;
    let last = 0;
    let frames = 0;
    let longFrames = 0;
    const onFrame = (timestamp: number) => {
      if (first === null) {
        first = timestamp;
      } else {
        frames += 1;
        if (timestamp - last > LONG_FRAME_MS) longFrames += 1;
      }
      last = timestamp;
      if (timestamp - first < FRAME_SAMPLE_MS) {
        frameHandle = requestAnimationFrame(onFrame);
      } else {
        frameHandle = null;
        collector.recordFrames(frames, longFrames, timestamp - first);
      }
    };
    frameHandle = requestAnimationFrame(onFrame);
  };

  const sampleAnimations = () => {
    if (typeof document.getAnimations !== "function") return;
    collector.recordAnimations(
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .map(describeAnimation),
    );
  };

  const tick = () => {
    const now = performance.now();
    const status = getListenerStatus();
    if (status === "active" || status === "finalizing") lastActiveAt = now;
    const phase = resolveRenderPerfPhase(status, lastActiveAt, now);
    const enabled = phase !== "idle" || alwaysOn();
    const wasEnabled = stopCommits !== null;
    observe(enabled);
    if (!enabled) {
      ticks = 0;
      return;
    }
    if (!wasEnabled) {
      // Nouvelle fenêtre : rien de ce qui précède n'a été observé.
      collector.drain({ seq, phase, elapsedMs: 0 });
      windowStartedAt = now;
      ticks = 0;
      sampleFrames();
    }

    sampleAnimations();
    ticks += 1;
    if (ticks < ticksPerWindow) return;

    seq += 1;
    for (const entry of collector.drain({
      seq,
      phase,
      elapsedMs: now - windowStartedAt,
    })) {
      log(entry);
    }
    windowStartedAt = now;
    ticks = 0;
    sampleFrames();
  };

  const interval = setInterval(tick, TICK_MS);
  return () => {
    clearInterval(interval);
    observe(false);
  };
}
