import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useLayoutEffect, useRef } from "react";

import { commands as windowsCommands } from "@syntheo/plugin-windows";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@syntheo/ui/components/ui/resizable";

import {
  AUTOMATIONS_SURFACE_MIN_WIDTH_PX,
  boundedMinWidthPx,
  NOTE_SURFACE_MIN_WIDTH_PX,
  SETTINGS_SURFACE_MIN_WIDTH_PX,
  usesNoteSurfaceMinWidth,
  VIEW_NAVIGATION_WIDTH_PX,
} from "./layout-widths";

import { ChatPanelFrame, ChatSessionHost } from "~/chat/components/chat-panel";
import { PersistentChatPanel } from "~/chat/components/persistent-chat";
import { useShell } from "~/contexts/shell";
import { readZoomFactor } from "~/shared/zoom";
import { type Tab, useTabs } from "~/store/zustand/tabs";

const RIGHT_CHAT_PANEL_MIN_WIDTH_PX = 320;

export function MainChatPanels({
  autoSaveId = "main-chat",
  children,
  noteSurfaceMinWidth = NOTE_SURFACE_MIN_WIDTH_PX,
}: Readonly<{
  autoSaveId?: string;
  children: React.ReactNode;
  noteSurfaceMinWidth?: number;
}>) {
  const { chat } = useShell();
  const currentTab = useTabs((state) => state.currentTab);
  const bodyPanelContainerRef = useRef<HTMLDivElement>(null);
  const isAutomationsTab = currentTab?.type === "automations";
  const isRightPanelOpen = isAutomationsTab || chat.mode === "RightPanelOpen";
  const reserveNoteSurfaceMinWidth = usesNoteSurfaceMinWidth(currentTab);
  const bodyMinWidthPx = getMainBodyMinWidth({
    currentTab,
    noteSurfaceMinWidth,
  });
  const bodyMinWidth =
    currentTab?.type === "settings" && bodyMinWidthPx != null
      ? boundedMinWidthPx(bodyMinWidthPx)
      : bodyMinWidthPx;

  useNoteSurfaceWindowWidthGuard({
    bodyPanelContainerRef,
    enabled: reserveNoteSurfaceMinWidth,
    noteSurfaceMinWidth,
    rightPanelOpen: isRightPanelOpen,
  });

  return (
    <ChatSessionHost>
      {(sessionProps) => (
        <>
          <ResizablePanelGroup
            autoSaveId={autoSaveId}
            data-main-chat-panel-group
            direction="horizontal"
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <ResizablePanel
              className="min-h-0 min-w-0 flex-1 overflow-hidden"
              style={{ minWidth: bodyMinWidth }}
            >
              <div
                ref={bodyPanelContainerRef}
                data-main-body-panel-container
                className="h-full min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                {children}
              </div>
            </ResizablePanel>
            {isRightPanelOpen ? (
              <>
                <ResizableHandle className="w-0" />
                <ResizablePanel
                  defaultSize={30}
                  minSize={20}
                  maxSize={50}
                  className="min-h-0 overflow-hidden"
                  style={{ minWidth: RIGHT_CHAT_PANEL_MIN_WIDTH_PX }}
                >
                  <div
                    data-chat-right-panel
                    className="border-border bg-card -mb-1 h-[calc(100%+0.25rem)] min-h-0 overflow-hidden rounded-tr-xl border-x"
                  >
                    <ChatPanelFrame
                      layout="right-panel"
                      onOpenFloating={() => chat.sendEvent({ type: "OPEN" })}
                      sessionProps={sessionProps}
                    />
                  </div>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>

          {isAutomationsTab ? null : (
            <PersistentChatPanel
              floatingContainerRef={bodyPanelContainerRef}
              sessionProps={sessionProps}
            />
          )}
        </>
      )}
    </ChatSessionHost>
  );
}

function getMainBodyMinWidth({
  currentTab,
  noteSurfaceMinWidth,
}: {
  currentTab: Tab | null;
  noteSurfaceMinWidth: number;
}) {
  if (currentTab?.type === "automations") {
    return AUTOMATIONS_SURFACE_MIN_WIDTH_PX + VIEW_NAVIGATION_WIDTH_PX;
  }

  if (currentTab?.type === "settings") {
    return SETTINGS_SURFACE_MIN_WIDTH_PX + VIEW_NAVIGATION_WIDTH_PX;
  }

  if (!usesNoteSurfaceMinWidth(currentTab)) {
    return undefined;
  }

  return noteSurfaceMinWidth;
}

// Sans barre latérale, seule l'ouverture du panneau de chat à droite peut
// rogner la surface de note : on élargit alors la fenêtre, puis on la rend à
// sa taille à la fermeture du panneau.
function useNoteSurfaceWindowWidthGuard({
  bodyPanelContainerRef,
  enabled,
  noteSurfaceMinWidth,
  rightPanelOpen,
}: {
  bodyPanelContainerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  noteSurfaceMinWidth: number;
  rightPanelOpen: boolean;
}) {
  const restorableExpansionCountRef = useRef(0);
  const previousStateRef = useRef({ enabled: false, rightPanelOpen: false });

  const restoreWidthExpansions = useCallback(() => {
    const restoreCount = restorableExpansionCountRef.current;
    restorableExpansionCountRef.current = 0;

    for (let i = 0; i < restoreCount; i += 1) {
      void windowsCommands.windowRestoreWidth();
    }
  }, []);

  useLayoutEffect(() => {
    const previousState = previousStateRef.current;
    const rightPanelJustClosed =
      previousState.rightPanelOpen && !rightPanelOpen;
    const rightPanelJustOpened =
      rightPanelOpen &&
      (!previousState.enabled || !previousState.rightPanelOpen);
    const hasOpenPanel = enabled && rightPanelOpen;

    previousStateRef.current = { enabled, rightPanelOpen };

    if (rightPanelJustClosed || (enabled && !hasOpenPanel)) {
      restoreWidthExpansions();
    }

    if (!hasOpenPanel || !rightPanelJustOpened) {
      return;
    }

    const bodyPanel = bodyPanelContainerRef.current;
    if (!bodyPanel) {
      return;
    }

    const bodyWidth = getVisibleBodyWidth(bodyPanel);
    if (bodyWidth <= 0 || !isTauri()) {
      return;
    }

    expandWindowForRightPanel({
      bodyWidth,
      noteSurfaceMinWidth,
      onRestoreScheduled: () => {
        restorableExpansionCountRef.current += 1;
      },
      rightPanelWidth: getRightPanelWidth(bodyPanel, rightPanelOpen),
    });
  }, [
    bodyPanelContainerRef,
    enabled,
    noteSurfaceMinWidth,
    restoreWidthExpansions,
    rightPanelOpen,
  ]);

  useLayoutEffect(() => restoreWidthExpansions, [restoreWidthExpansions]);
}

function expandWindowForRightPanel({
  bodyWidth,
  noteSurfaceMinWidth,
  onRestoreScheduled,
  rightPanelWidth,
}: {
  bodyWidth: number;
  noteSurfaceMinWidth: number;
  onRestoreScheduled: () => void;
  rightPanelWidth: number;
}) {
  const requiredTotalWidth =
    noteSurfaceMinWidth + RIGHT_CHAT_PANEL_MIN_WIDTH_PX;
  const visibleTotalWidth = bodyWidth + rightPanelWidth;
  const widthDeficit = Math.ceil(
    Math.max(
      noteSurfaceMinWidth - bodyWidth,
      requiredTotalWidth - visibleTotalWidth,
      RIGHT_CHAT_PANEL_MIN_WIDTH_PX - rightPanelWidth,
    ),
  );

  if (widthDeficit <= 0) {
    return;
  }

  onRestoreScheduled();

  void windowsCommands.windowExpandWidth(
    Math.ceil(widthDeficit * readZoomFactor()),
    null,
    false,
    false,
    true,
  );
}

function getRightPanelWidth(bodyPanel: HTMLElement, rightPanelOpen: boolean) {
  if (!rightPanelOpen) {
    return 0;
  }

  const rightPanel = bodyPanel.ownerDocument.querySelector<HTMLElement>(
    "[data-chat-right-panel]",
  );

  return rightPanel?.getBoundingClientRect().width ?? 0;
}

function getVisibleBodyWidth(bodyPanel: HTMLElement) {
  const bodyWidth = bodyPanel.getBoundingClientRect().width;
  const widthContainer =
    bodyPanel.closest<HTMLElement>("[data-main-chat-panel-group]") ??
    bodyPanel.closest<HTMLElement>("[data-testid='main-app-shell']");
  if (!widthContainer) {
    return bodyWidth;
  }

  const containerWidth = widthContainer.getBoundingClientRect().width;
  if (containerWidth <= 0) {
    return bodyWidth;
  }

  const rightPanel = widthContainer.querySelector<HTMLElement>(
    "[data-chat-right-panel]",
  );
  const rightPanelWidth = rightPanel?.getBoundingClientRect().width ?? 0;
  const visibleContainerBodyWidth = Math.max(
    0,
    containerWidth - rightPanelWidth,
  );

  if (bodyWidth <= 0) {
    return visibleContainerBodyWidth;
  }

  return Math.min(bodyWidth, visibleContainerBodyWidth);
}
