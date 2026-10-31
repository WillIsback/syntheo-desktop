import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignPalettes } from "@syntheo/design-system";
import type { LiveCaptionState } from "@syntheo/plugin-windows";

import { LiveCaptionOverlay } from "./live-caption";

function state(overrides: Partial<LiveCaptionState> = {}): LiveCaptionState {
  return {
    text: "we should ship this",
    opacity: 0.3,
    width: 440,
    lineCount: 1,
    position: "topCenter",
    minimized: false,
    ...overrides,
  };
}

describe("LiveCaptionOverlay", () => {
  afterEach(() => {
    cleanup();
  });

  it("emits opacity and hide from the footer", () => {
    const onOpacityChange = vi.fn();
    const onHide = vi.fn();

    render(
      <LiveCaptionOverlay
        state={state()}
        onOpacityChange={onOpacityChange}
        onHide={onHide}
      />,
    );

    fireEvent.change(screen.getByLabelText("Transcript opacity"), {
      target: { value: "0.66" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide transcript" }));

    expect(onOpacityChange).toHaveBeenCalledWith(0.66);
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("prend l'encre sombre de la palette active et suit son changement", async () => {
    document.documentElement.setAttribute("data-palette", "fuji");
    render(
      <LiveCaptionOverlay
        state={state()}
        onOpacityChange={vi.fn()}
        onHide={vi.fn()}
      />,
    );
    const text = screen.getByText("we should ship this");
    expect(text.style.color).toBe(
      hexToCssRgb(DesignPalettes.fuji.dark.foreground),
    );

    await act(async () => {
      document.documentElement.setAttribute("data-palette", "enji");
      await Promise.resolve();
    });
    expect(text.style.color).toBe(
      hexToCssRgb(DesignPalettes.enji.dark.foreground),
    );
    document.documentElement.removeAttribute("data-palette");
  });
});

function hexToCssRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
