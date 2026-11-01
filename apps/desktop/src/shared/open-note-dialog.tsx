import { Trans, useLingui } from "@lingui/react/macro";
import { Command as CommandPrimitive } from "cmdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { create } from "zustand";

import {
  FileText,
  Folder,
  Gear,
  NotePencil,
  Lock,
  MagnifyingGlass,
  Users,
  X,
  type Icon,
} from "@syntheo/ui/components/icons";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@syntheo/ui/components/ui/dialog";
import { cn } from "@syntheo/utils";

import { useBillingAccess } from "~/billing/billing-context";
import { useFolderSelection } from "~/folders/selection";
import { useFolderPaths, useSessionSummaries } from "~/session/queries";
import { useMainContentCenterOffset } from "~/shared/main/content-offset";
import { useNewNote } from "~/shared/useNewNote";
import { useSettingsNavGroups } from "~/sidebar/settings-nav-groups";
import { type TabInput, useTabs } from "~/store/zustand/tabs";

const MAX_RECENT_DISPLAY = 5;

const PALETTE_ITEM_CLASS = cn([
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2",
  "text-muted-foreground text-sm",
  "data-[selected=true]:bg-accent data-[selected=true]:text-foreground",
  "transition-colors",
]);

interface OpenNoteDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mainContentCenterOffset?: number;
}

type OpenNoteDialogApi = {
  open: () => void;
};

type NoteResult = {
  resourceType: "session" | "shared_session";
  id: string;
  title: string;
  createdAt: string;
};

type PageResult = {
  id: string;
  label: string;
  hint: string | null;
  groupLabel: string;
  icon: Icon;
  requiresPro: boolean;
  destination: TabInput;
  folderPath?: string;
};

function folderLabel(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function filterPageResults(
  query: string,
  pageResults: PageResult[],
  topLevelPageIds: Set<string>,
): PageResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return pageResults.filter((page) => topLevelPageIds.has(page.id));
  }
  return pageResults.filter(
    (page) =>
      page.label.toLowerCase().includes(normalizedQuery) ||
      page.groupLabel.toLowerCase().includes(normalizedQuery) ||
      (page.hint?.toLowerCase().includes(normalizedQuery) ?? false),
  );
}

function filterByTitle<T extends { title: string }>(
  items: T[],
  query: string,
): T[] {
  if (!query.trim()) return items;
  const lowerQuery = query.toLowerCase();
  return items.filter((item) => item.title.toLowerCase().includes(lowerQuery));
}

function compareByCreatedAtDesc(a: NoteResult, b: NoteResult): number {
  if (!a.createdAt || !b.createdAt) return 0;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function toSessionTabInput(note: NoteResult): TabInput {
  return note.resourceType === "shared_session"
    ? { type: "shared_sessions", id: note.id }
    : { type: "sessions", id: note.id };
}

function preventCloseWhenOnDragRegion(event: {
  detail: { originalEvent: { target: EventTarget | null } };
  preventDefault: () => void;
}) {
  const target = event.detail.originalEvent.target;
  if (
    target instanceof Element &&
    target.closest("[data-open-note-dialog-drag-region]")
  ) {
    event.preventDefault();
  }
}

// Palette `Ctrl K` : seul point d'entrée vers l'historique des notes depuis la
// disparition de la barre latérale. Son état vit dans un store pour qu'on
// puisse l'ouvrir de n'importe où (accueil, barre de titre, raccourcis) sans
// dépendre d'un contexte React.
const useOpenNoteDialogStore = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Ouvre la palette de recherche (`Ctrl K`). Stable, utilisable hors React. */
export function openNoteDialog() {
  useOpenNoteDialogStore.getState().setOpen(true);
}

/** Ferme la palette de recherche. */
export function closeNoteDialog() {
  useOpenNoteDialogStore.getState().setOpen(false);
}

/** Indique si la palette est ouverte (lecture réactive). */
export function useIsNoteDialogOpen() {
  return useOpenNoteDialogStore((state) => state.open);
}

const OPEN_NOTE_DIALOG_API: OpenNoteDialogApi = { open: openNoteDialog };

/**
 * API historique : renvoie `{ open }`, une référence stable. Fonctionne aussi
 * hors de `OpenNoteDialogProvider` ; le provider ne fait que monter la palette
 * et le raccourci `Ctrl K`.
 */
export function useOpenNoteDialog(): OpenNoteDialogApi {
  return OPEN_NOTE_DIALOG_API;
}

export function OpenNoteDialogProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const open = useIsNoteDialogOpen();
  const setOpen = useOpenNoteDialogStore((state) => state.setOpen);
  const mainContentCenterOffset = useMainContentCenterOffset();

  useHotkeys("mod+k", openNoteDialog, {
    preventDefault: true,
    enableOnFormTags: true,
    enableOnContentEditable: true,
  });

  return (
    <>
      {children}
      <OpenNoteDialog
        open={open}
        onOpenChange={setOpen}
        mainContentCenterOffset={mainContentCenterOffset}
      />
    </>
  );
}

export function OpenNoteDialog({
  open,
  onOpenChange,
  mainContentCenterOffset = 0,
}: OpenNoteDialogProps) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const openCurrent = useTabs((state) => state.openCurrent);
  const openNew = useTabs((state) => state.openNew);
  const recentlyOpenedSessionIds = useTabs(
    (state) => state.recentlyOpenedSessionIds,
  );
  const { isPro } = useBillingAccess();
  const settingsNavGroups = useSettingsNavGroups();
  const createNewNote = useNewNote();
  const folderPaths = useFolderPaths();

  const sessions = useSessionSummaries();

  const pageResults = useMemo<PageResult[]>(
    () => [
      ...settingsNavGroups.flatMap((group) =>
        group.items.map((item): PageResult => {
          const hasDestination = "destination" in item;

          return {
            id: item.id,
            label: item.label,
            hint: hasDestination ? null : t`Settings`,
            groupLabel: group.label,
            icon: item.icon,
            requiresPro: Boolean(item.requiresPro),
            destination: hasDestination
              ? item.destination
              : { type: "settings", state: { tab: item.id } },
          };
        }),
      ),
      {
        id: "settings",
        label: t`Settings`,
        hint: null,
        groupLabel: t`Go to`,
        icon: Gear,
        requiresPro: false,
        destination: { type: "settings", state: { tab: "app" } },
      },
      // Les dossiers (ex-filtre de la barre latérale) : recherche par nom.
      ...folderPaths.map((path): PageResult => ({
        id: `folder:${path}`,
        label: folderLabel(path),
        hint: path.includes("/") ? path : t`Folder`,
        groupLabel: t`Folders`,
        icon: Folder,
        requiresPro: false,
        destination: { type: "folders" },
        folderPath: path,
      })),
    ],
    [folderPaths, settingsNavGroups, t],
  );

  const topLevelPageIds = new Set([
    "settings",
    ...settingsNavGroups.flatMap((group) =>
      group.items.flatMap((item) => ("destination" in item ? [item.id] : [])),
    ),
  ]);
  const filteredPages = filterPageResults(query, pageResults, topLevelPageIds);

  const sessionsMap = useMemo(() => {
    return new Map<string, NoteResult>(
      sessions.map((session) => [
        session.id,
        {
          resourceType: "session",
          id: session.id,
          title: session.title || t`Untitled`,
          createdAt: session.created_at,
        },
      ]),
    );
  }, [sessions, t]);

  const allNotesSortedByDate = useMemo(
    () => [...sessionsMap.values()].sort(compareByCreatedAtDesc),
    [sessionsMap],
  );

  const recentSessions = useMemo(() => {
    return recentlyOpenedSessionIds
      .slice(0, MAX_RECENT_DISPLAY)
      .map((id) => sessionsMap.get(id))
      .filter((s): s is NoteResult => s !== undefined);
  }, [recentlyOpenedSessionIds, sessionsMap]);

  const recentSessionIdSet = useMemo(() => {
    return new Set(recentSessions.map((s) => s.id));
  }, [recentSessions]);

  const otherNotes = useMemo(() => {
    return allNotesSortedByDate.filter(
      (note) =>
        note.resourceType === "shared_session" ||
        !recentSessionIdSet.has(note.id),
    );
  }, [allNotesSortedByDate, recentSessionIdSet]);

  const filteredRecentSessions = useMemo(
    () => filterByTitle(recentSessions, query),
    [recentSessions, query],
  );

  const filteredOtherNotes = useMemo(
    () => filterByTitle(otherNotes, query),
    [otherNotes, query],
  );

  const newNoteLabel = t`New note`;
  const showNewNote =
    !query.trim() ||
    newNoteLabel.toLowerCase().includes(query.trim().toLowerCase());

  const hasAnyResults =
    showNewNote ||
    filteredPages.length > 0 ||
    filteredRecentSessions.length > 0 ||
    filteredOtherNotes.length > 0;

  useEffect(() => {
    if (!open || !query.trim()) return;
    const timeout = setTimeout(() => {}, 300);
    return () => clearTimeout(timeout);
  }, [
    filteredOtherNotes.length,
    filteredPages.length,
    filteredRecentSessions.length,
    open,
    query,
  ]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setQuery("");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const focusInput = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  const handleSelect = useCallback(
    (note: NoteResult) => {
      handleOpenChange(false);
      openCurrent(toSessionTabInput(note));
    },
    [handleOpenChange, openCurrent, query],
  );

  const handleSelectPage = useCallback(
    (page: PageResult) => {
      handleOpenChange(false);
      if (page.folderPath) {
        useFolderSelection.getState().setSelectedPath(page.folderPath);
      }
      openNew(page.destination);
    },
    [handleOpenChange, openNew, query],
  );

  const handleNewNote = useCallback(() => {
    handleOpenChange(false);
    createNewNote();
  }, [createNewNote, handleOpenChange]);

  const actionGroup = showNewNote && (
    <CommandPrimitive.Group className="pb-1.5">
      <CommandPrimitive.Item
        value="action-new-note"
        onSelect={handleNewNote}
        className={PALETTE_ITEM_CLASS}
      >
        <NotePencil className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="truncate">{newNoteLabel}</span>
        <kbd className="text-muted-foreground ml-auto shrink-0 font-sans text-xs">
          Ctrl N
        </kbd>
      </CommandPrimitive.Item>
    </CommandPrimitive.Group>
  );

  const isQueryEmpty = !query.trim();
  const pageGroupHasPadding =
    filteredOtherNotes.length > 0 ||
    (!isQueryEmpty && filteredRecentSessions.length > 0);
  const pageGroup = filteredPages.length > 0 && (
    <CommandPrimitive.Group
      className={pageGroupHasPadding ? "pb-1.5" : ""}
      heading={
        <div className="flex flex-col gap-3">
          {isQueryEmpty && filteredRecentSessions.length > 0 && (
            <div className="bg-accent mx-2 h-px" />
          )}
          <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium tracking-wider uppercase">
            <Trans>Go to</Trans>
          </div>
        </div>
      }
    >
      {filteredPages.map((page) => (
        <CommandPrimitive.Item
          key={`page-${page.id}`}
          value={`page-${page.id}`}
          onSelect={() => handleSelectPage(page)}
          className={PALETTE_ITEM_CLASS}
        >
          <page.icon className="text-muted-foreground h-4 w-4 shrink-0" />
          <span className="truncate">{page.label}</span>
          {page.hint ? (
            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
              {page.hint}
            </span>
          ) : null}
          {page.requiresPro && !isPro ? (
            <Lock
              aria-label={t`Requires Syntheo Pro`}
              className="h-3.5 w-3.5 shrink-0"
            />
          ) : null}
        </CommandPrimitive.Item>
      ))}
    </CommandPrimitive.Group>
  );

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        overlayClassName="bg-background/40 backdrop-blur-xs"
        overlayChildren={
          <div
            data-open-note-dialog-drag-region
            data-tauri-drag-region
            className="absolute top-0 right-0 left-0 h-[15%]"
          />
        }
        className={cn([
          "top-[15%] w-full max-w-lg -translate-y-0 gap-0 border-0 bg-transparent px-4 py-0 shadow-none sm:rounded-none",
          "data-[state=closed]:animate-none data-[state=open]:animate-none",
          "[&>button:last-child]:hidden",
        ])}
        style={{ marginLeft: mainContentCenterOffset }}
        onPointerDownOutside={preventCloseWhenOnDragRegion}
      >
        <DialogTitle className="sr-only">
          <Trans>Search notes and pages...</Trans>
        </DialogTitle>
        <div
          className={cn([
            "border-border bg-popover text-popover-foreground rounded-2xl border",
            "shadow-capsule overflow-hidden",
          ])}
        >
          <CommandPrimitive shouldFilter={false} className="flex flex-col">
            <div className="border-border/60 flex items-center gap-3 border-b px-4 py-3">
              <MagnifyingGlass className="text-muted-foreground h-4 w-4 shrink-0" />
              <CommandPrimitive.Input
                ref={focusInput}
                value={query}
                onValueChange={setQuery}
                placeholder={t`Search notes and pages...`}
                className={cn([
                  "flex-1 bg-transparent text-sm",
                  "placeholder:text-muted-foreground outline-hidden",
                ])}
              />
              <button
                type="button"
                aria-label={t`Close`}
                onClick={() => handleOpenChange(false)}
                className={cn([
                  "h-5 w-5 rounded-full",
                  "flex items-center justify-center",
                  "bg-accent/80 hover:bg-accent/80",
                  "text-muted-foreground text-xs",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
                  "transition-colors",
                ])}
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            <CommandPrimitive.List className="max-h-80 overflow-y-auto p-2">
              {!hasAnyResults ? (
                <CommandPrimitive.Empty className="text-muted-foreground py-6 text-center text-sm">
                  <Trans>No results found.</Trans>
                </CommandPrimitive.Empty>
              ) : (
                <>
                  {actionGroup}
                  {isQueryEmpty ? null : pageGroup}

                  {filteredRecentSessions.length > 0 && (
                    <CommandPrimitive.Group
                      className={
                        filteredOtherNotes.length > 0 ||
                        (isQueryEmpty && filteredPages.length > 0)
                          ? "pb-1.5"
                          : ""
                      }
                      heading={
                        <div className="flex flex-col gap-3">
                          {!isQueryEmpty && filteredPages.length > 0 && (
                            <div className="bg-accent mx-2 h-px" />
                          )}
                          <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium tracking-wider uppercase">
                            <Trans>Recent</Trans>
                          </div>
                        </div>
                      }
                    >
                      {filteredRecentSessions.map((session) => (
                        <CommandPrimitive.Item
                          key={`recent-${session.id}`}
                          value={`recent-${session.id}`}
                          onSelect={() => handleSelect(session)}
                          className={PALETTE_ITEM_CLASS}
                        >
                          <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                          <span className="truncate">{session.title}</span>
                        </CommandPrimitive.Item>
                      ))}
                    </CommandPrimitive.Group>
                  )}

                  {isQueryEmpty ? pageGroup : null}

                  {filteredOtherNotes.length > 0 && (
                    <CommandPrimitive.Group
                      heading={
                        <div className="flex flex-col gap-3">
                          {(filteredPages.length > 0 ||
                            filteredRecentSessions.length > 0) && (
                            <div className="bg-accent mx-2 h-px" />
                          )}
                          <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium tracking-wider uppercase">
                            <Trans>All Notes</Trans>
                          </div>
                        </div>
                      }
                    >
                      {filteredOtherNotes.map((note) => (
                        <CommandPrimitive.Item
                          key={`${note.resourceType}-${note.id}`}
                          value={`${note.resourceType}-${note.id}`}
                          onSelect={() => handleSelect(note)}
                          className={PALETTE_ITEM_CLASS}
                        >
                          {note.resourceType === "shared_session" ? (
                            <Users
                              className="text-muted-foreground h-4 w-4 shrink-0"
                              data-testid="shared-note-icon"
                            />
                          ) : (
                            <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                          )}
                          <span className="truncate">{note.title}</span>
                        </CommandPrimitive.Item>
                      ))}
                    </CommandPrimitive.Group>
                  )}
                </>
              )}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </div>
      </DialogContent>
    </Dialog>
  );
}
