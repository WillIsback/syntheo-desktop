import { t } from "@lingui/core/macro";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useRef } from "react";

import { commands as openerCommands } from "@syntheo/plugin-opener2";
import { ArrowLeft } from "@syntheo/ui/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@syntheo/ui/components/ui/dropdown-menu";
import { cn } from "@syntheo/utils";

import { hasViewNavigation } from "./view-navigation";
import { WindowsWindowControls } from "./windows-window-controls";

import { openNoteDialog } from "~/shared/open-note-dialog";
import { useNewNote } from "~/shared/useNewNote";
import {
  TITLE_BAR_SIDEBAR_ACTIONS_SLOT_ID,
  useCustomSidebarBack,
} from "~/sidebar/custom-sidebar-header";
import { useTabs } from "~/store/zustand/tabs";

const appWindow = getCurrentWindow();

// Barre de titre Windows / Linux : barre de menus (Fichier, Modifier, Afficher,
// Aide), zone de déplacement de la fenêtre et contrôles natifs. Il n'y a plus
// de barre latérale à afficher ou masquer.
export function WindowsTitleBar() {
  const currentTab = useTabs((state) => state.currentTab);
  const openNew = useTabs((state) => state.openNew);
  const createNewNote = useNewNote();
  const goBack = useCustomSidebarBack();
  const showBackButton = hasViewNavigation(currentTab);
  const editTargetRef = useRef<HTMLElement | null>(null);

  const rememberEditTarget = useCallback(() => {
    editTargetRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, []);
  const runEditCommand = useCallback((command: string) => {
    const editTarget = editTargetRef.current;
    if (editTarget?.isConnected) {
      editTarget.focus();
    }

    document.execCommand(command);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    const isFullscreen = await appWindow.isFullscreen();
    await appWindow.setFullscreen(!isFullscreen);
  }, []);
  return (
    <header
      data-tauri-drag-region
      data-testid="windows-title-bar"
      className="bg-background flex h-10 shrink-0 items-stretch"
    >
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center pl-2"
      >
        {showBackButton ? (
          <>
            <TitleBarIconButton ariaLabel={t`Go home`} onClick={goBack}>
              <ArrowLeft size={16} />
            </TitleBarIconButton>
            <div
              id={TITLE_BAR_SIDEBAR_ACTIONS_SLOT_ID}
              data-tauri-drag-region="false"
              className="flex items-center"
            />
          </>
        ) : null}
        <nav
          aria-label={t`Application menu`}
          className="ml-2 flex h-full items-center"
          role="menubar"
        >
          <TitleBarMenu label={t`File`} onPointerDown={rememberEditTarget}>
            <DropdownMenuItem onSelect={createNewNote}>
              {t`New Note`}
              <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openNoteDialog}>
              {t`Search Notes…`}
              <DropdownMenuShortcut>Ctrl+K</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                openNew({ type: "settings", state: { tab: "app" } })
              }
            >
              {t`Settings`}
              <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void appWindow.close()}>
              {t`Close`}
              <DropdownMenuShortcut>Alt+F4</DropdownMenuShortcut>
            </DropdownMenuItem>
          </TitleBarMenu>
          <TitleBarMenu label={t`Edit`} onPointerDown={rememberEditTarget}>
            <DropdownMenuItem onSelect={() => runEditCommand("undo")}>
              {t`Undo`}
              <DropdownMenuShortcut>Ctrl+Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runEditCommand("redo")}>
              {t`Redo`}
              <DropdownMenuShortcut>Ctrl+Y</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => runEditCommand("cut")}>
              {t`Cut`}
              <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runEditCommand("copy")}>
              {t`Copy`}
              <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runEditCommand("paste")}>
              {t`Paste`}
              <DropdownMenuShortcut>Ctrl+V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runEditCommand("selectAll")}>
              {t`Select All`}
              <DropdownMenuShortcut>Ctrl+A</DropdownMenuShortcut>
            </DropdownMenuItem>
          </TitleBarMenu>
          <TitleBarMenu label={t`View`} onPointerDown={rememberEditTarget}>
            <DropdownMenuItem onSelect={() => void toggleFullscreen()}>
              {t`Full Screen`}
              <DropdownMenuShortcut>F11</DropdownMenuShortcut>
            </DropdownMenuItem>
          </TitleBarMenu>
          <TitleBarMenu label={t`Help`} onPointerDown={rememberEditTarget}>
            <DropdownMenuItem
              onSelect={() =>
                void openerCommands.openUrl(
                  "https://github.com/WillIsback/syntheo-desktop#readme",
                  null,
                )
              }
            >
              {t`Documentation`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                void openerCommands.openUrl(
                  "https://github.com/WillIsback/syntheo-desktop/issues",
                  null,
                )
              }
            >
              {t`Report a Bug`}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void openerCommands.openUrl(
                  "https://github.com/WillIsback/syntheo-desktop/issues",
                  null,
                )
              }
            >
              {t`Suggest a Feature`}
            </DropdownMenuItem>
          </TitleBarMenu>
        </nav>
        <div data-tauri-drag-region className="min-w-4 flex-1" />
      </div>
      <WindowsWindowControls />
    </header>
  );
}

function TitleBarMenu({
  children,
  label,
  onPointerDown,
}: {
  children: React.ReactNode;
  label: string;
  onPointerDown: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-tauri-drag-region="false"
          role="menuitem"
          className={cn([
            "text-muted-foreground h-7 rounded-md px-2.5 text-sm",
            "hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
          ])}
          onPointerDown={onPointerDown}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={1}
        className="w-56 rounded-lg"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TitleBarIconButton({
  ariaLabel,
  children,
  onClick,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      data-tauri-drag-region="false"
      className={cn([
        "relative flex size-7 items-center justify-center rounded-full",
        "text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
      ])}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
