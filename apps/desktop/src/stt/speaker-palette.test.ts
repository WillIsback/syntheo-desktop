import { describe, expect, it } from "vitest";

import { SPEAKER_PALETTE, speakerColor } from "./speaker-palette";

describe("speakerColor", () => {
  it("renvoie les quatre couleurs dans l'ordre", () => {
    expect(speakerColor(0)).toBe(SPEAKER_PALETTE[0]);
    expect(speakerColor(1)).toBe(SPEAKER_PALETTE[1]);
    expect(speakerColor(2)).toBe(SPEAKER_PALETTE[2]);
    expect(speakerColor(3)).toBe(SPEAKER_PALETTE[3]);
  });

  it("cycle au-delà de la palette", () => {
    expect(speakerColor(4)).toBe(SPEAKER_PALETTE[0]);
    expect(speakerColor(7)).toBe(SPEAKER_PALETTE[3]);
  });

  it("reste dans la palette pour les index négatifs ou invalides", () => {
    expect(speakerColor(-1)).toBe(SPEAKER_PALETTE[3]);
    expect(speakerColor(Number.NaN)).toBe(SPEAKER_PALETTE[0]);
  });
});
