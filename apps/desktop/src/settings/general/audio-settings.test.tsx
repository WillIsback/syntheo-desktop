import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioSettingsView } from "./audio-settings";

function renderAudioSettings({
  microphoneDevice = {
    value: "",
    devices: ["External Microphone"],
    onChange: vi.fn(),
  },
} = {}) {
  return render(<AudioSettingsView microphoneDevice={microphoneDevice} />);
}

describe("AudioSettingsView", () => {
  afterEach(cleanup);

  it("shows when the selected microphone is unavailable and will fall back", () => {
    renderAudioSettings({
      microphoneDevice: {
        value: "Disconnected Microphone",
        devices: ["External Microphone"],
        onChange: vi.fn(),
      },
    });

    expect(
      screen.getByRole("combobox", { name: "Microphone" }).textContent,
    ).toContain(
      "Disconnected Microphone (Unavailable — using current default)",
    );
  });

  // Règle audio de Syntheo : rien à conserver, donc ni réglage de rétention ni
  // empreintes vocales construites à partir de l'audio.
  it("audio_settings_offer_no_retention_or_voiceprint", () => {
    const { container } = renderAudioSettings();
    expect(container.textContent).not.toContain("Audio file retention");
    expect(container.textContent).not.toContain("Remember speakers");
  });
});
