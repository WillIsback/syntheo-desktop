import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranscriptEmptyState } from "./empty";

describe("TranscriptEmptyState", () => {
  afterEach(() => {
    cleanup();
  });

  it("lets users stop batch transcription", () => {
    const onStopTranscription = vi.fn();

    render(
      <TranscriptEmptyState
        isBatching
        phase="transcribing"
        onStopTranscription={onStopTranscription}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop transcription" }));

    expect(onStopTranscription).toHaveBeenCalledTimes(1);
  });

  it("hides the stop control while importing audio", () => {
    render(<TranscriptEmptyState isBatching phase="importing" />);

    expect(
      screen.queryByRole("button", { name: "Stop transcription" }),
    ).toBeNull();
  });

  // Aucun audio conservé : rien à retranscrire.
  it("uses the same error hierarchy without offering re-transcription", () => {
    render(
      <TranscriptEmptyState error="The transcription provider timed out." />,
    );

    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText("Transcription failed").className).toContain(
      "text-base",
    );
    expect(
      screen.getByText("The transcription provider timed out.").className,
    ).toContain("text-sm");

    expect(screen.queryByRole("button", { name: "Re-transcribe" })).toBeNull();
  });
});
