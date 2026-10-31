import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentTab: { type: "settings", state: { tab: "app" } } as {
    type: "settings";
    state: { tab?: string };
  } | null,
  tabs: [] as Array<{
    active: boolean;
    pinned: boolean;
    slotId: string;
    type: "templates";
    state: {
      showHomepage: boolean;
      isWebMode: boolean;
      selectedMineId: string | null;
      selectedWebIndex: number | null;
    };
  }>,
  openNew: vi.fn(),
  isPro: true,
  isUpgradingToPro: false,
  select: vi.fn(),
  transitionChatMode: vi.fn(),
  upgradeToPro: vi.fn(),
  updateSettingsTabState: vi.fn(),
  updateTemplatesTabState: vi.fn(),
  workspaces: [] as Array<{ workspaceId: string }> | undefined,
  workspacesLoading: false,
  serverStates: {
    stt: { status: "failed", failure: { ok: false, reason: "unreachable" } },
    llm: { status: "connected", latencyMs: 84, protocol: "openai", models: [] },
  } as Record<string, unknown>,
}));

const lingui = vi.hoisted(() => {
  const t = (
    input: TemplateStringsArray | { message?: string } | string,
    ...values: unknown[]
  ) => {
    if (Array.isArray(input)) {
      return input.reduce(
        (message, part, index) =>
          `${message}${part}${index < values.length ? String(values[index]) : ""}`,
        "",
      );
    }

    if (typeof input === "string") {
      return input;
    }

    if ("message" in input) {
      return input.message ?? "";
    }

    return "";
  };

  return { t };
});

vi.mock("@lingui/react/macro", () => ({
  Trans: ({
    children,
    id,
    message,
  }: {
    children?: ReactNode;
    id?: string;
    message?: string;
  }) => <>{children ?? message ?? id}</>,
  useLingui: () => ({
    _: lingui.t,
    t: lingui.t,
  }),
}));

vi.mock("./custom-sidebar-header", () => ({
  CustomSidebarHeader: () => <div />,
}));

vi.mock("~/settings/ai/shared/server-connection", () => ({
  useServerConnection: (kind: string) => ({ state: mocks.serverStates[kind] }),
}));

vi.mock("~/billing/billing-context", () => ({
  useBillingAccess: () => ({
    isPro: mocks.isPro,
    isUpgradingToPro: mocks.isUpgradingToPro,
    upgradeToPro: mocks.upgradeToPro,
  }),
}));

vi.mock("~/settings/team/mirror", () => ({
  useMyWorkspacesWithMirror: () => ({
    data: mocks.workspaces,
    isLoading: mocks.workspacesLoading,
    isPending: mocks.workspacesLoading,
  }),
}));

vi.mock("~/store/zustand/tabs", () => {
  const getState = () => ({
    currentTab: mocks.currentTab,
    tabs: mocks.tabs,
    openNew: mocks.openNew,
    select: mocks.select,
    transitionChatMode: mocks.transitionChatMode,
    updateSettingsTabState: mocks.updateSettingsTabState,
    updateTemplatesTabState: mocks.updateTemplatesTabState,
  });
  const useTabs = Object.assign(
    (selector: (state: unknown) => unknown) => selector(getState()),
    { getState },
  );

  return {
    useTabs,
  };
});

import { SettingsNav } from "./settings";

describe("SettingsNav", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.currentTab = { type: "settings", state: { tab: "app" } };
    mocks.tabs = [];
    mocks.isPro = true;
    mocks.isUpgradingToPro = false;
    mocks.openNew.mockClear();
    mocks.select.mockClear();
    mocks.transitionChatMode.mockClear();
    mocks.upgradeToPro.mockClear();
    mocks.updateSettingsTabState.mockClear();
    mocks.updateTemplatesTabState.mockClear();
    mocks.workspaces = [];
    mocks.workspacesLoading = false;
  });

  const openedSettingsTab = () =>
    mocks.updateSettingsTabState.mock.lastCall?.[1] as
      | { tab: string }
      | undefined;
  it("shows the four groups of the redesign, then a folded Advanced group", () => {
    render(<SettingsNav />);

    const headings = screen
      .getAllByText(/^(Me|My servers|Writing|My meetings|Advanced)$/)
      .map((element) => element.textContent);
    expect(headings).toEqual([
      "Me",
      "My servers",
      "Writing",
      "My meetings",
      "Advanced",
    ]);
    for (const label of [
      "Profile",
      "Appearance",
      "Notifications",
      "Dictation",
      "Dictionary",
      "Templates",
      "Meetings",
      "Calendar",
      "Folders",
      "Contacts",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /^Transcription/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Synthesis/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Permissions" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Advanced" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("no longer offers Insights, even via search", () => {
    render(<SettingsNav />);

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "insights" },
    });

    expect(screen.queryByRole("button", { name: "Insights" })).toBeNull();
    expect(screen.getByText("No results found.")).toBeTruthy();
  });

  it("marks the current page and the servers' status", () => {
    mocks.currentTab = { type: "settings", state: { tab: "transcription" } };
    render(<SettingsNav />);

    const transcription = screen.getByRole("button", {
      name: /^Transcription/,
    });
    expect(transcription.getAttribute("aria-current")).toBe("page");
    expect(transcription.textContent).toContain("Transcription · unreachable");
    expect(
      screen.getByRole("button", { name: /^Synthesis/ }).textContent,
    ).toContain("Synthesis · connected");

    const footer = screen.getByRole("status", { name: "Server status" });
    expect(footer.textContent).toContain("Transcription · unreachable");
    expect(footer.textContent).toContain("Synthesis · connected");
  });

  it.each([
    ["Profile", "app"],
    ["Synthesis", "intelligence"],
    ["Dictionary", "dictionary"],
    ["Meetings", "meetings"],
  ])("opens %s inside settings", (label, tab) => {
    render(<SettingsNav />);

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^${label}`) }),
    );

    expect(mocks.updateSettingsTabState).toHaveBeenCalledWith(
      mocks.currentTab,
      { tab },
    );
  });

  it("unfolds Advanced to reach the remaining settings", () => {
    render(<SettingsNav />);

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
    expect(openedSettingsTab()).toEqual({ tab: "permissions" });

    fireEvent.click(screen.getByRole("button", { name: /Automations/ }));
    expect(mocks.openNew).toHaveBeenCalledWith({ type: "automations" });
  });

  it("keeps Advanced open when one of its pages is shown", () => {
    mocks.currentTab = { type: "settings", state: { tab: "developers" } };
    render(<SettingsNav />);

    expect(
      screen
        .getByRole("button", { name: "Developers" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it.each([
    ["Calendar", "calendar"],
    ["Templates", "templates"],
  ])("opens the %s workspace in a new tab", (label, type) => {
    render(<SettingsNav />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(mocks.openNew).toHaveBeenCalledWith({ type });
  });

  it("keeps locked Pro features visible and navigable without forcing an upgrade", () => {
    mocks.isPro = false;
    render(<SettingsNav />);

    fireEvent.click(screen.getByRole("button", { name: /Dictionary/ }));
    expect(openedSettingsTab()).toEqual({ tab: "dictionary" });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Automations/ }));

    expect(mocks.openNew).toHaveBeenCalledWith({ type: "automations" });
    expect(mocks.upgradeToPro).not.toHaveBeenCalled();
  });

  it("filters nav items by item or group label", () => {
    render(<SettingsNav />);
    const input = screen.getByPlaceholderText("Search settings...");

    fireEvent.change(input, { target: { value: "appear" } });
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.queryByText("Meetings")).toBeNull();

    fireEvent.change(input, { target: { value: "my meetings" } });
    expect(screen.getByText("Meetings")).toBeTruthy();
    expect(screen.getByText("Templates")).toBeTruthy();
    expect(screen.queryByText("Appearance")).toBeNull();

    fireEvent.change(input, { target: { value: "develop" } });
    expect(screen.getByRole("button", { name: "Developers" })).toBeTruthy();
  });

  it("shows an empty state when no settings match", () => {
    render(<SettingsNav />);

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "zzzzzz" },
    });

    expect(screen.getByText("No results found.")).toBeTruthy();
  });

  it.each([
    [
      "the clear button",
      () => {
        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
      },
    ],
    [
      "Escape",
      () => {
        fireEvent.keyDown(screen.getByPlaceholderText("Search settings..."), {
          key: "Escape",
        });
      },
    ],
  ])("restores the full list when search is cleared with %s", (_, clear) => {
    render(<SettingsNav />);

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "audio" },
    });
    expect(screen.queryByText("Appearance")).toBeNull();

    clear();

    expect(screen.getByText("Appearance")).toBeTruthy();
  });
});
