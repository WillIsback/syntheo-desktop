import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isFullscreen: vi.fn().mockResolvedValue(false),
  platform: "macos" as "linux" | "macos" | "windows",
  startDragging: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  currentTab: {
    active: true,
    pinned: false,
    slotId: "slot-1",
    type: "empty",
  } as null | {
    active: boolean;
    id?: string;
    pinned: boolean;
    slotId: string;
    type: string;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: mocks.isFullscreen,
    onResized: vi.fn(async () => () => {}),
    startDragging: mocks.startDragging,
    toggleMaximize: mocks.toggleMaximize,
  }),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => mocks.platform,
}));

vi.mock("~/main/useShortcuts", () => ({
  useClassicMainShortcuts: vi.fn(),
}));

vi.mock("~/main/tab-content", () => ({
  ClassicMainTabContent: ({ tab }: { tab: { type: string } }) =>
    tab.type === "sessions" ? (
      <div data-testid="main-tab-content">
        <input aria-label="Session title" />
      </div>
    ) : tab.type === "empty" ? (
      <div data-testid="main-tab-content">
        <div data-tauri-drag-region data-testid="native-main-tab-drag-region">
          <span data-testid="native-main-tab-drag-target">{tab.type}</span>
        </div>
      </div>
    ) : (
      <div data-testid="main-tab-content">{tab.type}</div>
    ),
}));

// Les navigations internes des vues (ex-barre latérale) sont simulées.
vi.mock("~/sidebar/settings", () => ({
  SettingsNav: () => <nav data-testid="view-nav">settings-nav</nav>,
}));
vi.mock("~/sidebar/calendar", () => ({
  CalendarNav: () => <nav data-testid="view-nav">calendar-nav</nav>,
}));
vi.mock("~/sidebar/contacts", () => ({
  ContactsNav: () => <nav data-testid="view-nav">contacts-nav</nav>,
}));
vi.mock("~/sidebar/templates", () => ({
  TemplatesNav: () => <nav data-testid="view-nav">templates-nav</nav>,
}));
vi.mock("~/sidebar/automations", () => ({
  AutomationsNav: () => <nav data-testid="view-nav">automations-nav</nav>,
}));
vi.mock("~/sidebar/folders", () => ({
  FoldersNav: () => <nav data-testid="view-nav">folders-nav</nav>,
}));

vi.mock("~/store/zustand/tabs", () => ({
  uniqueIdfromTab: vi.fn(() => "empty-slot"),
  useTabs: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ currentTab: mocks.currentTab }),
  ),
}));

import { ClassicMainBody } from "~/main/body";

describe("ClassicMainBody", () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
    mocks.isFullscreen.mockReset();
    mocks.isFullscreen.mockResolvedValue(false);
    mocks.platform = "macos";
    mocks.startDragging.mockClear();
    mocks.toggleMaximize.mockClear();
    mocks.currentTab = {
      active: true,
      pinned: false,
      slotId: "slot-1",
      type: "empty",
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("affiche l'onglet courant sans barre latérale ni bascule", () => {
    render(<ClassicMainBody />);

    expect(screen.getByTestId("main-tab-content").textContent).toContain(
      "empty",
    );
    expect(screen.queryByTestId("view-nav")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide sidebar" })).toBeNull();
    expect(document.querySelector("[data-left-sidebar-chrome]")).toBeNull();
  });

  it("n'ajoute pas de navigation à une note", () => {
    mocks.currentTab = {
      active: true,
      id: "s1",
      pinned: false,
      slotId: "slot-1",
      type: "sessions",
    };

    render(<ClassicMainBody />);

    expect(screen.queryByTestId("view-nav")).toBeNull();
  });

  it.each([
    "settings",
    "calendar",
    "contacts",
    "templates",
    "automations",
    "folders",
  ] as const)(
    "la vue %s porte sa navigation dans sa zone de contenu",
    (type) => {
      mocks.currentTab = { active: true, pinned: false, slotId: "s", type };

      render(<ClassicMainBody />);

      const aside = screen.getByRole("complementary", {
        name: "View navigation",
      });
      expect(within(aside).getByTestId("view-nav").textContent).toBe(
        `${type}-nav`,
      );
      expect(screen.getByTestId("main-tab-content").textContent).toBe(type);
      expect(aside.closest("[data-main-content-panel]")).toBeTruthy();
    },
  );

  it.each([
    ["main-tab-content", 12, "empty", 1],
    ["Session title textbox", 12, "sessions", 0],
    ["main-tab-content", 56, "empty", 0],
  ] as const)(
    "starts window dragging from %s at y=%i on the %s tab",
    (target, clientY, tabType, expectedCalls) => {
      mocks.currentTab = {
        active: true,
        pinned: false,
        slotId: "slot-1",
        type: tabType,
      };

      render(<ClassicMainBody />);

      const dragTarget = resolveDragTarget(target);

      fireEvent.pointerDown(dragTarget, {
        button: 0,
        clientX: 12,
        clientY,
        pointerId: 1,
      });
      fireEvent.pointerMove(dragTarget, {
        clientX: 20,
        clientY,
        pointerId: 1,
      });

      expect(mocks.startDragging).toHaveBeenCalledTimes(expectedCalls);
    },
  );

  it.each([
    ["main-tab-content", 12, "empty", 1],
    ["native-main-tab-drag-region", 12, "empty", 0],
    ["native-main-tab-drag-target", 12, "empty", 1],
    ["Session title textbox", 12, "sessions", 0],
    ["main-tab-content", 56, "empty", 0],
  ] as const)(
    "toggles window maximization from %s at y=%i on the %s tab",
    (target, clientY, tabType, expectedCalls) => {
      mocks.currentTab = {
        active: true,
        pinned: false,
        slotId: "slot-1",
        type: tabType,
      };

      render(<ClassicMainBody />);

      const dragTarget = resolveDragTarget(target);

      fireEvent.doubleClick(dragTarget, {
        button: 0,
        clientX: 12,
        clientY,
      });

      expect(mocks.toggleMaximize).toHaveBeenCalledTimes(expectedCalls);
    },
  );

  it("renders the shell while the initial tab is still loading", async () => {
    const { useTabs } = await import("~/store/zustand/tabs");

    vi.mocked(useTabs).mockImplementationOnce(((
      selector: (state: unknown) => unknown,
    ) =>
      selector({
        tabs: [],
        currentTab: null,
      })) as typeof useTabs);

    const { container } = render(<ClassicMainBody />);
    const view = within(container);

    expect(container.querySelector("[data-main-content-panel]")).toBeTruthy();
    expect(view.queryByTestId("main-tab-content")).toBeNull();
  });
});

function resolveDragTarget(
  target:
    | "main-tab-content"
    | "native-main-tab-drag-region"
    | "native-main-tab-drag-target"
    | "Session title textbox",
) {
  if (target === "Session title textbox") {
    return screen.getByRole("textbox", { name: "Session title" });
  }

  return screen.getByTestId(target);
}
