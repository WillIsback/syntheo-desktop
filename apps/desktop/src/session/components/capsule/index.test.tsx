import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatElapsed, NoteCapsule, type CapsuleActions } from "./index";

const hoisted = vi.hoisted(() => ({ reduceMotion: false }));

vi.mock("motion/react", () => ({
  useReducedMotion: () => hoisted.reduceMotion,
}));

function makeActions(): CapsuleActions {
  return {
    onCancel: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCopy: vi.fn(),
    onExport: vi.fn(),
    onAsk: vi.fn(),
  };
}

describe("NoteCapsule", () => {
  beforeEach(() => {
    hoisted.reduceMotion = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the three steps with decorative kanji and marks the current one", () => {
    render(<NoteCapsule stage="listen" actions={makeActions()} />);

    const steps = screen.getByRole("list", { name: "Note steps" });
    const items = Array.from(steps.querySelectorAll("li"));
    expect(items.map((item) => item.textContent)).toEqual([
      "備Prepare",
      "·聴Listen",
      "·結Synthesis",
    ]);
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([
      null,
      "step",
      null,
    ]);

    const kanji = Array.from(steps.querySelectorAll(".font-kanji"));
    expect(kanji).toHaveLength(3);
    for (const glyph of kanji) {
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(glyph.className).toContain("text-[11px]");
      expect(glyph.className).toContain("opacity-60");
    }
  });

  it("uses the capsule tokens: primary pill with the capsule shadow", () => {
    render(<NoteCapsule stage="prepare" actions={makeActions()} />);

    const capsule = screen.getByRole("group", { name: "Note capsule" });
    expect(capsule.className).toContain("bg-primary");
    expect(capsule.className).toContain("text-primary-foreground");
    expect(capsule.className).toContain("rounded-pill");
    expect(capsule.className).toContain("shadow-capsule");
  });

  it("offers Cancel and Start listening (Ctrl ⇧ N) while preparing", () => {
    const actions = makeActions();
    render(<NoteCapsule stage="prepare" actions={actions} />);

    const start = screen.getByRole("button", { name: /Begin listening/ });
    expect(start.className).toContain("bg-recording");
    expect(start.textContent).toContain("Ctrl ⇧ N");
    expect(start.getAttribute("aria-keyshortcuts")).toBe("Ctrl+Shift+N");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(start);
    expect(actions.onCancel).toHaveBeenCalledTimes(1);
    expect(actions.onStart).toHaveBeenCalledTimes(1);
  });

  it("hides Cancel when there is nowhere to go back to", () => {
    render(
      <NoteCapsule
        stage="prepare"
        actions={{ ...makeActions(), onCancel: undefined }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("shows the recording dot, timer, level and Finish while listening", () => {
    const actions = makeActions();
    render(
      <NoteCapsule
        stage="listen"
        actions={actions}
        listening={{
          seconds: 754,
          amplitude: 0.5,
          muted: false,
          finalizing: false,
        }}
      />,
    );

    expect(screen.getByRole("timer").textContent).toBe("12:34");
    expect(document.querySelector(".bg-recording")).not.toBeNull();
    expect(
      document
        .querySelector("[data-level-meter]")
        ?.getAttribute("data-animated"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(actions.onStop).toHaveBeenCalledTimes(1);
  });

  it("freezes the sound level when the user prefers reduced motion", () => {
    hoisted.reduceMotion = true;
    render(
      <NoteCapsule
        stage="listen"
        actions={makeActions()}
        listening={{
          seconds: 1,
          amplitude: 1,
          muted: false,
          finalizing: false,
        }}
      />,
    );

    const meter = document.querySelector("[data-level-meter]");
    expect(meter?.getAttribute("data-animated")).toBe("false");
    expect(meter?.querySelector(".transition-transform")).toBeNull();
  });

  it("disables Finish while the capture is finalizing", () => {
    render(
      <NoteCapsule
        stage="listen"
        actions={makeActions()}
        listening={{ seconds: 1, amplitude: 0, muted: false, finalizing: true }}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Finishing…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("offers Copy, Export and Ask the note (Ctrl J) for the synthesis", () => {
    const actions = makeActions();
    render(
      <NoteCapsule stage="synthesis" actions={actions} modifierLabel="⌘" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const ask = screen.getByRole("button", { name: /Ask the note/ });
    expect(ask.textContent).toContain("⌘ J");
    expect(ask.getAttribute("aria-keyshortcuts")).toBe("Meta+J");
    fireEvent.click(ask);

    expect(actions.onCopy).toHaveBeenCalledTimes(1);
    expect(actions.onExport).toHaveBeenCalledTimes(1);
    expect(actions.onAsk).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Begin listening/ })).toBe(
      null,
    );
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "00:00"],
    [59, "00:59"],
    [61, "01:01"],
    [3725, "1:02:05"],
  ])("%i s → %s", (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected);
  });
});
