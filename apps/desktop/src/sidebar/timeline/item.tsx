import { useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import {
  createContext,
  memo,
  type DragEvent,
  type RefCallback,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { commands as fsSyncCommands } from "@syntheo/plugin-fs-sync";
import { commands as openerCommands } from "@syntheo/plugin-opener2";
import {
  FolderSimple,
  Lock,
  LockOpen,
  Square,
  Users,
} from "@syntheo/ui/components/icons";
import { DancingSticks } from "@syntheo/ui/components/ui/dancing-sticks";
import { Spinner } from "@syntheo/ui/components/ui/spinner";
import { cn, format, getYear, safeParseDate, TZDate } from "@syntheo/utils";

import {
  type EventTimelineItem,
  isTimelineItemInFuture,
  type SessionTimelineItem,
  type TimelineItem,
  TimelinePrecision,
} from "./utils";

import { useIgnoredEvents } from "~/calendar/ignored-events";
import { writeSessionContextDragData } from "~/chat/context/session-drag";
import { DEVICE_AUTH_REASON } from "~/lock/auth";
import { isLockedFlag } from "~/lock/flag";
import { revealLockedNote, setSessionLocked } from "~/lock/notes";
import { useAppLock } from "~/lock/store";
import { useDeleteSession } from "~/session/hooks/useDeleteSession";
import { useIsSessionEnhancing } from "~/session/hooks/useEnhancedNotes";
import {
  getOrCreateSessionForEventId,
  preloadSession,
} from "~/session/queries";
import { getSessionEvent } from "~/session/utils";
import { openStandaloneNoteWindow } from "~/session/window";
import { useConfigValue } from "~/shared/config";
import type { MenuItemDef } from "~/shared/hooks/useNativeContextMenu";
import { useTimeFormat } from "~/shared/hooks/useTimeFormat";
import { InteractiveButton } from "~/shared/ui/interactive-button";
import {
  formatSidebarItemTags,
  resolveSidebarItemMeta,
} from "~/sidebar/item-fields";
import { useSidebarNotes } from "~/sidebar/note-filter";
import { useSessionTitle } from "~/store/zustand/live-title";
import { useTabs } from "~/store/zustand/tabs";
import { useTimelineSelection } from "~/store/zustand/timeline-selection";
import { useListener } from "~/stt/contexts";

const EMPTY_TIMELINE_ITEM_KEYS: string[] = [];
const EMPTY_MANAGED_SHARED_SESSION_IDS = new Set<string>();

export const ManagedSharedSessionIdsContext = createContext<
  ReadonlySet<string>
>(EMPTY_MANAGED_SHARED_SESSION_IDS);

type ItemBaseProps = {
  title: string;
  displayTime: string;
  folder?: string;
  tags?: string[];
  isLive?: boolean;
  amplitude?: number;
  showSpinner?: boolean;
  isShared?: boolean;
  isLocked?: boolean;
  isLockRevealed?: boolean;
  selected: boolean;
  ignored?: boolean;
  muted?: boolean;
  multiSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onCmdClick: () => void;
  onShiftClick: () => void;
  onStop?: () => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  contextMenu: MenuItemDef[];
  draggable?: boolean;
  selectedNodeRef?: RefCallback<HTMLDivElement>;
  itemNodeRef?: RefCallback<HTMLDivElement>;
  timelineSessionId?: string;
  isUpcoming?: boolean;
  upcomingLabel?: string;
  upcomingProgress?: number;
  onPreload?: () => void;
};

export const TimelineItemComponent = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    flatItemKeys,
    getFlatItemKeys,
    selectedNodeRef,
    itemNodeRef,
    isUpcoming,
    upcomingLabel,
    upcomingProgress,
  }: {
    item: TimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    flatItemKeys?: string[];
    getFlatItemKeys?: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
    itemNodeRef?: RefCallback<HTMLDivElement>;
    isUpcoming?: boolean;
    upcomingLabel?: string;
    upcomingProgress?: number;
  }) => {
    const readFlatItemKeys =
      getFlatItemKeys ?? (() => flatItemKeys ?? EMPTY_TIMELINE_ITEM_KEYS);

    if (item.type === "event") {
      return (
        <EventItem
          item={item}
          precision={precision}
          selected={selected}
          timezone={timezone}
          multiSelected={multiSelected}
          getFlatItemKeys={readFlatItemKeys}
          selectedNodeRef={selectedNodeRef}
          itemNodeRef={itemNodeRef}
          isUpcoming={isUpcoming}
          upcomingLabel={upcomingLabel}
          upcomingProgress={upcomingProgress}
        />
      );
    }
    return (
      <SessionItem
        item={item}
        precision={precision}
        selected={selected}
        timezone={timezone}
        multiSelected={multiSelected}
        getFlatItemKeys={readFlatItemKeys}
        selectedNodeRef={selectedNodeRef}
        itemNodeRef={itemNodeRef}
        isUpcoming={isUpcoming}
        upcomingLabel={upcomingLabel}
        upcomingProgress={upcomingProgress}
      />
    );
  },
);

function guardedHandler<T>(
  blocked: boolean | undefined,
  handler: T | undefined,
): T | undefined {
  return blocked ? undefined : handler;
}

function containIntrinsicSizeClass(extraRows: number): string {
  if (extraRows === 2) {
    return "[contain-intrinsic-size:auto_88px]";
  }
  if (extraRows === 1) {
    return "[contain-intrinsic-size:auto_72px]";
  }
  return "[contain-intrinsic-size:auto_56px]";
}

function mutedTextClass(isLive: boolean | undefined): string {
  return isLive ? "text-destructive-foreground/65" : "text-muted-foreground";
}

function resolveUpcomingGaugePercent(
  upcomingProgress: number | undefined,
): number {
  if (typeof upcomingProgress !== "number") {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(upcomingProgress, 1)) * 100);
}

function itemBaseClassNames(args: {
  ignored?: boolean;
  isLive?: boolean;
  isUpcoming?: boolean;
  multiSelected: boolean;
  muted?: boolean;
  selected: boolean;
  showLiveStop: boolean;
  showUpcomingGauge: boolean;
}) {
  const {
    ignored,
    isLive,
    isUpcoming,
    multiSelected,
    muted,
    selected,
    showLiveStop,
    showUpcomingGauge,
  } = args;
  return [
    "w-full rounded-lg px-3 py-2 text-left",
    showUpcomingGauge && "pl-4",
    showLiveStop && "pr-10",
    ignored ? "cursor-default" : "cursor-pointer",
    multiSelected && "bg-accent",
    !multiSelected && selected && "bg-accent",
    !multiSelected && !selected && "hover:bg-accent/50",
    isUpcoming &&
      !isLive && [
        "bg-destructive/8 text-foreground",
        "focus-visible:ring-destructive/25",
      ],
    isLive && [
      "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      "focus-visible:ring-destructive/40 focus-visible:ring-2 focus-visible:outline-hidden",
    ],
    ignored && "opacity-40",
    !ignored && muted && !isLive && !isUpcoming && "opacity-65",
  ];
}

function LockIndicator({
  revealed,
  revealedLabel,
  lockedLabel,
}: {
  revealed?: boolean;
  revealedLabel: string;
  lockedLabel: string;
}) {
  if (!revealed) {
    return (
      <Lock
        aria-label={lockedLabel}
        className="text-muted-foreground size-3.5 shrink-0"
      />
    );
  }
  return (
    <LockOpen
      aria-label={revealedLabel}
      className="text-muted-foreground size-3.5 shrink-0"
    />
  );
}

function StatusIndicator({
  showSpinner,
  isShared,
  sharedLabel,
}: {
  showSpinner?: boolean;
  isShared?: boolean;
  sharedLabel: string;
}) {
  if (showSpinner) {
    return (
      <Spinner
        size={14}
        aria-hidden
        className="text-muted-foreground shrink-0"
      />
    );
  }
  if (isShared) {
    return (
      <Users
        aria-label={sharedLabel}
        className="text-muted-foreground size-3.5 shrink-0"
      />
    );
  }
  return null;
}

const ItemBase = memo(function ItemBase({
  title,
  displayTime,
  folder,
  tags,
  isLive,
  amplitude = 0.25,
  showSpinner,
  isShared,
  isLocked,
  isLockRevealed,
  selected,
  ignored,
  muted,
  multiSelected,
  onClick,
  onDoubleClick,
  onCmdClick,
  onShiftClick,
  onStop,
  onDragStart,
  contextMenu,
  draggable,
  selectedNodeRef,
  itemNodeRef,
  timelineSessionId,
  isUpcoming,
  upcomingLabel,
  upcomingProgress,
  onPreload,
}: ItemBaseProps) {
  const { t } = useLingui();
  const hasSelection = useTimelineSelection((s) => s.selectedIds.length > 0);
  const showLiveStop = isLive && onStop;
  const showUpcomingGauge =
    typeof upcomingProgress === "number" &&
    Boolean(isUpcoming) &&
    !isLive &&
    !showSpinner;
  const upcomingGaugePercent = resolveUpcomingGaugePercent(upcomingProgress);
  const folderLabel = folder ?? "";
  const tagLine = formatSidebarItemTags(tags ?? []);
  const extraRows = Number(Boolean(folderLabel)) + Number(Boolean(tagLine));
  const setItemRef = useCallback(
    (node: HTMLDivElement | null) => {
      selectedNodeRef?.(node);
      itemNodeRef?.(node);
    },
    [selectedNodeRef, itemNodeRef],
  );

  return (
    <div
      ref={setItemRef}
      data-sidebar-timeline-session-id={timelineSessionId}
      data-upcoming-label={upcomingLabel}
      onFocus={onPreload}
      onPointerDown={onPreload}
      className={cn([
        "group/sidebar-live-item relative [content-visibility:auto]",
        containIntrinsicSizeClass(extraRows),
      ])}
    >
      <InteractiveButton
        onClick={guardedHandler(ignored, onClick)}
        onDoubleClick={guardedHandler(ignored, onDoubleClick)}
        onCmdClick={guardedHandler(ignored, onCmdClick)}
        onShiftClick={guardedHandler(ignored, onShiftClick)}
        onDragStart={onDragStart}
        contextMenu={guardedHandler(hasSelection, contextMenu)}
        className={cn(
          itemBaseClassNames({
            ignored,
            isLive,
            isUpcoming,
            multiSelected,
            muted,
            selected,
            showLiveStop: Boolean(showLiveStop),
            showUpcomingGauge,
          }),
        )}
        draggable={draggable}
      >
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {folderLabel ? (
              <div
                className={cn([
                  "pointer-events-none flex min-w-0 items-center gap-1 text-[11px] leading-4",
                  mutedTextClass(isLive),
                ])}
              >
                <FolderSimple className="size-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{folderLabel}</span>
              </div>
            ) : null}
            <div
              className={cn(
                "pointer-events-none min-w-0 truncate text-sm font-normal",
                ignored && "line-through",
              )}
            >
              {title || t`Untitled`}
            </div>
            {displayTime && (
              <div
                className={cn(["font-mono text-xs", mutedTextClass(isLive)])}
              >
                {displayTime}
              </div>
            )}
            {tagLine ? (
              <div
                className={cn([
                  "pointer-events-none min-w-0 truncate text-[11px] leading-4",
                  mutedTextClass(isLive),
                ])}
              >
                {tagLine}
              </div>
            ) : null}
          </div>
          {isLocked ? (
            <LockIndicator
              revealed={isLockRevealed}
              revealedLabel={t`Unlock Note`}
              lockedLabel={t`Locked note`}
            />
          ) : null}
          <StatusIndicator
            showSpinner={showSpinner}
            isShared={isShared}
            sharedLabel={t`Shared note`}
          />
        </div>
      </InteractiveButton>
      {showUpcomingGauge ? (
        <div
          aria-hidden
          data-sidebar-timeline-upcoming-gauge
          className="bg-destructive/20 pointer-events-none absolute top-2 bottom-2 left-1.5 w-0.5 overflow-hidden rounded-full"
        >
          <div
            data-sidebar-timeline-upcoming-gauge-fill
            className="bg-destructive absolute bottom-0 left-0 w-full rounded-full transition-[height] duration-300 ease-linear"
            style={{ height: `${upcomingGaugePercent}%` }}
          />
        </div>
      ) : null}
      {showLiveStop ? (
        <button
          type="button"
          aria-label={t`Stop listening`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStop();
          }}
          className={cn([
            "absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm",
            "text-white/80 transition-colors hover:bg-white/15 hover:text-white",
            "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-hidden",
          ])}
        >
          <span
            aria-hidden
            className="flex items-center justify-center group-hover/sidebar-live-item:hidden"
          >
            <DancingSticks
              amplitude={amplitude}
              color="currentColor"
              height={14}
              width={13}
              stickWidth={2}
              gap={2}
            />
          </span>
          <span
            aria-hidden
            className="hidden items-center justify-center group-hover/sidebar-live-item:flex"
          >
            <Square size={10} />
          </span>
        </button>
      ) : null}
    </div>
  );
}, itemBasePropsAreEqual);

function itemBasePropsAreEqual(prev: ItemBaseProps, next: ItemBaseProps) {
  return (
    prev.title === next.title &&
    prev.displayTime === next.displayTime &&
    prev.folder === next.folder &&
    (prev.tags ?? []).join("\u001f") === (next.tags ?? []).join("\u001f") &&
    prev.isLive === next.isLive &&
    prev.amplitude === next.amplitude &&
    prev.showSpinner === next.showSpinner &&
    prev.isShared === next.isShared &&
    prev.isLocked === next.isLocked &&
    prev.isLockRevealed === next.isLockRevealed &&
    prev.selected === next.selected &&
    prev.ignored === next.ignored &&
    prev.muted === next.muted &&
    prev.multiSelected === next.multiSelected &&
    prev.onClick === next.onClick &&
    prev.onDoubleClick === next.onDoubleClick &&
    prev.onCmdClick === next.onCmdClick &&
    prev.onShiftClick === next.onShiftClick &&
    prev.onStop === next.onStop &&
    prev.onDragStart === next.onDragStart &&
    prev.contextMenu === next.contextMenu &&
    prev.draggable === next.draggable &&
    prev.selectedNodeRef === next.selectedNodeRef &&
    prev.itemNodeRef === next.itemNodeRef &&
    prev.timelineSessionId === next.timelineSessionId &&
    prev.isUpcoming === next.isUpcoming &&
    prev.upcomingLabel === next.upcomingLabel &&
    prev.upcomingProgress === next.upcomingProgress &&
    prev.onPreload === next.onPreload
  );
}

const EventItem = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    getFlatItemKeys,
    selectedNodeRef,
    itemNodeRef,
    isUpcoming,
    upcomingLabel,
    upcomingProgress,
  }: {
    item: EventTimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    getFlatItemKeys: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
    itemNodeRef?: RefCallback<HTMLDivElement>;
    isUpcoming?: boolean;
    upcomingLabel?: string;
    upcomingProgress?: number;
  }) => {
    const { t } = useLingui();
    const openCurrent = useTabs((state) => state.openCurrent);

    const eventId = item.id;
    const trackingIdEvent = item.data.tracking_id_event;
    const title = item.data.title || t`Untitled`;
    const recurrenceSeriesId = item.data.recurrence_series_id;
    const groupBy = useSidebarNotes((state) => state.groupBy);
    const showFolder = useConfigValue("sidebar_show_folder");
    const { folder } = resolveSidebarItemMeta({
      folderId: item.data.session_folder,
      showFolder,
      showTags: false,
      groupBy,
    });

    const {
      isIgnored,
      ignoreEvent,
      unignoreEvent,
      ignoreSeries,
      unignoreSeries,
    } = useIgnoredEvents();

    const ignored = isIgnored(trackingIdEvent, recurrenceSeriesId);

    const timeFormat = useTimeFormat();
    const displayTime = useMemo(
      () =>
        formatDisplayTime(
          item.data.started_at,
          precision,
          timezone,
          timeFormat,
        ),
      [item.data.started_at, precision, timezone, timeFormat],
    );

    const [isOpening, setIsOpening] = useState(false);
    const openEvent = useCallback(() => {
      if (!eventId || isOpening) return;
      setIsOpening(true);
      void getOrCreateSessionForEventId(eventId, title)
        .then((sessionId) => {
          openCurrent({ id: sessionId, type: "sessions" });
        })
        .catch((error) => {
          console.error("[timeline] failed to open event note", error);
        })
        .finally(() => {
          setIsOpening(false);
        });
    }, [eventId, title, openCurrent, isOpening]);

    const itemKey = `event-${item.id}`;
    const muted = isTimelineItemInFuture(item);

    const handleClick = useCallback(() => {
      useTimelineSelection.getState().setAnchor(itemKey);
      openEvent();
    }, [openEvent, itemKey]);

    const handleCmdClick = useCallback(() => {
      useTimelineSelection.getState().toggleSelect(itemKey);
    }, [itemKey]);

    const handleShiftClick = useCallback(() => {
      useTimelineSelection.getState().selectRange(getFlatItemKeys(), itemKey);
    }, [getFlatItemKeys, itemKey]);

    const handleIgnore = useCallback(() => {
      if (!trackingIdEvent) return;
      ignoreEvent(trackingIdEvent);
    }, [trackingIdEvent, ignoreEvent]);

    const handleUnignore = useCallback(() => {
      if (!trackingIdEvent) return;
      unignoreEvent(trackingIdEvent);
    }, [trackingIdEvent, unignoreEvent]);

    const handleUnignoreSeries = useCallback(() => {
      if (!recurrenceSeriesId) return;
      unignoreSeries(recurrenceSeriesId);
    }, [recurrenceSeriesId, unignoreSeries]);

    const handleIgnoreSeries = useCallback(() => {
      if (!recurrenceSeriesId) return;
      ignoreSeries(recurrenceSeriesId);
    }, [recurrenceSeriesId, ignoreSeries]);

    const contextMenu = useMemo(() => {
      if (ignored) {
        if (recurrenceSeriesId) {
          return [
            {
              id: "unignore",
              text: t`Show This Event`,
              action: handleUnignore,
            },
            {
              id: "unignore-series",
              text: t`Show All Recurring Events`,
              action: handleUnignoreSeries,
            },
          ];
        }
        return [
          { id: "unignore", text: t`Show Event`, action: handleUnignore },
        ];
      }
      const menu: MenuItemDef[] = [
        {
          id: "ignore",
          text: recurrenceSeriesId ? t`Delete This Event` : t`Delete Event`,
          action: handleIgnore,
        },
      ];
      if (recurrenceSeriesId) {
        menu.push({
          id: "ignore-series",
          text: t`Delete All Recurring Events`,
          action: handleIgnoreSeries,
        });
      }
      return menu;
    }, [
      ignored,
      handleIgnore,
      handleUnignore,
      handleUnignoreSeries,
      handleIgnoreSeries,
      recurrenceSeriesId,
      t,
    ]);

    return (
      <ItemBase
        title={title}
        displayTime={displayTime}
        folder={folder}
        showSpinner={isOpening}
        selected={selected}
        ignored={ignored}
        muted={muted}
        multiSelected={multiSelected}
        onClick={handleClick}
        onCmdClick={handleCmdClick}
        onShiftClick={handleShiftClick}
        contextMenu={contextMenu}
        selectedNodeRef={selected ? selectedNodeRef : undefined}
        itemNodeRef={itemNodeRef}
        isUpcoming={isUpcoming}
        upcomingLabel={upcomingLabel}
        upcomingProgress={upcomingProgress}
      />
    );
  },
);

const SessionItem = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    getFlatItemKeys,
    selectedNodeRef,
    itemNodeRef,
    isUpcoming,
    upcomingLabel,
    upcomingProgress,
  }: {
    item: SessionTimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    getFlatItemKeys: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
    itemNodeRef?: RefCallback<HTMLDivElement>;
    isUpcoming?: boolean;
    upcomingLabel?: string;
    upcomingProgress?: number;
  }) => {
    const { t } = useLingui();
    const openCurrent = useTabs((state) => state.openCurrent);
    const deleteSession = useDeleteSession();
    const managedSharedSessionIds = useContext(ManagedSharedSessionIdsContext);

    const sessionId = item.id;
    const title = useSessionTitle(sessionId, item.data.title ?? undefined);
    const groupBy = useSidebarNotes((state) => state.groupBy);
    const showFolder = useConfigValue("sidebar_show_folder");
    const showTags = useConfigValue("sidebar_show_tags");
    const { folder, tags } = resolveSidebarItemMeta({
      folderId: item.data.folder_id,
      tags: item.data.tags,
      showFolder,
      showTags,
      groupBy,
    });
    const noteLocked = isLockedFlag(item.data.locked);
    const noteRevealed = useAppLock((state) =>
      Boolean(state.revealedNoteIds[sessionId]),
    );
    const authAvailable = useAppLock((state) => state.available) === true;

    const { sessionMode, stop, amplitude } = useListener((state) => {
      const sessionMode = state.getSessionMode(sessionId);
      return {
        sessionMode,
        stop: state.stop,
        amplitude: sessionMode === "active" ? state.live.amplitude : null,
      };
    });
    const isEnhancing = useIsSessionEnhancing(sessionId);
    const isLive = sessionMode === "active";
    const isFinalizing = sessionMode === "finalizing";
    const isBatching = sessionMode === "running_batch";
    const [isOpening, setIsOpening] = useState(false);
    const showSpinner =
      !selected &&
      !isLive &&
      (isFinalizing || isEnhancing || isBatching || isOpening);

    const sessionEvent = getSessionEvent(item.data);

    const timeFormat = useTimeFormat();
    const displayTime = useMemo(
      () =>
        formatDisplayTime(
          sessionEvent?.started_at ?? item.data.created_at,
          precision,
          timezone,
          timeFormat,
        ),
      [
        sessionEvent?.started_at,
        item.data.created_at,
        precision,
        timezone,
        timeFormat,
      ],
    );
    const muted = isTimelineItemInFuture(item);

    const itemKey = `session-${item.id}`;

    const handlePreload = useCallback(() => {
      if (!noteLocked) void preloadSession(sessionId).catch(() => {});
    }, [noteLocked, sessionId]);

    const openSession = useCallback(async () => {
      setIsOpening(true);
      try {
        await preloadSession(sessionId);
      } catch (error) {
        console.error("[timeline] failed to preload session", error);
      } finally {
        openCurrent({ id: sessionId, type: "sessions" });
        setIsOpening(false);
      }
    }, [openCurrent, sessionId]);

    const handleClick = useCallback(() => {
      useTimelineSelection.getState().setAnchor(itemKey);
      if (noteLocked) {
        void revealLockedNote(sessionId).then((ok) => {
          if (ok) void openSession();
        });
        return;
      }
      void openSession();
    }, [noteLocked, sessionId, openSession, itemKey]);

    const handleCmdClick = useCallback(() => {
      useTimelineSelection.getState().toggleSelect(itemKey);
    }, [itemKey]);

    const handleShiftClick = useCallback(() => {
      useTimelineSelection.getState().selectRange(getFlatItemKeys(), itemKey);
    }, [getFlatItemKeys, itemKey]);

    const handleOpenStandaloneWindow = useCallback(() => {
      void openStandaloneNoteWindow(sessionId);
    }, [sessionId]);

    const handleDragStart = useCallback(
      (event: DragEvent<HTMLElement>) => {
        writeSessionContextDragData(
          event.dataTransfer,
          sessionId,
          title || t`Untitled`,
        );
      },
      [sessionId, title, t],
    );

    const handleDelete = useCallback(() => {
      deleteSession(sessionId, {
        trackingId: sessionEvent?.tracking_id,
        title,
      });
    }, [deleteSession, sessionId, sessionEvent?.tracking_id, title]);

    const handleToggleLock = useCallback(() => {
      void setSessionLocked(sessionId, !noteLocked);
    }, [noteLocked, sessionId]);

    const handleShowInFolder = useCallback(async () => {
      if (noteLocked) {
        const ok = await useAppLock
          .getState()
          .authenticate(DEVICE_AUTH_REASON.openApp);
        if (!ok) return;
      }
      const result = await fsSyncCommands.sessionDir(sessionId);
      if (result.status === "ok") {
        await openerCommands.openPath(result.data, null);
      }
    }, [noteLocked, sessionId]);

    const contextMenu = useMemo(() => {
      const menu: MenuItemDef[] = [
        {
          id: "open-new-window",
          text: t`Open in New Window`,
          action: handleOpenStandaloneWindow,
        },
        {
          id: "show",
          text: platform() === "macos" ? t`Show in Finder` : t`Show in folder`,
          action: handleShowInFolder,
        },
      ];
      if (authAvailable) {
        menu.push({
          id: noteLocked ? "unlock" : "lock",
          text: noteLocked ? t`Unlock Note` : t`Lock Note`,
          action: handleToggleLock,
        });
      }
      menu.push(
        { separator: true as const },
        {
          id: "delete",
          text: t`Delete Note`,
          action: handleDelete,
        },
      );
      return menu;
    }, [
      authAvailable,
      handleDelete,
      handleOpenStandaloneWindow,
      handleShowInFolder,
      handleToggleLock,
      noteLocked,
      t,
    ]);

    return (
      <ItemBase
        title={title}
        displayTime={displayTime}
        folder={folder}
        tags={tags}
        isLive={isLive}
        amplitude={Math.max(
          0.25,
          Math.min(Math.hypot(amplitude?.mic ?? 0, amplitude?.speaker ?? 0), 1),
        )}
        showSpinner={showSpinner}
        isShared={managedSharedSessionIds.has(sessionId)}
        isLocked={noteLocked}
        isLockRevealed={noteRevealed}
        selected={selected}
        muted={muted}
        multiSelected={multiSelected}
        onClick={handleClick}
        onDoubleClick={handleOpenStandaloneWindow}
        onCmdClick={handleCmdClick}
        onShiftClick={handleShiftClick}
        onStop={stop}
        onDragStart={handleDragStart}
        contextMenu={contextMenu}
        selectedNodeRef={selected ? selectedNodeRef : undefined}
        itemNodeRef={itemNodeRef}
        timelineSessionId={sessionId}
        isUpcoming={isUpcoming}
        upcomingLabel={upcomingLabel}
        upcomingProgress={upcomingProgress}
        onPreload={handlePreload}
        draggable
      />
    );
  },
);

function formatDisplayTime(
  timestamp: string | null | undefined,
  precision: TimelinePrecision,
  timezone: string | undefined,
  timeFormat: string,
): string {
  const parsed = safeParseDate(timestamp);
  if (!parsed) {
    return "";
  }

  const date = timezone ? new TZDate(parsed, timezone) : parsed;
  const time = format(date, timeFormat).toUpperCase();

  if (precision === "time") {
    return time;
  }

  const now = timezone ? new TZDate(new Date(), timezone) : new Date();
  const sameYear = getYear(date) === getYear(now);
  const dateStr = sameYear
    ? format(date, "MMM d")
    : format(date, "MMM d, yyyy");

  return `${dateStr}, ${time}`;
}
