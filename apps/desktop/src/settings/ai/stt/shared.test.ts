import { describe, expect, test } from "vitest";

import { PROVIDERS } from "./shared";

import {
  resolveServerProviderId,
  STT_SERVER_PROTOCOLS,
} from "~/settings/ai/shared/server-connection";

describe("hosted transcription", () => {
  test("hosted_stt_is_never_auto_selected", () => {
    // Le modèle hébergé « Syntheo cloud » exige un compte qui n'existe plus :
    // il ne doit jamais être proposé ni choisi par défaut.
    const selectable = PROVIDERS.filter(({ disabled }) => !disabled).map(
      ({ id }) => id,
    );
    expect(selectable).not.toContain("syntheo");
    expect([...STT_SERVER_PROTOCOLS].sort()).toEqual([...selectable].sort());
    expect(
      resolveServerProviderId("stt", undefined, {
        "stt:syntheo": { base_url: "https://cloud.example.com" },
        "stt:nvidia": { base_url: "http://localhost:9000/v1/realtime" },
      }),
    ).toBe("nvidia");
  });

  test("the server card follows the saved protocol, OpenAI by default", () => {
    expect(resolveServerProviderId("stt", "nvidia", {})).toBe("nvidia");
    expect(resolveServerProviderId("stt", "", {})).toBe("openai");
    expect(resolveServerProviderId("llm", "nvidia", {})).toBe("custom");
  });
});
