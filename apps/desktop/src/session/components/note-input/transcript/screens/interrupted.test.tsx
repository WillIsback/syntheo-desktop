import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveTranscriptStatusNotice } from "./interrupted";

vi.mock("~/stt/contexts", () => ({
  useListener: (selector: (state: unknown) => unknown) =>
    selector({
      live: { degraded: { type: "connection_timeout" } },
    }),
}));

vi.mock("~/settings/queries", () => ({
  useStoredSettingValue: () => ({ value: "nvidia", hasValue: true }),
}));

describe("LiveTranscriptStatusNotice (marge d'écoute)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("annonce la pause, puis la reprise, puis s'efface", () => {
    vi.useFakeTimers();
    const { rerender } = render(<LiveTranscriptStatusNotice interrupted />);

    expect(screen.getByRole("status").textContent).toMatch(
      /^Live transcription paused: Syntheo cannot reach Nemotron ASR/,
    );
    expect(screen.getByRole("status").textContent).toMatch(/Reconnecting…$/);

    rerender(<LiveTranscriptStatusNotice interrupted={false} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Live transcription resumed.",
    );

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ne dit rien tant que l'écoute n'a jamais été interrompue", () => {
    render(<LiveTranscriptStatusNotice interrupted={false} />);

    expect(screen.queryByRole("status")).toBeNull();
  });
});
