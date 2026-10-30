import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "macos"),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: mocks.platform,
}));

vi.mock("./default-share-access", () => ({
  DefaultMeetingShareAccessSelector: () => (
    <span>Default sharing selector</span>
  ),
}));
vi.mock("./primary-recording-device", () => ({
  PrimaryRecordingDeviceSelector: () => null,
}));

import { MeetingSettingsView } from "./meeting-settings";

function setting(value = true) {
  return {
    value,
    onChange: vi.fn(),
  };
}

function renderMeetingSettings({
  autoStartScheduledMeetings = true,
  floatingBar = true,
  meetingDisclosureAutoPost = setting(),
  captureMeetingChat = setting(false),
  captureSharedScreens = setting(false),
  captureReminder = setting(),
} = {}) {
  return {
    ...render(
      <MeetingSettingsView
        autoJoinScheduledMeetings={setting()}
        autoStartScheduledMeetings={setting(autoStartScheduledMeetings)}
        autoStopMeetings={setting()}
        floatingBar={setting(floatingBar)}
        meetingDisclosureAutoPost={meetingDisclosureAutoPost}
        captureMeetingChat={captureMeetingChat}
        captureSharedScreens={captureSharedScreens}
        captureReminder={captureReminder}
      />,
    ),
    meetingDisclosureAutoPost,
    captureReminder,
  };
}

describe("MeetingSettingsView", () => {
  afterEach(() => {
    cleanup();
    mocks.platform.mockReturnValue("macos");
  });

  it("exposes the participant reminder and toggles it", () => {
    const { captureReminder } = renderMeetingSettings();
    const row = screen.getByText("Remind participants about recording");
    expect(row).toBeTruthy();

    const checkbox = row
      .closest("label")
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (checkbox) {
      fireEvent.click(checkbox);
      expect(captureReminder.onChange).toHaveBeenCalled();
    }
  });

  it("hides meeting AX controls on Windows until UI Automation lands", () => {
    mocks.platform.mockReturnValue("windows");
    renderMeetingSettings();

    expect(
      screen.queryByText("Post recording disclosure in meeting chat"),
    ).toBeNull();
    expect(screen.queryByText("Capture meeting chat in Memos")).toBeNull();
    expect(screen.getByText("Show floating bar")).toBeTruthy();
    expect(screen.queryByText("Stop when meeting ends")).toBeNull();
  });

  it("shows scheduled meeting options on macOS", () => {
    renderMeetingSettings();

    expect(screen.getByText("Start when meeting begins")).toBeTruthy();
    expect(screen.getByText("Join scheduled meetings")).toBeTruthy();
  });

  it.each(["linux", "windows"])(
    "hides scheduled meeting options on %s (no calendar)",
    (os) => {
      mocks.platform.mockReturnValue(os);
      renderMeetingSettings();

      expect(screen.queryByText("Start when meeting begins")).toBeNull();
      expect(screen.queryByText("Join scheduled meetings")).toBeNull();
      expect(screen.getByText("Show floating bar")).toBeTruthy();
    },
  );

  it("exposes meeting chat capture and disclosure on Linux", () => {
    mocks.platform.mockReturnValue("linux");
    renderMeetingSettings();

    expect(
      screen.getByText("Post recording disclosure in meeting chat"),
    ).toBeTruthy();
    expect(screen.getByText("Capture meeting chat in Memos")).toBeTruthy();
    expect(
      screen.getByText(/supported meetings using Accessibility/),
    ).toBeTruthy();
    expect(screen.getByText("Stop when meeting ends")).toBeTruthy();
  });

  it("only enables automatic joining when scheduled listening is enabled", () => {
    renderMeetingSettings({ autoStartScheduledMeetings: false });

    expect(
      screen
        .getByRole("switch", { name: "Join scheduled meetings" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("updates the recording disclosure setting", () => {
    const meetingDisclosureAutoPost = setting(false);
    renderMeetingSettings({ meetingDisclosureAutoPost });

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Post recording disclosure in meeting chat",
      }),
    );

    expect(meetingDisclosureAutoPost.onChange).toHaveBeenCalledWith(true);
  });
});
