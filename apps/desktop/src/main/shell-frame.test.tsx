import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentTab: { type: "empty" } as { type: string } | null,
  platform: "macos" as "linux" | "macos" | "windows",
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => mocks.platform,
}));

vi.mock("./body", () => ({
  ClassicMainBody: () => null,
}));

vi.mock("./windows-title-bar", () => ({
  WindowsTitleBar: () => <div data-testid="windows-title-bar" />,
}));

vi.mock("~/shared/main", () => ({
  MainShellBodyFrame: ({ children }: { children: React.ReactNode }) => children,
  MainShellScaffold: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/sidebar/toast", () => ({
  ToastNotifications: () => null,
}));

vi.mock("~/devtools-bar", () => ({
  DevtoolsStatusBar: () => null,
}));

vi.mock("./view-navigation", () => ({
  hasViewNavigation: (tab: { type: string } | null) =>
    tab !== null &&
    [
      "settings",
      "calendar",
      "contacts",
      "templates",
      "automations",
      "folders",
    ].includes(tab.type),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (
    selector: (state: { currentTab: typeof mocks.currentTab }) => unknown,
  ) => selector({ currentTab: mocks.currentTab }),
}));

import { ClassicMainShellFrame, resolveMainSurfaceChrome } from "./shell-frame";

describe("ClassicMainShellFrame", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.currentTab = { type: "empty" };
    mocks.platform = "macos";
  });

  it.each([
    ["windows", true],
    ["linux", true],
    ["macos", false],
  ] as const)(
    "shows the custom title bar on %s",
    (runtimePlatform, visible) => {
      mocks.platform = runtimePlatform;

      render(<ClassicMainShellFrame />);

      if (visible) {
        expect(screen.getByTestId("windows-title-bar")).toBeTruthy();
      } else {
        expect(screen.queryByTestId("windows-title-bar")).toBeNull();
      }
    },
  );

  it.each([
    ["sessions", "top-borderless"],
    ["empty", "top-borderless"],
    ["changelog", "top"],
    ["settings", "left"],
    ["templates", "left"],
    ["onboarding", undefined],
  ] as const)(
    "habille la surface principale de %s sans barre latérale",
    (type, chrome) => {
      expect(resolveMainSurfaceChrome({ type })).toBe(chrome);
    },
  );
});
