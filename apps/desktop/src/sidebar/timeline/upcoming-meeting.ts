import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  buildTimelineBuckets,
  deriveTimelineWindowData,
  getItemTimeRange,
  type TimelineBucket,
  type TimelineItem,
} from "./utils";

import { useIgnoredEvents } from "~/calendar/ignored-events";
import { useTimelineTables } from "~/calendar/queries";
import { useConfigValue } from "~/shared/config";
import { useCurrentDay } from "~/shared/hooks/useCurrentDay";

const UPCOMING_MEETING_VISIBLE_WINDOW_MS = 5 * 60 * 1000;
const UPCOMING_MEETING_STATUS_TICK_MS = 1_000;

export type SidebarUpcomingMeetingStatus = {
  itemKey: string;
  label: string;
  title: string;
  progress?: number;
};

export function useSidebarUpcomingMeetingStatus({
  showIgnored = false,
}: {
  showIgnored?: boolean;
} = {}): SidebarUpcomingMeetingStatus | null {
  const timezone = useConfigValue("timezone") || undefined;
  const { t } = useLingui();
  const { isIgnored } = useIgnoredEvents();
  const formatLabel = useUpcomingMeetingLabelFormatter();
  const { timelineEventsTable, timelineSessionsTable } = useTimelineTables();
  const currentDay = useCurrentDay(timezone);

  const buckets = useMemo(() => {
    const windowData = deriveTimelineWindowData({
      isEventIgnored: isIgnored,
      showIgnored,
      timelineEventsTable,
      timelineSessionsTable,
      timezone,
    });

    return buildTimelineBuckets({
      timelineEventsTable: windowData.timelineEventsTable,
      timelineSessionsTable: windowData.timelineSessionsTable,
      timezone,
    });
  }, [
    isIgnored,
    currentDay,
    showIgnored,
    timelineEventsTable,
    timelineSessionsTable,
    timezone,
  ]);

  return useUpcomingMeetingStatus(buckets, formatLabel, t`Now`);
}

export function useUpcomingMeetingStatus(
  buckets: TimelineBucket[],
  formatLabel: (diffMs: number) => string,
  activeLabel: string,
): SidebarUpcomingMeetingStatus | null {
  const store = useMemo(
    () => createUpcomingMeetingStatusStore(buckets, formatLabel, activeLabel),
    [activeLabel, buckets, formatLabel],
  );

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

function createUpcomingMeetingStatusStore(
  buckets: TimelineBucket[],
  formatLabel: (diffMs: number) => string,
  activeLabel: string,
) {
  const getCurrentStatus = () =>
    getUpcomingMeetingStatus(buckets, Date.now(), formatLabel, activeLabel);
  let status = getCurrentStatus();
  const listeners = new Set<() => void>();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const scheduleRefresh = () => {
    clearTimeout(timeout);
    timeout = undefined;
    if (listeners.size === 0 || document.visibilityState === "hidden") {
      return;
    }

    const delayMs = getNextUpcomingMeetingStatusRefreshMs(
      buckets,
      Date.now(),
      status,
    );
    if (delayMs !== null) {
      timeout = setTimeout(refresh, delayMs);
    }
  };

  const refresh = () => {
    const nextStatus = getCurrentStatus();
    if (!upcomingMeetingStatusesAreEqual(status, nextStatus)) {
      status = nextStatus;
      listeners.forEach((listener) => listener());
    }
    scheduleRefresh();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      } else {
        scheduleRefresh();
      }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    refresh();

    return () => {
      listeners.delete(listener);
      scheduleRefresh();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  };

  return {
    getSnapshot: () => status,
    subscribe,
  };
}

function getNextUpcomingMeetingStatusRefreshMs(
  buckets: TimelineBucket[],
  currentTimeMs: number,
  status: SidebarUpcomingMeetingStatus | null,
): number | null {
  if (status?.progress !== undefined && status.progress < 1) {
    const remainder = currentTimeMs % UPCOMING_MEETING_STATUS_TICK_MS;
    return Math.max(1, UPCOMING_MEETING_STATUS_TICK_MS - remainder);
  }

  const nextDeadlineMs = getNextItemDeadlineMs(buckets, currentTimeMs);
  return Number.isFinite(nextDeadlineMs)
    ? Math.max(1, Math.ceil(nextDeadlineMs - currentTimeMs))
    : null;
}

function getNextItemDeadlineMs(
  buckets: TimelineBucket[],
  currentTimeMs: number,
): number {
  let nextDeadlineMs = Number.POSITIVE_INFINITY;

  for (const item of buckets.flatMap((bucket) => bucket.items)) {
    for (const deadlineMs of getItemUpcomingDeadlineMs(item)) {
      if (deadlineMs > currentTimeMs && deadlineMs < nextDeadlineMs) {
        nextDeadlineMs = deadlineMs;
      }
    }
  }

  return nextDeadlineMs;
}

function getItemUpcomingDeadlineMs(item: TimelineItem): number[] {
  if (isAllDayTimelineItem(item)) {
    return [];
  }

  const { start, end } = getItemTimeRange(item);
  const startsAtMs = start?.getTime();
  if (startsAtMs === undefined) {
    return [];
  }

  return [
    startsAtMs - UPCOMING_MEETING_VISIBLE_WINDOW_MS,
    startsAtMs,
    ...(end ? [end.getTime() + 1] : []),
  ];
}

function isAllDayTimelineItem(item: TimelineItem): boolean {
  return item.type === "event" && Boolean(item.data.is_all_day);
}

type UpcomingMeetingCandidate = { itemKey: string; title: string };

type UpcomingMeetingItemTiming =
  | ({ kind: "active" } & UpcomingMeetingCandidate & { endsAtMs: number })
  | ({ kind: "upcoming" } & UpcomingMeetingCandidate & { diffMs: number });

function getUpcomingMeetingStatus(
  buckets: TimelineBucket[],
  currentTimeMs: number,
  formatLabel: (diffMs: number) => string = formatUpcomingMeetingLabelEnglish,
  activeLabel = "Now",
): SidebarUpcomingMeetingStatus | null {
  const { active, nearest } = collectUpcomingMeetingCandidates(
    buckets,
    currentTimeMs,
  );

  if (active) {
    return {
      itemKey: active.itemKey,
      label: activeLabel,
      progress: 1,
      title: active.title,
    };
  }

  if (!nearest) {
    return null;
  }

  return {
    itemKey: nearest.itemKey,
    label: formatLabel(nearest.diffMs),
    progress: getUpcomingMeetingProgress(nearest.diffMs),
    title: nearest.title,
  };
}

function collectUpcomingMeetingCandidates(
  buckets: TimelineBucket[],
  currentTimeMs: number,
): {
  active: (UpcomingMeetingCandidate & { endsAtMs: number }) | null;
  nearest: (UpcomingMeetingCandidate & { diffMs: number }) | null;
} {
  let active: (UpcomingMeetingCandidate & { endsAtMs: number }) | null = null;
  let nearest: (UpcomingMeetingCandidate & { diffMs: number }) | null = null;

  for (const item of buckets.flatMap((bucket) => bucket.items)) {
    const timing = getUpcomingMeetingItemTiming(item, currentTimeMs);
    if (!timing) {
      continue;
    }

    if (timing.kind === "active") {
      if (!active || timing.endsAtMs < active.endsAtMs) {
        active = {
          itemKey: timing.itemKey,
          title: timing.title,
          endsAtMs: timing.endsAtMs,
        };
      }
      continue;
    }

    if (!nearest || timing.diffMs < nearest.diffMs) {
      nearest = {
        itemKey: timing.itemKey,
        title: timing.title,
        diffMs: timing.diffMs,
      };
    }
  }

  return { active, nearest };
}

function getUpcomingMeetingItemTiming(
  item: TimelineItem,
  currentTimeMs: number,
): UpcomingMeetingItemTiming | null {
  if (isAllDayTimelineItem(item)) {
    return null;
  }

  const { start, end } = getItemTimeRange(item);
  if (!start) {
    return null;
  }

  const identity: UpcomingMeetingCandidate = {
    itemKey: `${item.type}-${item.id}`,
    title: item.data.title || "Untitled",
  };
  const startsAtMs = start.getTime();
  const endsAtMs = end?.getTime();

  if (
    typeof endsAtMs === "number" &&
    isMeetingInProgress(startsAtMs, endsAtMs, currentTimeMs)
  ) {
    return { kind: "active", ...identity, endsAtMs };
  }

  const diffMs = startsAtMs - currentTimeMs;
  if (!isWithinUpcomingMeetingWindow(diffMs)) {
    return null;
  }

  return { kind: "upcoming", ...identity, diffMs };
}

function isMeetingInProgress(
  startsAtMs: number,
  endsAtMs: number,
  currentTimeMs: number,
): boolean {
  return (
    endsAtMs > startsAtMs &&
    startsAtMs <= currentTimeMs &&
    currentTimeMs <= endsAtMs
  );
}

function isWithinUpcomingMeetingWindow(diffMs: number): boolean {
  return diffMs > 0 && diffMs <= UPCOMING_MEETING_VISIBLE_WINDOW_MS;
}

function getUpcomingMeetingProgress(diffMs: number): number {
  return Math.max(0, Math.min(diffMs / UPCOMING_MEETING_VISIBLE_WINDOW_MS, 1));
}

function upcomingMeetingStatusesAreEqual(
  left: SidebarUpcomingMeetingStatus | null,
  right: SidebarUpcomingMeetingStatus | null,
) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.itemKey === right.itemKey &&
      left.label === right.label &&
      left.title === right.title &&
      left.progress === right.progress)
  );
}

export function useUpcomingMeetingLabelFormatter(): (diffMs: number) => string {
  const { t } = useLingui();

  return useCallback(
    (diffMs: number) => {
      const totalSeconds = Math.max(1, Math.floor(diffMs / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;

      if (minutes < 1) {
        return t`In ${totalSeconds}s`;
      }

      return t`In ${minutes}m ${seconds}s`;
    },
    [t],
  );
}

function formatUpcomingMeetingLabelEnglish(diffMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(diffMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 1) {
    return `In ${totalSeconds}s`;
  }

  return `In ${minutes}m ${seconds}s`;
}
