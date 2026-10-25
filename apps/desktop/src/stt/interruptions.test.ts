import { expect, it } from "vitest";

import { formatInterruption, formatInterruptions } from "./interruptions";

const at = (hour: number, minute: number) =>
  Date.UTC(2026, 9, 25, hour, minute);

it("formats an interruption as local HH:MM–HH:MM", () => {
  expect(
    formatInterruption(
      { startedAt: at(13, 32), endedAt: at(13, 35) },
      "Europe/Paris",
    ),
  ).toBe("14:32–14:35");
});

it("incomplete_capture_banner_lists_dated_gaps (texte)", () => {
  expect(
    formatInterruptions(
      [
        { startedAt: at(13, 32), endedAt: at(13, 35) },
        { startedAt: at(14, 1), endedAt: at(14, 2) },
      ],
      "Europe/Paris",
    ),
  ).toBe("Transcription interrompue 14:32–14:35, 15:01–15:02");
});
