import { addDays, format, startOfWeek, subDays } from "date-fns";

import { TZDate } from "@syntheo/utils";

import type { ActivityRecord } from "./queries";

type ActivityRange = "all" | "30d" | "7d";
type Spans = Array<[number, number]>;
type HeatmapDay = { date: Date; key: string; count: number };

type ActivityBuckets = {
  sessions: Set<string>;
  allSessions: Set<string>;
  dailySessions: Map<string, Set<string>>;
  weeks: Set<string>;
  intervals: Map<string, Spans>;
  sessionStarts: Map<string, Date>;
};

function resolveCutoff(localNow: Date, range: ActivityRange): string {
  if (range === "all") return "";
  return format(subDays(localNow, range === "7d" ? 6 : 29), "yyyy-MM-dd");
}

function startedAtMs(record: ActivityRecord): number {
  return record.started_at_ms > 0
    ? record.started_at_ms
    : Date.parse(record.created_at);
}

function addDaySession(buckets: ActivityBuckets, day: string, session: string) {
  const daySessions = buckets.dailySessions.get(day) ?? new Set<string>();
  daySessions.add(session);
  buckets.dailySessions.set(day, daySessions);
}

function trackSessionStart(
  buckets: ActivityBuckets,
  session: string,
  date: Date,
) {
  const firstStart = buckets.sessionStarts.get(session);
  if (!firstStart || date < firstStart) {
    buckets.sessionStarts.set(session, date);
  }
}

function trackIntervals(
  buckets: ActivityBuckets,
  record: ActivityRecord,
  startedAt: number,
  nowMs: number,
) {
  if (!Number.isFinite(record.duration_ms) || record.duration_ms <= 0) return;
  const end = Math.min(startedAt + record.duration_ms, nowMs);
  const spans = buckets.intervals.get(record.session_id) ?? [];
  spans.push([startedAt, end]);
  buckets.intervals.set(record.session_id, spans);
}

function collectBuckets(
  records: ActivityRecord[],
  now: Date,
  timezone: string | undefined,
  cutoff: string,
  weekStartsOn: 0 | 1,
): ActivityBuckets {
  const buckets: ActivityBuckets = {
    sessions: new Set(),
    allSessions: new Set(),
    dailySessions: new Map(),
    weeks: new Set(),
    intervals: new Map(),
    sessionStarts: new Map(),
  };
  const nowMs = now.getTime();

  for (const record of records) {
    const startedAt = startedAtMs(record);
    if (!Number.isFinite(startedAt) || startedAt > nowMs) continue;
    const date = timezone
      ? new TZDate(startedAt, timezone)
      : new Date(startedAt);
    const day = format(date, "yyyy-MM-dd");
    buckets.allSessions.add(record.session_id);
    addDaySession(buckets, day, record.session_id);
    buckets.weeks.add(
      format(startOfWeek(date, { weekStartsOn }), "yyyy-MM-dd"),
    );
    if (day < cutoff) continue;
    buckets.sessions.add(record.session_id);
    trackSessionStart(buckets, record.session_id, date);
    trackIntervals(buckets, record, startedAt, nowMs);
  }

  return buckets;
}

function mergedDuration(spans: Spans): number {
  spans.sort((a, b) => a[0] - b[0]);
  let previousEnd = 0;
  let sessionDurationMs = 0;
  for (const [start, end] of spans) {
    sessionDurationMs += Math.max(0, end - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, end);
  }
  return sessionDurationMs;
}

function summarizeDurations(intervals: Map<string, Spans>) {
  const durations: number[] = [];
  let durationMs = 0;
  for (const spans of intervals.values()) {
    const sessionDurationMs = mergedDuration(spans);
    durationMs += sessionDurationMs;
    if (sessionDurationMs > 0) durations.push(sessionDurationMs);
  }
  durations.sort((a, b) => a - b);
  return { durationMs, durations };
}

function medianMinutes(durations: number[]): number | null {
  if (durations.length === 0) return null;
  const middle = Math.floor(durations.length / 2);
  const medianMs =
    durations.length % 2
      ? durations[middle]
      : (durations[middle - 1] + durations[middle]) / 2;
  return medianMs / 60_000;
}

function countWeekdays(sessionStarts: Map<string, Date>, weekStartsOn: 0 | 1) {
  const weekdayCounts = Array.from({ length: 7 }, (_, index) => ({
    weekday: (index + weekStartsOn) % 7,
    count: 0,
  }));
  for (const date of sessionStarts.values()) {
    weekdayCounts[(date.getDay() - weekStartsOn + 7) % 7].count += 1;
  }
  return weekdayCounts;
}

function countWeekStreak(
  weeks: Set<string>,
  localNow: Date,
  weekStartsOn: 0 | 1,
): number {
  let currentWeek = startOfWeek(localNow, { weekStartsOn });
  if (!weeks.has(format(currentWeek, "yyyy-MM-dd"))) {
    currentWeek = subDays(currentWeek, 7);
  }
  let streak = 0;
  while (weeks.has(format(currentWeek, "yyyy-MM-dd"))) {
    streak += 1;
    currentWeek = subDays(currentWeek, 7);
  }
  return streak;
}

function buildHeatmap(
  dailySessions: Map<string, Set<string>>,
  localNow: Date,
  today: string,
  weekStartsOn: 0 | 1,
): HeatmapDay[] {
  const days: HeatmapDay[] = [];
  const heatmapStart = startOfWeek(subDays(localNow, 364), { weekStartsOn });
  for (
    let date = heatmapStart;
    format(date, "yyyy-MM-dd") <= today;
    date = addDays(date, 1)
  ) {
    const key = format(date, "yyyy-MM-dd");
    days.push({ date, key, count: dailySessions.get(key)?.size ?? 0 });
  }
  return days;
}

export function summarizeActivity(
  records: ActivityRecord[],
  now: Date,
  timezone?: string,
  weekStartsOn: 0 | 1 = 0,
  range: ActivityRange = "all",
) {
  const localNow = timezone ? new TZDate(now, timezone) : now;
  const today = format(localNow, "yyyy-MM-dd");
  const cutoff = resolveCutoff(localNow, range);
  const buckets = collectBuckets(records, now, timezone, cutoff, weekStartsOn);
  const { durationMs, durations } = summarizeDurations(buckets.intervals);
  const total = buckets.allSessions.size;

  return {
    conversations: buckets.sessions.size,
    totalConversations: total,
    hours: durationMs / 3_600_000,
    activeDays: [...buckets.dailySessions.keys()].filter((day) => day >= cutoff)
      .length,
    streak: countWeekStreak(buckets.weeks, localNow, weekStartsOn),
    days: buildHeatmap(buckets.dailySessions, localNow, today, weekStartsOn),
    weekdayCounts: countWeekdays(buckets.sessionStarts, weekStartsOn),
    medianMinutes: medianMinutes(durations),
    timedConversations: durations.length,
    conversationDays: new Set(
      [...buckets.sessionStarts.values()].map((date) =>
        format(date, "yyyy-MM-dd"),
      ),
    ).size,
  };
}
