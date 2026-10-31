import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #268 : pendant l'écoute, la capture du contexte des locuteurs
// interroge la base toutes les 5 s. Ses requêtes ne sont simulées ici que par
// une vraie base SQLite construite à partir des migrations : un test à base de
// réponses factices laissait passer une requête invalide qui échouait à chaque
// passage (« [speaker-context] observation failed » toutes les 5 s).

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

type SqlParams = import("node:sqlite").SQLInputValue[];

const mocks = vi.hoisted(() => ({
  database: null as null | import("node:sqlite").DatabaseSync,
}));

vi.mock("@syntheo/plugin-detect", () => ({
  commands: {
    // Linux : PipeWire signale l'application elle-même, pas d'inspection.
    listMicUsingApplications: async () => ({
      status: "ok",
      data: [
        { id: "PipeWire ALSA [syntheo]", name: "PipeWire ALSA [syntheo]" },
      ],
    }),
    inspectMeetingAccessibility: async () => ({ status: "ok", data: [] }),
  },
}));
vi.mock("@syntheo/plugin-transcription", () => ({
  commands: {
    getCurrentMicrophoneDevice: async () => ({
      status: "ok",
      data: "Default Audio Device",
    }),
  },
}));
vi.mock("~/db", () => ({
  liveQueryClient: {
    execute: async (sql: string, params: unknown[] = []) =>
      mocks.database!.prepare(sql).all(...(params as SqlParams)),
  },
  executeTransaction: async (
    statements: Array<{ sql: string; params: unknown[] }>,
  ) =>
    statements.map(
      ({ sql, params }) =>
        mocks.database!.prepare(sql).run(...(params as SqlParams)).changes,
    ),
}));

import { getSessionParticipantHumanIds } from "./queries";
import {
  observeSpeakerMicrophone,
  startSpeakerContextCapture,
  stopSpeakerContextCapture,
} from "./speaker-context-capture";

const MIGRATIONS = resolve(process.cwd(), "../../crates/db-app/migrations");

describe("speaker context capture on the real schema", () => {
  beforeEach(() => {
    const database = new DatabaseSync(":memory:");
    for (const file of readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      database.exec(readFileSync(resolve(MIGRATIONS, file), "utf8"));
    }
    database.exec(`
      INSERT INTO humans (id, name, email) VALUES ('self', 'Moi', 'moi@example.org');
      INSERT INTO humans (id, name, email) VALUES ('remote', 'Alex', 'alex@example.org');
      INSERT INTO sessions (id, owner_user_id, title) VALUES ('session', 'self', 'Réunion');
      INSERT INTO session_participants (id, session_id, human_id)
        VALUES ('p-self', 'session', 'self'), ('p-remote', 'session', 'remote');
    `);
    mocks.database = database;
  });
  afterEach(async () => {
    await stopSpeakerContextCapture("session");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records every 5 s poll of a Linux capture without reporting a failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    startSpeakerContextCapture("session");
    observeSpeakerMicrophone("session", { device: "Default Audio Device" });
    observeSpeakerMicrophone("session", { available: true });
    observeSpeakerMicrophone("session", { isolated: false });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(error.mock.calls).toEqual([]);
    const [row] = mocks
      .database!.prepare(
        "SELECT json_extract(metadata_json, '$.speaker_context') AS context FROM sessions WHERE id = 'session'",
      )
      .all() as Array<{ context: string }>;
    const intervals = JSON.parse(row!.context).intervals;
    expect(intervals.length).toBeGreaterThan(0);
    expect(intervals.at(-1)).toMatchObject({
      active_call: false,
      title: "Réunion",
      participants: [{ human_id: "remote", name: "Alex" }],
    });
  });

  it("keeps only remote participants, without the user's other addresses", async () => {
    mocks.database!.exec(`
      UPDATE humans SET metadata_json = '{"additionalEmails":["moi@perso.example"]}' WHERE id = 'self';
      INSERT INTO humans (id, name, email) VALUES
        ('calendar-copy', 'Moi (agenda)', 'MOI@example.org'),
        ('alias', 'Moi (perso)', 'moi@perso.example'),
        ('excluded', 'Sam', 'sam@example.org');
      INSERT INTO session_participants (id, session_id, human_id, source) VALUES
        ('p-copy', 'session', 'calendar-copy', ''),
        ('p-alias', 'session', 'alias', ''),
        ('p-excluded', 'session', 'excluded', 'excluded');
    `);

    await expect(getSessionParticipantHumanIds("session")).resolves.toEqual([
      "remote",
    ]);
  });
});
