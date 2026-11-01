import { describe, expect, it } from "vitest";

import { type HomeCalendarEvent, pickNextMeeting } from "./next-meeting";

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 9, 31, hours, minutes, 0, 0);
}

function event(
  id: string,
  start: Date,
  end: Date,
  overrides: Partial<HomeCalendarEvent> = {},
): HomeCalendarEvent {
  return {
    id,
    title: `Réunion ${id}`,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    isAllDay: false,
    selfStatus: null,
    trackingId: `track-${id}`,
    recurrenceSeriesId: null,
    ...overrides,
  };
}

describe("pickNextMeeting", () => {
  const now = at(10);

  it("ne renvoie rien sans événement", () => {
    expect(pickNextMeeting([], now)).toBeNull();
  });

  it("prend le prochain événement de la journée, pas encore imminent", () => {
    const result = pickNextMeeting(
      [event("b", at(16), at(17)), event("a", at(14), at(15))],
      now,
    );
    expect(result?.id).toBe("a");
    expect(result?.title).toBe("Réunion a");
    expect(result?.imminent).toBe(false);
    expect(result?.ongoing).toBe(false);
  });

  it("marque imminente une réunion en cours ou dans moins de 15 min", () => {
    expect(
      pickNextMeeting([event("now", at(9, 30), at(10, 30))], now)?.ongoing,
    ).toBe(true);
    expect(
      pickNextMeeting([event("now", at(9, 30), at(10, 30))], now)?.imminent,
    ).toBe(true);
    expect(
      pickNextMeeting([event("soon", at(10, 10), at(11))], now)?.imminent,
    ).toBe(true);
    expect(
      pickNextMeeting([event("later", at(10, 20), at(11))], now)?.imminent,
    ).toBe(false);
  });

  it("ignore les événements terminés, de demain, sur la journée, déclinés ou ignorés", () => {
    const result = pickNextMeeting(
      [
        event("past", at(8), at(9)),
        event("tomorrow", new Date(2026, 10, 1, 9), new Date(2026, 10, 1, 10)),
        event("allday", at(0), at(23, 59), { isAllDay: true }),
        event("declined", at(11), at(12), { selfStatus: "declined" }),
        event("ignored", at(12), at(13)),
      ],
      now,
      (trackingId) => trackingId === "track-ignored",
    );
    expect(result).toBeNull();
  });

  it("ignore les dates illisibles", () => {
    expect(
      pickNextMeeting(
        [{ ...event("bad", at(11), at(12)), startedAt: "pas une date" }],
        now,
      ),
    ).toBeNull();
  });
});
