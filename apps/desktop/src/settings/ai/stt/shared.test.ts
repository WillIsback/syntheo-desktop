import { describe, expect, test } from "vitest";

import { PROVIDERS } from "./shared";

describe("hosted transcription", () => {
  test("hosted_stt_is_never_auto_selected", async () => {
    // Le modèle hébergé « Anarlog cloud » exige un compte qui n'existe plus :
    // il ne doit jamais être proposé ni choisi par défaut.
    const { getDefaultSttSelection } = await import("./selection");
    const selectable = PROVIDERS.filter(({ disabled }) => !disabled).map(
      ({ id }) => id,
    );
    expect(selectable).not.toContain("anarlog");
    expect(
      getDefaultSttSelection(selectable, {
        anarlog: {
          configured: true,
          models: [{ id: "cloud", isDownloaded: true }],
        },
        openai: { configured: true, models: [{ id: "voxtral" }] },
      })?.provider,
    ).toBe("openai");
  });
});
