import type { EventParticipant } from "@syntheo/store";

export type { EventParticipant };
export type { IncomingCalendarEvent as IncomingEvent } from "@syntheo/plugin-calendar";

export type IncomingParticipants = Map<string, EventParticipant[]>;
