// Doit précéder react-dom : React ne signale ses commits qu'à un crochet
// devtools installé avant lui.
import "./render-hook";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PerfZone } from "./perf-zone";
import { onReactCommit } from "./render-hook";
import {
  createRenderPerfCollector,
  describeElement,
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
      `${RENDER_PERF_PREFIX} window seq=1 phase=listening ms=10000 commits=2 renders=2 raf_fps=na long_frames=na mutations=0 animations=na`,
    );
    expect(lines).toContain(
      `${RENDER_PERF_PREFIX} zone seq=1 name=capsule renders=2 ms=na`,
    );
    expect(lines).toContain(
      `${RENDER_PERF_PREFIX} component seq=1 name=Leaf zone=capsule renders=2`,
    );
    expect(lines.join("\n")).not.toContain("Static");
    expect(lines.every((entry) => entry.length <= 200)).toBe(true);

    expect(
      collector.drain({ seq: 2, phase: "listening", elapsedMs: 10_000 }),
    ).toEqual([
      `${RENDER_PERF_PREFIX} window seq=2 phase=listening ms=10000 commits=0 renders=0 raf_fps=na long_frames=na mutations=0 animations=na`,
    ]);
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
});
