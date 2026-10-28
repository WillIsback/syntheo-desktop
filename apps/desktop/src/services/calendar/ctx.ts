import { commands as calendarCommands } from "@syntheo/plugin-calendar";
import type {
  CalendarListItem,
  CalendarProviderType,
  ProviderConnectionIds,
} from "@syntheo/plugin-calendar";

import { applyCalendarInventory, loadEnabledCalendars } from "./storage";

import { enqueueDatabaseWrite } from "~/db/write-queue";

export interface Ctx {
  provider: CalendarProviderType;
  connectionId: string;
  from: Date;
  to: Date;
  calendarIds: Set<string>;
  calendarTrackingIdToId: Map<string, string>;
  calendars: Array<{ id: string; tracking_id_calendar: string }>;
}

export type CalendarSyncRange = {
  from: Date;
  to: Date;
};

export async function createCtx(
  provider: CalendarProviderType,
  connectionId: string,
  range: CalendarSyncRange = getDefaultRange(),
): Promise<Ctx> {
  const calendars = await loadEnabledCalendars(provider, connectionId);
  const calendarIds = new Set<string>();
  const calendarTrackingIdToId = new Map<string, string>();

  for (const calendar of calendars) {
    calendarIds.add(calendar.id);
    if (calendar.tracking_id_calendar) {
      calendarTrackingIdToId.set(calendar.tracking_id_calendar, calendar.id);
    }
  }

  return {
    provider,
    connectionId,
    from: range.from,
    to: range.to,
    calendarIds,
    calendarTrackingIdToId,
    calendars: calendars.map((calendar) => ({
      id: calendar.id,
      tracking_id_calendar: calendar.tracking_id_calendar,
    })),
  };
}

export async function getProviderConnections(): Promise<
  ProviderConnectionIds[]
> {
  const result = await calendarCommands.listConnectionIds();
  if (result.status === "error") {
    throw new Error(`Failed to discover calendar connections: ${result.error}`);
  }
  return result.data;
}

type SuccessfulConnection = {
  connectionId: string;
  calendars: CalendarListItem[];
};

async function collectSuccessfulConnections(
  provider: CalendarProviderType,
  connectionIds: string[],
  shouldStop: () => boolean,
): Promise<SuccessfulConnection[] | undefined> {
  const successfulConnections: SuccessfulConnection[] = [];

  for (const connectionId of connectionIds) {
    if (shouldStop()) return undefined;

    const result = await calendarCommands.listCalendars(provider, connectionId);
    if (shouldStop()) return undefined;
    if (result.status === "error") continue;
    successfulConnections.push({ connectionId, calendars: result.data });
  }

  return successfulConnections;
}

async function syncProviderConnections(
  provider: CalendarProviderType,
  connectionIds: string[],
  shouldStop: () => boolean,
): Promise<boolean> {
  if (shouldStop()) return true;

  const successfulConnections = await collectSuccessfulConnections(
    provider,
    connectionIds,
    shouldStop,
  );
  if (successfulConnections === undefined) return true;
  if (shouldStop()) return true;

  await enqueueDatabaseWrite("calendar-sync", async () => {
    if (shouldStop()) return;
    await applyCalendarInventory({
      provider,
      requestedConnectionIds: connectionIds,
      successfulConnections,
    });
  });
  return false;
}

export async function syncCalendars(
  providerConnections: ProviderConnectionIds[],
  signal?: AbortSignal,
  shouldStop: () => boolean = () => signal?.aborted === true,
): Promise<void> {
  // Chaînage séquentiel sans `await` dans une boucle : le fournisseur suivant
  // ne démarre qu'après l'écriture du précédent, et on s'arrête à la première
  // demande d'arrêt (comportement identique aux `return` précédents).
  await providerConnections.reduce(
    (chain, { provider, connection_ids }) =>
      chain.then((stopped) =>
        stopped
          ? true
          : syncProviderConnections(provider, connection_ids, shouldStop),
      ),
    Promise.resolve(false),
  );
}

const getDefaultRange = (): CalendarSyncRange => {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 6);
  const to = new Date(now);
  to.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() + 2);
  return { from, to };
};
