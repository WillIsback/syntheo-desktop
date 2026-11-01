import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentTab: { type: "empty" } as
    | ({ type: string } & Record<string, unknown>)
    | null,
  tabContentRenderCount: 0,
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => {
    throw new Error("Tauri runtime unavailable");
  },
}));

vi.mock("~/store/zustand/tabs", () => ({
  uniqueIdfromTab: (tab: { type: string }) => tab.type,
  useTabs: (
    selector: (state: { currentTab: typeof mocks.currentTab }) => unknown,
  ) => selector({ currentTab: mocks.currentTab }),
}));

vi.mock("./tab-content", () => ({
  ClassicMainTabContent: ({ tab }: { tab: { type: string } }) => {
    mocks.tabContentRenderCount += 1;
    return <div data-tab-type={tab.type} data-testid="tab-content" />;
  },
}));

vi.mock("./useShortcuts", () => ({
  useClassicMainShortcuts: () => ({ runEscapeShortcut: vi.fn() }),
}));

vi.mock("./view-navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./view-navigation")>();
  return {
    ...actual,
    ViewNavigationLayout: ({
      tab,
      children,
    }: {
      tab: { type: string };
      children: React.ReactNode;
    }) =>
      actual.hasViewNavigation(
        tab as Parameters<typeof actual.hasViewNavigation>[0],
      ) ? (
        <div data-testid="view-navigation-layout">{children}</div>
      ) : (
        <>{children}</>
      ),
  };
});

import { ClassicMainBody } from "./body";

describe("ClassicMainBody", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    mocks.currentTab = { type: "empty" };
    mocks.tabContentRenderCount = 0;
  });

  it("démarre sans casser malgré un état persisté de l'ancienne barre latérale", () => {
    // Clés laissées par react-resizable-panels avant le lot 3.
    window.localStorage.setItem(
      "react-resizable-panels:classic-main-sidebar",
      JSON.stringify({ "classic-main-content,classic-main-sidebar-left": {} }),
    );

    render(<ClassicMainBody />);

    expect(screen.getByTestId("tab-content").dataset.tabType).toBe("empty");
    expect(screen.queryByTestId("panel-group")).toBeNull();
    expect(document.querySelector("[data-left-sidebar-chrome]")).toBeNull();
    expect(
      document.querySelector("[data-left-sidebar-panel-content]"),
    ).toBeNull();
  });

  it("affiche l'onboarding bord à bord", () => {
    mocks.currentTab = { type: "onboarding" };

    render(<ClassicMainBody />);

    expect(screen.getByTestId("tab-content").dataset.tabType).toBe(
      "onboarding",
    );
    expect(screen.queryByTestId("view-navigation-layout")).toBeNull();
  });

  it("réserve la largeur de la navigation interne des Automatisations", () => {
    mocks.currentTab = { type: "automations" };

    const { container } = render(<ClassicMainBody />);

    expect(screen.getByTestId("view-navigation-layout")).toBeTruthy();
    const panel = container.querySelector<HTMLElement>(
      "[data-main-content-panel]",
    );
    expect(panel?.style.minWidth).toBe("min(840px, 100%)");
  });

  it("réserve la largeur minimale de la surface de note", () => {
    mocks.currentTab = { type: "sessions", id: "s1" };

    const { container } = render(<ClassicMainBody />);

    const panel = container.querySelector<HTMLElement>(
      "[data-main-content-panel]",
    );
    expect(panel?.style.minWidth).toBe("min(500px, 100%)");
  });
});
