import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatMode: "FloatingClosed" as
    | "FloatingClosed"
    | "FloatingOpen"
    | "RightPanelOpen",
  currentTab: { type: "empty" } as { type: string } | null,
  persistentChatPanel: vi.fn(),
  sendEvent: vi.fn(),
  sessionProps: { sessionId: "chat-session-1" },
  windowExpandWidth: vi.fn(() => Promise.resolve({ status: "ok", data: null })),
  windowRestoreWidth: vi.fn(() =>
    Promise.resolve({ status: "ok", data: null }),
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@syntheo/plugin-windows", () => ({
  commands: {
    windowExpandWidth: mocks.windowExpandWidth,
    windowRestoreWidth: mocks.windowRestoreWidth,
  },
}));

vi.mock("@syntheo/ui/components/ui/resizable", () => ({
  ResizablePanelGroup: ({
    autoSaveId,
    children,
    "data-main-chat-panel-group": mainChatPanelGroup,
    direction,
  }: {
    autoSaveId?: string;
    children: React.ReactNode;
    "data-main-chat-panel-group"?: boolean;
    direction: string;
  }) => (
    <div
      data-auto-save-id={autoSaveId}
      data-direction={direction}
      data-main-chat-panel-group={mainChatPanelGroup}
      data-testid="panel-group"
    >
      {children}
    </div>
  ),
  ResizablePanel: ({
    children,
    className,
    defaultSize,
    maxSize,
    minSize,
    style,
  }: {
    children: React.ReactNode;
    className?: string;
    defaultSize?: number;
    maxSize?: number;
    minSize?: number;
    style?: React.CSSProperties;
  }) => (
    <div
      data-class-name={className}
      data-default-size={defaultSize}
      data-max-size={maxSize}
      data-min-size={minSize}
      data-min-width={style?.minWidth}
      data-testid="panel"
    >
      {children}
    </div>
  ),
  ResizableHandle: ({ className }: { className?: string }) => (
    <div data-class-name={className} data-testid="resize-handle" />
  ),
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({
    chat: { mode: mocks.chatMode, sendEvent: mocks.sendEvent },
  }),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (
    selector: (state: { currentTab: typeof mocks.currentTab }) => unknown,
  ) => selector({ currentTab: mocks.currentTab }),
}));

vi.mock("~/chat/components/chat-panel", () => ({
  ChatPanelFrame: ({
    layout,
    onOpenFloating,
    sessionProps,
  }: {
    layout?: "floating" | "right-panel";
    onOpenFloating?: () => void;
    sessionProps: unknown;
  }) => (
    <button
      data-has-session={String(sessionProps === mocks.sessionProps)}
      data-layout={layout}
      data-testid="chat-view"
      type="button"
      onClick={onOpenFloating}
    >
      Chat
    </button>
  ),
  ChatSessionHost: ({
    children,
  }: {
    children: (sessionProps: unknown) => React.ReactNode;
  }) => <>{children(mocks.sessionProps)}</>,
}));

vi.mock("~/chat/components/persistent-chat", () => ({
  PersistentChatPanel: ({
    floatingContainerRef,
    sessionProps,
  }: {
    floatingContainerRef: { current: HTMLDivElement | null };
    sessionProps: unknown;
  }) => {
    mocks.persistentChatPanel(floatingContainerRef, sessionProps);
    return <div data-testid="persistent-chat-panel" />;
  },
}));

import { MainChatPanels } from "./chat-panels";

import { ZOOM_STORAGE_KEY } from "~/shared/zoom";

let restorePanelWidths: (() => void) | null = null;

describe("MainChatPanels", () => {
  beforeEach(() => {
    cleanup();
    restorePanelWidths?.();
    restorePanelWidths = null;
    mocks.chatMode = "FloatingClosed";
    mocks.currentTab = { type: "empty" };
    mocks.persistentChatPanel.mockClear();
    mocks.sendEvent.mockClear();
    mocks.windowExpandWidth.mockClear();
    mocks.windowRestoreWidth.mockClear();
    window.localStorage.removeItem(ZOOM_STORAGE_KEY);
  });

  it("renders the main content and persistent floating chat host", () => {
    render(
      <MainChatPanels>
        <div data-testid="main-content" />
      </MainChatPanels>,
    );

    expect(screen.getByTestId("main-content")).toBeTruthy();
    expect(screen.getByTestId("persistent-chat-panel")).toBeTruthy();
    expect(mocks.persistentChatPanel).toHaveBeenCalledTimes(1);
    expect(mocks.persistentChatPanel.mock.calls[0]?.[0].current).toBeInstanceOf(
      HTMLDivElement,
    );
    expect(mocks.persistentChatPanel.mock.calls[0]?.[1]).toBe(
      mocks.sessionProps,
    );
    expect(screen.queryByTestId("resize-handle")).toBeNull();
    expect(screen.getAllByTestId("panel")).toHaveLength(1);
  });

  it("renders the right chat panel when chat is docked", () => {
    mocks.chatMode = "RightPanelOpen";

    render(
      <MainChatPanels>
        <div data-testid="main-content" />
      </MainChatPanels>,
    );

    expect(screen.getAllByTestId("panel")).toHaveLength(2);
    expect(screen.getByTestId("resize-handle")).toBeTruthy();
    expect(screen.getByTestId("chat-view").dataset.layout).toBe("right-panel");
    expect(screen.getByTestId("chat-view").dataset.hasSession).toBe("true");
  });

  it("keeps Automations chat docked without a floating chat host", () => {
    mocks.chatMode = "FloatingOpen";
    mocks.currentTab = { type: "automations" };

    render(
      <MainChatPanels>
        <div data-testid="main-content" />
      </MainChatPanels>,
    );

    expect(screen.getAllByTestId("panel")).toHaveLength(2);
    expect(screen.getByTestId("chat-view").dataset.layout).toBe("right-panel");
    expect(screen.queryByTestId("persistent-chat-panel")).toBeNull();
    expect(mocks.persistentChatPanel).not.toHaveBeenCalled();
  });

  it.each([
    // Paramètres et Automatisations portent leur navigation (240px) dans le corps.
    ["automations", "automations", {}, "840"],
    ["settings", "settings", {}, "min(940px, 100%)"],
    ["sessions", "sessions", {}, "500"],
    ["empty", "empty", {}, "500"],
    ["standalone sessions", "sessions", { noteSurfaceMinWidth: 420 }, "420"],
  ] as const)(
    "reserves the main-body min width for the %s surface",
    (_label, tabType, props, expectedMinWidth) => {
      mocks.currentTab = { type: tabType };

      render(renderPanels(props, <div data-testid="main-content" />));

      expect(screen.getAllByTestId("panel")[0]?.dataset.minWidth).toBe(
        expectedMinWidth,
      );
    },
  );

  it.each([
    {
      name: "a standalone note for docked chat",
      widths: {
        bodyPanelWidth: 420,
        panelGroupWidth: 720,
        rightPanelWidth: 320,
      },
      props: { noteSurfaceMinWidth: 420 },
      expectedArgs: [20, null, false, false, true],
    },
    {
      name: "right for docked chat",
      widths: { bodyPanelWidth: 460, rightPanelWidth: 120 },
      expectedArgs: [240, null, false, false, true],
    },
    {
      name: "right for docked chat at a zoomed scale",
      zoom: "2",
      widths: { bodyPanelWidth: 460, rightPanelWidth: 120 },
      expectedArgs: [480, null, false, false, true],
    },
    {
      name: "right when docked chat is narrower than 320px",
      widths: { bodyPanelWidth: 700, rightPanelWidth: 120 },
      expectedArgs: [200, null, false, false, true],
    },
  ] as const)(
    "expands the window for $name",
    ({ zoom, widths, props, expectedArgs }) => {
      mocks.chatMode = "RightPanelOpen";
      mocks.currentTab = { type: "sessions" };
      if (zoom) {
        window.localStorage.setItem(ZOOM_STORAGE_KEY, zoom);
      }
      mockPanelWidths(widths);

      render(renderPanels(props));

      expect(mocks.windowExpandWidth).toHaveBeenCalledWith(...expectedArgs);
    },
  );

  it("n'élargit pas la fenêtre sans panneau de chat (plus de barre latérale)", () => {
    mocks.currentTab = { type: "sessions" };
    mockPanelWidths({ bodyPanelWidth: 300 });

    render(renderPanels());

    expect(mocks.windowExpandWidth).not.toHaveBeenCalled();
  });

  it("restores window width after docked chat closes", () => {
    mocks.chatMode = "RightPanelOpen";
    mocks.currentTab = { type: "sessions" };
    mockPanelWidths({ bodyPanelWidth: 460, rightPanelWidth: 320 });

    const { rerender } = render(renderPanels());

    expect(mocks.windowExpandWidth).toHaveBeenCalled();
    mocks.windowRestoreWidth.mockClear();

    mocks.chatMode = "FloatingClosed";
    rerender(renderPanels());

    expect(mocks.windowRestoreWidth).toHaveBeenCalledTimes(1);
  });

  it("does not restore window width when leaving a meeting for settings with chat still open", () => {
    mocks.chatMode = "RightPanelOpen";
    mocks.currentTab = { type: "sessions" };
    mockPanelWidths({ bodyPanelWidth: 700, rightPanelWidth: 120 });

    const { rerender } = render(renderPanels());

    expect(mocks.windowExpandWidth).toHaveBeenCalled();
    mocks.windowRestoreWidth.mockClear();

    mocks.currentTab = { type: "settings" };
    rerender(renderPanels());

    expect(mocks.windowRestoreWidth).not.toHaveBeenCalled();
  });
});

function renderPanels(
  props: { noteSurfaceMinWidth?: number } = {},
  children: React.ReactNode = (
    <div data-chat-floating-anchor>
      <div data-session-surface />
    </div>
  ),
) {
  return <MainChatPanels {...props}>{children}</MainChatPanels>;
}

function mockPanelWidths(widths: {
  bodyPanelWidth: number;
  panelGroupWidth?: number;
  rightPanelWidth?: number;
}) {
  restorePanelWidths?.();
  const spy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function getBoundingClientRectMock(this: HTMLElement) {
      if (this.hasAttribute("data-main-body-panel-container")) {
        return rectWithWidth(widths.bodyPanelWidth);
      }

      if (this.hasAttribute("data-main-chat-panel-group")) {
        return rectWithWidth(widths.panelGroupWidth ?? 0);
      }

      if (this.hasAttribute("data-chat-right-panel")) {
        return rectWithWidth(widths.rightPanelWidth ?? 0);
      }

      return rectWithWidth(0);
    });
  restorePanelWidths = () => spy.mockRestore();
}

function rectWithWidth(width: number) {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}
