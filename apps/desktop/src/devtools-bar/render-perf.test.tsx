// Doit précéder react-dom : React ne signale ses commits qu'à un crochet
// devtools installé avant lui.
import "./render-hook";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { describeElement } from "./animation-describe";
import { PerfZone } from "./perf-zone";
import { type Fiber, type FiberRoot, onReactCommit } from "./render-hook";
import {
  createRenderPerfCollector,
  RENDER_PERF_PREFIX,
  resolveRenderPerfPhase,
  startRenderPerfMonitor,
} from "./render-perf";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Leaf() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

function Static() {
  return <span>static</span>;
}

/** Arbre monté d'une seule fibre composant, comme React le signale. */
function mountedRoot(type: unknown, selfBaseDuration?: number): FiberRoot {
  const leaf = {
    tag: 0,
    type,
    flags: 1,
    memoizedProps: {},
    memoizedState: null,
    stateNode: null,
    alternate: null,
    child: null,
    sibling: null,
    ...(selfBaseDuration === undefined ? {} : { selfBaseDuration }),
  } satisfies Fiber & { selfBaseDuration?: number };
  return {
    current: { ...leaf, tag: 3, type: null, flags: 0, child: leaf },
  };
}

describe("createRenderPerfCollector", () => {
  it("compte les rendus par composant et par zone, puis se remet à zéro", () => {
    const collector = createRenderPerfCollector();
    const stop = onReactCommit(collector.recordCommit);
    render(
      <PerfZone id="capsule">
        <Leaf />
        <PerfZone id="meter">
          <Static />
        </PerfZone>
      </PerfZone>,
    );
    collector.drain({ seq: 0, phase: "listening", elapsedMs: 0 });

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    stop();

    const lines = collector.drain({
      seq: 1,
      phase: "listening",
      elapsedMs: 10_000,
    });
    expect(lines[0]).toBe(
      `${RENDER_PERF_PREFIX} window seq=1 phase=listening ms=10000 commits=2 renders=2 raf_fps=na long_frames=na mutations=0 animations=na encodes=0`,
    );
    // Le React de test (développement) chronomètre : `self_ms` et le `ms`
    // du composant sont des nombres ; `ms` de zone reste `na`, aucun
    // moniteur ne relayant `onRender` ici.
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^\[render-perf\] zone seq=1 name=capsule renders=2 ms=na self_ms=\d+\.\d$/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^\[render-perf\] component seq=1 name=Leaf zone=capsule renders=2 ms=\d+\.\d$/,
      ),
    );
    expect(lines.join("\n")).not.toContain("Static");
    expect(lines.every((entry) => entry.length <= 200)).toBe(true);

    expect(
      collector.drain({ seq: 2, phase: "listening", elapsedMs: 10_000 }),
    ).toEqual([
      `${RENDER_PERF_PREFIX} window seq=2 phase=listening ms=10000 commits=0 renders=0 raf_fps=na long_frames=na mutations=0 animations=na encodes=0`,
    ]);
  });

  it("affiche ms=na sans React qui chronomètre, et des ms réels en profilage", () => {
    function Production() {
      return null;
    }
    function Profiled() {
      return null;
    }
    const collector = createRenderPerfCollector();
    collector.recordCommit(mountedRoot(Production));
    let lines = collector.drain({ seq: 1, phase: "listening", elapsedMs: 1 });
    expect(lines).toContain(
      `${RENDER_PERF_PREFIX} zone seq=1 name=none renders=1 ms=na self_ms=na`,
    );
    expect(lines).toContain(
      `${RENDER_PERF_PREFIX} component seq=1 name=Production zone=none renders=1 ms=na`,
    );

    collector.recordCommit(mountedRoot(Profiled, 2.25));
    collector.recordCommit(mountedRoot(Profiled, 1.5));
    collector.recordZoneDuration("none", 4.5);
    lines = collector.drain({ seq: 2, phase: "listening", elapsedMs: 1 });
    expect(lines).toContain(
      `${RENDER_PERF_PREFIX} zone seq=2 name=none renders=2 ms=4.5 self_ms=3.8`,
    );
    expect(lines).toContain(
      `${RENDER_PERF_PREFIX} component seq=2 name=Profiled zone=none renders=2 ms=3.8`,
    );
  });

  it("classe les encodages d'image par site, en lignes courtes", () => {
    const collector = createRenderPerfCollector();
    const sample = {
      kind: "toDataURL",
      type: "image/png",
      size: "64x64",
      site: "renderAvatarPng@perf-zone-C7CSQoL6.js:1:12345",
      durationMs: 0.75,
    };
    collector.recordEncode(sample);
    collector.recordEncode(sample);
    collector.recordEncode({
      ...sample,
      kind: "createImageBitmap",
      type: "x".repeat(80),
      site: "y".repeat(200),
    });

    const lines = collector.drain({ seq: 3, phase: "listening", elapsedMs: 1 });
    expect(lines[0]).toContain(" encodes=3");
    expect(lines[1]).toBe(
      `${RENDER_PERF_PREFIX} encode seq=3 kind=toDataURL type=image/png size=64x64 count=2 ms=1.5 site=renderAvatarPng@perf-zone-C7CSQoL6.js:1:12345`,
    );
    expect(lines[2]).toContain(` type=${"x".repeat(24)} `);
    expect(lines[2]).toContain(` site=${"y".repeat(64)}`);
    expect(lines.every((entry) => entry.length <= 200)).toBe(true);
  });

  it("résume images, mutations et animations en cours", () => {
    const collector = createRenderPerfCollector();
    collector.recordFrames(118, 3, 2_000);
    collector.recordMutations(40);
    const transition = {
      kind: "CSSTransition",
      name: "transform",
      target: "span[data-level-meter]>i",
    };
    collector.recordAnimations([transition, transition]);
    collector.recordAnimations([transition]);

    const lines = collector.drain({
      seq: 4,
      phase: "after_stop",
      elapsedMs: 10_000,
    });
    expect(lines[0]).toContain("raf_fps=59.0 long_frames=3 mutations=40");
    expect(lines[0]).toContain("animations=1.5");
    expect(lines).toContain(
      `${RENDER_PERF_PREFIX} animation seq=4 kind=CSSTransition name=transform target=span[data-level-meter]>i avg=1.5`,
    );
  });

  it("neutralise espaces et signes égal dans les valeurs", () => {
    const collector = createRenderPerfCollector();
    collector.recordAnimations([
      { kind: "CSSAnimation", name: "a b=c", target: "x".repeat(80) },
    ]);
    const animation = collector
      .drain({ seq: 1, phase: "listening", elapsedMs: 1 })
      .find((entry) => entry.includes(" animation "))!;
    expect(animation).toContain("name=a_b_c ");
    expect(animation).toContain(`target=${"x".repeat(48)} `);
  });
});

describe("describeElement", () => {
  it("nomme l'élément par le plus proche attribut data-*, sans sa valeur", () => {
    const host = document.createElement("span");
    host.setAttribute("data-level-meter", "secret");
    const bar = document.createElement("i");
    host.append(bar);
    expect(describeElement(bar)).toBe("span[data-level-meter]>i");
    expect(describeElement(host)).toBe("span[data-level-meter]");
  });
});

describe("resolveRenderPerfPhase", () => {
  it("suit l'écoute puis les deux minutes qui suivent l'arrêt", () => {
    expect(resolveRenderPerfPhase("active", null, 0)).toBe("listening");
    expect(resolveRenderPerfPhase("finalizing", 0, 0)).toBe("finalizing");
    expect(resolveRenderPerfPhase("inactive", 1_000, 60_000)).toBe(
      "after_stop",
    );
    expect(resolveRenderPerfPhase("inactive", 1_000, 200_000)).toBe("idle");
    expect(resolveRenderPerfPhase("inactive", null, 0)).toBe("idle");
  });
});

describe("startRenderPerfMonitor", () => {
  it("n'écrit rien hors écoute et résume chaque fenêtre pendant l'écoute", () => {
    vi.useFakeTimers();
    let status = "inactive";
    const log = vi.fn();
    const stop = startRenderPerfMonitor({
      getListenerStatus: () => status,
      log,
      windowMs: 3_000,
    });

    vi.advanceTimersByTime(10_000);
    expect(log).not.toHaveBeenCalled();

    status = "active";
    vi.advanceTimersByTime(4_000);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[render-perf\] window seq=1 phase=listening /),
    );

    stop();
    log.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(log).not.toHaveBeenCalled();
  });

  it("ne sonde les encodages d'image que pendant l'écoute", () => {
    vi.useFakeTimers();
    // Lu sans liaison de `this` : seule l'identité de la fonction compte.
    const toDataURL = (): unknown =>
      Reflect.get(HTMLCanvasElement.prototype, "toDataURL");
    const original = toDataURL();
    let status = "inactive";
    const stop = startRenderPerfMonitor({
      getListenerStatus: () => status,
      log: () => {},
      windowMs: 3_000,
    });

    vi.advanceTimersByTime(2_000);
    expect(toDataURL()).toBe(original);

    status = "active";
    vi.advanceTimersByTime(1_000);
    expect(toDataURL()).not.toBe(original);

    stop();
    expect(toDataURL()).toBe(original);
  });
});
