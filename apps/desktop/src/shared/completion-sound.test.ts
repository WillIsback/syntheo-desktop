import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoredSettingValues: vi.fn(),
  playCompletionSound: vi.fn(),
}));

vi.mock("@syntheo/plugin-sfx", () => ({
  commands: { playCompletionSound: mocks.playCompletionSound },
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: mocks.getStoredSettingValues,
}));

import {
  normalizeCompletionSoundName,
  playCompletionSound,
  previewCompletionSound,
} from "./completion-sound";

function stored(values: Record<string, boolean | string> = {}) {
  return {
    values,
    hasValues: new Set(Object.keys(values)),
  };
}

describe("completion sounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredSettingValues.mockResolvedValue(stored());
    mocks.playCompletionSound.mockResolvedValue(undefined);
  });

  it.each([
    [{}, "ready"],
    [{ notification_completion_sound_name: "sparkle" }, "sparkle"],
    [{ notification_completion_sound_name: "unknown" }, "ready"],
  ])("plays the configured completion sound", async (values, expected) => {
    mocks.getStoredSettingValues.mockResolvedValue(stored(values));

    await playCompletionSound();

    expect(mocks.playCompletionSound).toHaveBeenCalledWith(expected, 0.7);
  });

  it("falls back to Ready for an unknown stored sound", () => {
    expect(normalizeCompletionSoundName("unknown")).toBe("ready");
  });

  const disabledSettings: Record<string, boolean>[] = [
    { notification_disabled: true },
    { notification_completion_sound: false },
  ];

  it.each(disabledSettings)("does not play when disabled", async (settings) => {
    mocks.getStoredSettingValues.mockResolvedValue(stored(settings));

    await playCompletionSound();

    expect(mocks.playCompletionSound).not.toHaveBeenCalled();
  });

  it("previews a sound without reading preferences", () => {
    previewCompletionSound("bloom");

    expect(mocks.playCompletionSound).toHaveBeenCalledWith("bloom", 0.7);
    expect(mocks.getStoredSettingValues).not.toHaveBeenCalled();
  });

  it("swallows a playback failure", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    mocks.playCompletionSound.mockRejectedValue(new Error("no output"));

    await expect(playCompletionSound()).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalled();

    debug.mockRestore();
  });
});
