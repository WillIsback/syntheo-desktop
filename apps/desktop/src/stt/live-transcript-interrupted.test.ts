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
    ).toMatch(/because NVIDIA Speech NIM is having an outage\./);
  });

  it("reports unreachable direct providers", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "connection_timeout" },
        sttProvider: "openai",
        online: true,
      }),
    ).toMatch(/Anarlog can't reach OpenAI-compatible/);
  });

  it("live_interrupted_notice_mentions_no_saved_audio", () => {
    const message = getLiveTranscriptPausedMessage({
      degraded: null,
      sttProvider: "custom",
      online: true,
    });
    expect(message).not.toMatch(/being saved|filled in from the recording/);
    expect(message).toContain(
      "No audio is kept, so this part will be missing from the transcript. Reconnecting…",
    );
  });
});
