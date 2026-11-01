import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  getLiveTranscriptPausedMessage,
  getLiveTranscriptResumedMessage,
} from "./live-transcript-interrupted";

import { messages as frMessages } from "~/i18n/locales/fr/messages";

function activateFrench() {
  i18n.load("fr", frMessages);
  i18n.activate("fr");
}

afterEach(() => {
  i18n.activate("en");
});

describe("getLiveTranscriptPausedMessage", () => {
  it("names the provider when it reports an outage", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "stream_error", message: "nvidia: overloaded" },
        sttProvider: "nvidia",
        online: true,
      }),
    ).toMatch(/: Nemotron ASR \(NIM, WebSocket\) is having an outage\./);
  });

  it("reports unreachable direct providers", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "connection_timeout" },
        sttProvider: "openai",
        online: true,
      }),
    ).toMatch(/Syntheo cannot reach OpenAI-compatible/);
  });

  it("live_interrupted_notice_mentions_no_saved_audio", () => {
    const message = getLiveTranscriptPausedMessage({
      degraded: null,
      sttProvider: "custom",
      online: true,
    });
    expect(message).not.toMatch(/being saved|filled in from the recording/);
    expect(message).toContain("No audio is kept");
    expect(message).toMatch(/Reconnecting…$/);
  });

  it("ne promet pas de reconnexion quand le serveur refuse la clé", () => {
    // Le listener ne réessaie pas après un refus d'authentification ou de
    // configuration : annoncer « Reconnexion… » serait faux.
    const message = getLiveTranscriptPausedMessage({
      degraded: { type: "authentication_failed", provider: "nvidia" },
      sttProvider: "nvidia",
      online: true,
    });
    expect(message).not.toMatch(/Reconnecting/);
    expect(message).toMatch(/Check the transcription server settings\.$/);
  });
});

describe("messages en français", () => {
  it("parle de « transcription » et non de « transcript »", () => {
    activateFrench();

    const paused = getLiveTranscriptPausedMessage({
      degraded: { type: "stream_error", message: "nvidia: overloaded" },
      sttProvider: "nvidia",
      online: true,
    });

    expect(paused).toBe(
      "Transcription en direct en pause : Nemotron ASR (NIM, WebSocket) subit une panne. Aucun audio n'est conservé : ce passage manquera à la transcription. Reconnexion…",
    );
    expect(paused).not.toMatch(/transcript\b/i);
    expect(getLiveTranscriptResumedMessage()).toBe(
      "Transcription en direct reprise.",
    );
  });

  it("traduit la cause par défaut", () => {
    activateFrench();

    expect(
      getLiveTranscriptPausedMessage({
        degraded: null,
        sttProvider: null,
        online: false,
      }),
    ).toMatch(/^Transcription en direct en pause : vous êtes hors ligne\./);
  });
});
