// Requêtes propres à l'accueil. Volontairement indépendantes de la barre
// latérale (lot 3 : elle disparaît) : prénom, prochaine réunion, notes
// récentes avec leur durée d'écoute.
import { useEffect, useMemo, useState } from "react";

import { firstNameOf } from "./format";
import type { HomeCalendarEvent } from "./next-meeting";
import { pickNextMeeting, type NextMeeting } from "./next-meeting";

import { useIgnoredEvents } from "~/calendar/ignored-events";
import { usePersonalContact } from "~/contacts/queries";
import { useLiveQuery } from "~/db";
import { useOwnerUserId } from "~/shared/owner-user";
import { useUndoDelete } from "~/store/zustand/undo-delete";

export const RECENT_NOTES_LIMIT = 5;
const NOW_TICK_MS = 30_000;

// Prénom de l'utilisateur : nom du contact propriétaire (pas de clé de
// réglage dédiée). Chaîne vide si inconnu.
export function useOwnerFirstName(): string {
  const ownerId = useOwnerUserId() ?? "";
  const { data } = usePersonalContact(ownerId);
  return firstNameOf(data?.name);
}

type HomeEventSqlRow = {
  id: string;
  title: string | null;
  started_at: string | null;
  ended_at: string | null;
  is_all_day: boolean | number | null;
  self_status: string | null;
  tracking_id_event: string | null;
  recurrence_series_id: string | null;
};

export function mapHomeEventRows(
  rows: readonly HomeEventSqlRow[],
): HomeCalendarEvent[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    startedAt: row.started_at ?? "",
    endedAt: row.ended_at ?? "",
    isAllDay: Boolean(row.is_all_day),
    selfStatus: row.self_status ?? null,
    trackingId: row.tracking_id_event || null,
    recurrenceSeriesId: row.recurrence_series_id || null,
  }));
}

const EMPTY_EVENTS: HomeCalendarEvent[] = [];

// Date (AAAA-MM-JJ) d'hier en UTC : borne large, le tri fin se fait en JS.
function sinceDatePrefix(now: Date): string {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return since.toISOString().slice(0, 10);
}

function useNow(intervalMs = NOW_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useNextMeeting(): NextMeeting | null {
  const now = useNow();
  const since = sinceDatePrefix(now);
  const { isIgnored } = useIgnoredEvents();
  const { data: events = EMPTY_EVENTS } = useLiveQuery<
    HomeEventSqlRow,
    HomeCalendarEvent[]
  >({
    sql: `
      SELECT
        event.id,
        event.title,
        event.started_at,
        event.ended_at,
        event.is_all_day,
        event.tracking_id_event,
        event.recurrence_series_id,
        CASE
          WHEN json_valid(event.attendance_json)
            THEN json_extract(event.attendance_json, '$.self_status')
        END AS self_status
      FROM events AS event
      WHERE event.deleted_at IS NULL
        AND event.started_at >= ?
      ORDER BY event.started_at, event.id
    `,
    params: [since],
    mapRows: mapHomeEventRows,
  });

  return useMemo(
    () => pickNextMeeting(events, now, isIgnored),
    [events, now, isIgnored],
  );
}

export type RecentNote = {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
};

type RecentNoteSqlRow = {
  id: string;
  title: string | null;
  created_at: string | null;
  duration_ms: number | null;
};

export function mapRecentNoteRows(
  rows: readonly RecentNoteSqlRow[],
): RecentNote[] {
  return rows.map((row) => ({
    id: row.id,
    title: (row.title ?? "").trim(),
    createdAt: row.created_at ?? "",
    durationMs: Math.max(0, Number(row.duration_ms ?? 0)),
  }));
}

const EMPTY_NOTES: RecentNote[] = [];

// Notes récentes pour « Reprendre ». La durée est la somme des segments de
// transcription (début et fin en ms) de la note.
export function useRecentNotes(limit = RECENT_NOTES_LIMIT): RecentNote[] {
  // Marge pour masquer les suppressions en attente sans raccourcir la liste.
  const fetchLimit = limit + 5;
  const { data = EMPTY_NOTES } = useLiveQuery<RecentNoteSqlRow, RecentNote[]>({
    sql: `
        SELECT
          session.id,
          session.title,
          session.created_at,
          COALESCE((
            SELECT SUM(transcript.ended_at_ms - transcript.started_at_ms)
            FROM transcripts AS transcript
            WHERE transcript.session_id = session.id
              AND transcript.deleted_at IS NULL
              AND transcript.ended_at_ms > transcript.started_at_ms
          ), 0) AS duration_ms
        FROM sessions AS session
        WHERE session.deleted_at IS NULL
        ORDER BY session.created_at DESC, session.id
        LIMIT ?
      `,
    params: [fetchLimit],
    mapRows: mapRecentNoteRows,
  });
  const pendingDeletions = useUndoDelete((state) => state.pendingDeletions);

  return useMemo(
    () => data.filter((note) => !(note.id in pendingDeletions)).slice(0, limit),
    [data, pendingDeletions, limit],
  );
}
