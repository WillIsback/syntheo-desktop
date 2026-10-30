import { describe, expect, it } from "vitest";

import { getLiveTranscriptPausedMessage } from "./live-transcript-interrupted";

describe("getLiveTranscriptPausedMessage", () => {
  it("names the provider when it reports an outage", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "stream_error", message: "nvidia: overloaded" },
        sttProvider: "nvidia",
        online: true,
      }),
    ).toMatch(/: Nemotron ASR \(NIM, WebSocket\) subit une panne\./);
  });

  it("reports unreachable direct providers", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "connection_timeout" },
        sttProvider: "openai",
        online: true,
      }),
    ).toMatch(/Syntheo ne parvient pas à joindre OpenAI-compatible/);
  });

  it("live_interrupted_notice_mentions_no_saved_audio", () => {
    const message = getLiveTranscriptPausedMessage({
      degraded: null,
      sttProvider: "custom",
      online: true,
    });
    expect(message).not.toMatch(/being saved|filled in from the recording/);
    expect(message).toContain(
      "Aucun audio n'est conservé : ce passage manquera au transcript. Reconnexion…",
    );
  });
});
