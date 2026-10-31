import { Outlet, useNavigate } from "@tanstack/react-router";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { events as windowsEvents } from "@syntheo/plugin-windows";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";

import {
  openNewNoteAndListen,
  openSessionAndListen,
  useNewNote,
} from "./useNewNote";

import { LocalBillingProvider } from "~/billing/local-billing";
import { useFolderSelection } from "~/folders/selection";
import { getOrCreateSessionForEventId } from "~/session/queries";
import { openFoldersFromNavigation } from "~/shared/folders-navigation";
import { useZoomShortcuts } from "~/shared/zoom";
import { UndoDeleteToast } from "~/sidebar/toast/undo-delete-toast";
import { isTabInputSupported, useTabs } from "~/store/zustand/tabs";

export default function MainAppLayout() {
  useNavigationEvents();
  useZoomShortcuts();

  return (
    <LocalBillingProvider>
      <MainAppContent />
    </LocalBillingProvider>
  );
}

function MainAppContent() {
  return (
    <>
      <Outlet />
      <UndoDeleteToast />
    </>
  );
}

const useNavigationEvents = () => {
  const navigate = useNavigate();
  const openNew = useTabs((state) => state.openNew);
  const openNewNote = useNewNote({ behavior: "new" });

  useMountEffect(() => {
    const navigateFromNative = (path: string) => {
      const match = path.match(/^\/app\/([^/]+)\/(.+)$/);
      if (!match) return;
      const [, type, id] = match;
      if (type === "session") {
        openNew({ type: "sessions", id });
      } else if (type === "human") {
        openNew({
          type: "contacts",
          state: { selected: { type: "person", id } },
        });
      } else if (type === "organization") {
        openNew({
          type: "contacts",
          state: { selected: { type: "organization", id } },
        });
      } else if (type === "folder") {
        // Sans barre latérale, un dossier s'ouvre dans sa propre vue.
        useFolderSelection.getState().setSelectedPath(id);
        openNew({ type: "folders" });
      }
    };
    (window as any).__SYNTHEO_NAVIGATE__ = navigateFromNative;

    let unlistenNavigate: (() => void) | undefined;
    let unlistenOpenTab: (() => void) | undefined;
    let cancelled = false;

    const webview = getCurrentWebviewWindow();

    void windowsEvents
      .navigate(webview)
      .listen(({ payload }) => {
        if (payload.path === "/app/new") {
          const calendarEventId = payload.search?.calendarEventId;
          const shouldRecord = payload.search?.record === "true";

          if (typeof calendarEventId === "string" && calendarEventId) {
            void getOrCreateSessionForEventId(calendarEventId)
              .then((sessionId) => {
                if (shouldRecord) {
                  openSessionAndListen(sessionId, { behavior: "new" });
                  return;
                }

                openNew({
                  type: "sessions",
                  id: sessionId,
                  state: {
                    view: null,
                    autoStart: null,
                    scheduledAutoStart: null,
                  },
                });
              })
              .catch((error) => {
                console.error(
                  "[navigation] failed to open calendar event",
                  error,
                );
              });
          } else if (shouldRecord) {
            openNewNoteAndListen({ behavior: "new" });
          } else {
            openNewNote();
          }
        } else if (payload.path === "/app/settings") {
          const tab = (payload.search?.tab as string) ?? "app";
          openNew({ type: "settings", state: { tab } });
        } else if (!openFoldersFromNavigation(payload, openNew)) {
          void navigate({
            to: payload.path,
            search: payload.search ?? undefined,
          });
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlistenNavigate = fn;
        }
      });

    void windowsEvents
      .openTab(webview)
      .listen(({ payload }) => {
        if (payload.tab.type === "sessions" && payload.tab.id === "new") {
          openNewNote();
        } else if (!isTabInputSupported(payload.tab)) {
          return;
        } else {
          openNew(payload.tab);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlistenOpenTab = fn;
        }
      });

    return () => {
      cancelled = true;
      if ((window as any).__SYNTHEO_NAVIGATE__ === navigateFromNative) {
        delete (window as any).__SYNTHEO_NAVIGATE__;
      }
      unlistenNavigate?.();
      unlistenOpenTab?.();
    };
  });
};

// Renders nothing; keeps the local workspace mirror fresh so sharing scopes are
// available without visiting Team settings.
