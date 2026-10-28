import { useMemo } from "react";

import { useSmartCurrentTime } from "./realtime";
import {
  buildTimelineBuckets,
  deriveTimelineWindowData,
  filterTimelineTablesByFolder,
  getItemTimestamp,
  type TimelineBucket,
  type TimelineEventsTable,
  type TimelineGroupBy,
  type TimelineSessionsTable,
  type TimelineSortOrder,
} from "./utils";

export function getFallbackIndicatorIndex(
  buckets: TimelineBucket[],
  nowMs: number,
  sortOrder: TimelineSortOrder = "newest",
) {
  return sortOrder === "oldest"
    ? findOldestFallbackIndicatorIndex(buckets, nowMs)
    : findNewestFallbackIndicatorIndex(buckets, nowMs);
}

function findOldestFallbackIndicatorIndex(
  buckets: TimelineBucket[],
  nowMs: number,
) {
  for (let index = 0; index < buckets.length; index++) {
    const bucket = buckets[index];
    if (!bucket) {
      continue;
    }

    if (isFutureBucketLabel(bucket.label)) {
      return index;
    }

    if (hasItemAtOrAfter(bucket, nowMs)) {
      return index;
    }
  }

  return -1;
}

function findNewestFallbackIndicatorIndex(
  buckets: TimelineBucket[],
  nowMs: number,
) {
  let staleFutureBoundary: number | null = null;

  for (let index = 0; index < buckets.length; index++) {
    const bucket = buckets[index];
    if (!bucket) {
      continue;
    }

    const itemDate = getFirstItemTimestamp(bucket);
    if (!itemDate || itemDate.getTime() >= nowMs) {
      continue;
    }

    if (isFutureBucketLabel(bucket.label)) {
      staleFutureBoundary = index + 1;
      continue;
    }

    return staleFutureBoundary ?? index;
  }

  return staleFutureBoundary ?? -1;
}

function getFirstItemTimestamp(bucket: TimelineBucket): Date | null {
  const firstItem = bucket.items[0];
  return firstItem ? getItemTimestamp(firstItem) : null;
}

function hasItemAtOrAfter(bucket: TimelineBucket, nowMs: number) {
  const newestItem = bucket.items[bucket.items.length - 1];
  const itemDate = newestItem ? getItemTimestamp(newestItem) : null;
  return itemDate !== null && itemDate.getTime() >= nowMs;
}

function isFutureBucketLabel(label: string) {
  return (
    label === "Tomorrow" ||
    label === "next week" ||
    label === "next month" ||
    label.startsWith("in ")
  );
}

export function useTimelineData({
  folderFilter = null,
  groupBy = "date",
  isEventIgnored,
  showIgnored,
  sortOrder = "newest",
  timelineEventsTable,
  timelineSessionsTable,
  timezone,
}: {
  folderFilter?: string | null;
  groupBy?: TimelineGroupBy;
  isEventIgnored: (
    trackingId: string | null | undefined,
    recurrenceSeriesId: string | null | undefined,
  ) => boolean;
  showIgnored: boolean;
  sortOrder?: TimelineSortOrder;
  timelineEventsTable: TimelineEventsTable;
  timelineSessionsTable: TimelineSessionsTable;
  timezone?: string;
}): {
  buckets: TimelineBucket[];
  hasMoreFutureItems: boolean;
} {
  const folderScopedTables = useMemo(
    () =>
      filterTimelineTablesByFolder({
        folderFilter,
        timelineEventsTable,
        timelineSessionsTable,
      }),
    [folderFilter, timelineEventsTable, timelineSessionsTable],
  );
  const windowData = useMemo(() => {
    if (groupBy === "folder") {
      return {
        timelineEventsTable: {},
        timelineSessionsTable: folderScopedTables.timelineSessionsTable,
        hasMoreFutureItems: false,
      };
    }

    return deriveTimelineWindowData({
      isEventIgnored,
      showIgnored,
      timelineEventsTable: folderScopedTables.timelineEventsTable,
      timelineSessionsTable: folderScopedTables.timelineSessionsTable,
      timezone,
    });
  }, [folderScopedTables, groupBy, isEventIgnored, showIgnored, timezone]);
  const currentTimeMs = useSmartCurrentTime(
    windowData.timelineEventsTable,
    windowData.timelineSessionsTable,
  );

  return useMemo(() => {
    const buckets = buildTimelineBuckets({
      groupBy,
      sortOrder,
      timelineEventsTable: windowData.timelineEventsTable,
      timelineSessionsTable: windowData.timelineSessionsTable,
      timezone,
    });

    return {
      buckets,
      hasMoreFutureItems: windowData.hasMoreFutureItems,
    };
  }, [groupBy, sortOrder, windowData, currentTimeMs, timezone]);
}
