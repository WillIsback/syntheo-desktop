// Choix de la « prochaine réunion » de l'accueil, à partir des événements
// de l'agenda. Contrairement à la barre latérale (fenêtre de 5 min), on
// regarde tout ce qui reste aujourd'hui : réunion en cours ou à venir.

export type HomeCalendarEvent = {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  isAllDay: boolean;
  selfStatus: string | null;
  trackingId: string | null;
  recurrenceSeriesId: string | null;
};

export type NextMeeting = {
  id: string;
  title: string;
  startedAt: Date;
  endedAt: Date;
  // Réunion en cours, ou qui commence dans moins de IMMINENT_WINDOW_MS :
  // le bouton Démarrer reprend alors son titre et ses participants.
  imminent: boolean;
  // Déjà commencée.
  ongoing: boolean;
};

export const IMMINENT_WINDOW_MS = 15 * 60 * 1000;

function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfLocalDay(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

export function pickNextMeeting(
  events: readonly HomeCalendarEvent[],
  now: Date,
  isIgnored: (
    trackingId: string | null,
    recurrenceSeriesId: string | null,
  ) => boolean = () => false,
): NextMeeting | null {
  const dayEnd = endOfLocalDay(now);
  const nowMs = now.getTime();
  let best: NextMeeting | null = null;

  for (const event of events) {
    if (event.isAllDay) continue;
    if (event.selfStatus === "declined") continue;
    if (isIgnored(event.trackingId, event.recurrenceSeriesId)) continue;

    const startedAt = parseDate(event.startedAt);
    if (!startedAt) continue;
    const endedAt = parseDate(event.endedAt) ?? startedAt;
    const startMs = startedAt.getTime();

    // Déjà terminée, ou pas pour aujourd'hui.
    if (endedAt.getTime() <= nowMs) continue;
    if (startMs > dayEnd) continue;

    const better =
      !best ||
      startMs < best.startedAt.getTime() ||
      (startMs === best.startedAt.getTime() && event.id < best.id);
    if (better) {
      best = {
        id: event.id,
        title: event.title.trim(),
        startedAt,
        endedAt,
        imminent: startMs - nowMs <= IMMINENT_WINDOW_MS,
        ongoing: startMs <= nowMs,
      };
    }
  }

  return best;
}
