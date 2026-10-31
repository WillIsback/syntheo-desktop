import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: "linux",
  openNew: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => mocks.platform }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@syntheo/plugin-transcription", () => ({
  commands: {
    listMicrophoneDevices: vi.fn().mockResolvedValue({
      status: "ok",
      data: [],
    }),
  },
}));
vi.mock("~/billing/billing-context", () => ({
  useBillingAccess: () => ({ isPro: true }),
}));
vi.mock("~/settings/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./dictation-shortcut", () => ({
  DictationShortcut: () => <div>Dictation shortcut</div>,
}));
vi.mock("~/settings/queries", () => ({
  useSetSettingValue: () => vi.fn(),
}));
vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) =>
    key === "microphone_device" || key === "dictation_shortcut" ? "" : false,
}));
vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: unknown) => unknown) =>
    selector({ openNew: mocks.openNew }),
}));

import { SettingsDictation } from "./dictation";

function setup() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsDictation />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = "linux";
});
afterEach(cleanup);

describe("SettingsDictation", () => {
  it("replie les consignes Wayland / X11 sur Linux", () => {
    setup();

    const help = screen.getByTestId("dictation-linux-help");
    expect(help.tagName).toBe("DETAILS");
    expect(help.hasAttribute("open")).toBe(false);
    expect(help.textContent).toContain("On Linux (Wayland or X11)");
  });

  it("n'affiche pas les consignes Linux ailleurs", () => {
    mocks.platform = "macos";
    setup();

    expect(screen.queryByTestId("dictation-linux-help")).toBeNull();
  });

  it("propose un champ d'essai", () => {
    setup();

    expect(screen.getByRole("textbox", { name: "Try dictation" })).toBeTruthy();
  });

  it("remplace les boutons de navigation par des liens dans les lignes", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "System permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "dictionary" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Transcription server ›" }),
    );

    expect(mocks.openNew.mock.calls.map(([tab]) => tab.state.tab)).toEqual([
      "permissions",
      "dictionary",
      "transcription",
    ]);
  });
});
