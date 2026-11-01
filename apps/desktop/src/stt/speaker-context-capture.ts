import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { commands as detectCommands } from "@syntheo/plugin-detect";
import {
  commands as transcriptionCommands,
  type SpeakerContextInterval,
} from "@syntheo/plugin-transcription";

import { executeTransaction, liveQueryClient } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { inspectionShowsActiveMeeting } from "~/stt/meeting-accessibility";
import { isMeetingCapableMicApp } from "~/stt/meeting-apps";
import { getSessionParticipantHumanIds } from "~/stt/queries";
import {
  appendSpeakerObservation,
  closeSpeakerContext,
  isSharedMicrophone,
  isPersonalMicrophone,
  parseSpeakerContext,
} from "~/stt/speaker-context";

const captures = new Map<string, ReturnType<typeof createCapture>>();
const POLL_MS = 5_000;
// Unchanged evidence is persisted with a lease covering several polls and only
// renewed once it gets close to expiring, so a steady meeting rewrites the
// session row every ~25 s instead of on every poll (issue 271). Changed
// evidence is written immediately and closes the previous interval.
const EVIDENCE_LEASE_MS = 30_000;
const EVIDENCE_RENEWAL_MARGIN_MS = 2 * POLL_MS;
// Apps a scheduled meeting link can be joined from; browsers cover Meet and web clients.
const MEETING_CAPABLE_MIC_APP =
  /zoom|teams|slack|webex|chrome|chromium|safari|thebrowser|aside|firefox|brave|edge|vivaldi|opera/i;
// L'inspection d'accessibilité parcourt l'arbre des applications de réunion
// (AT-SPI sous Linux) : c'est la sonde la plus coûteuse de l'écoute (issue 273).
// Sans réunion visible, elle est espacée jusqu'à 20 s ; les constats restent
// écrits à chaque sondage de 5 s avec le dernier résultat connu.
const INSPECTION_MAX_INTERVAL_MS = 20_000;
const INSPECTION_TOLERATED_MISSES = 1;

export function speakerInspectionDelayMs(consecutiveMisses: number) {
  const backoffSteps = consecutiveMisses - INSPECTION_TOLERATED_MISSES;
  if (backoffSteps <= 0) return 0;
  return Math.min(POLL_MS * 2 ** backoffSteps, INSPECTION_MAX_INTERVAL_MS);
}

// Une inspection ne peut établir un appel que pour une application qui tient le
// micro : si aucune ne ressemble à une application de réunion, inutile d'inspecter.
function micAppMayHostMeeting(app: { id: string; name: string }) {
  return (
    isMeetingCapableMicApp(app) ||
    MEETING_CAPABLE_MIC_APP.test(app.id) ||
    MEETING_CAPABLE_MIC_APP.test(app.name) ||
    /discord/i.test(`${app.id} ${app.name}`)
  );
}

export function startSpeakerContextCapture(sessionId: string) {
  if (getCurrentWebviewWindow().label !== "main") return;
  if (!captures.has(sessionId))
    captures.set(sessionId, createCapture(sessionId));
}

export function observeSpeakerMicrophone(
  sessionId: string,
  update: { device?: string | null; isolated?: boolean; available?: boolean },
) {
  startSpeakerContextCapture(sessionId);
  captures.get(sessionId)?.microphone(update);
}

export function stopSpeakerContextCapture(sessionId: string) {
  const capture = captures.get(sessionId);
  captures.delete(sessionId);
  return capture?.stop() ?? Promise.resolve();
}

function createCapture(sessionId: string) {
  let stopped = false;
  let device: string | null = null;
  let isolated: boolean | null = null;
  let available = true;
  // The app last seen in an active call. Accessibility reads flicker while the call
  // continues, so the call is only over once that app releases the microphone or an
  // inspection positively shows it out of the call.
  let callAppId: string | null = null;
  let generation = 0;
  let pending: Promise<void> | null = null;
  let repoll = false;
  // Ralentissement de l'inspection d'accessibilité quand aucune réunion n'est vue.
  let inspectionMisses = 0;
  let nextInspectionAt = 0;
  let lastInspections: Awaited<
    ReturnType<typeof detectCommands.inspectMeetingAccessibility>
  > | null = null;
  const inspectIfUseful = async (
    micResult: Awaited<
      ReturnType<typeof detectCommands.listMicUsingApplications>
    > | null,
    at: number,
  ) => {
    const mayHostMeeting =
      callAppId !== null ||
      micResult?.status !== "ok" ||
      micResult.data.some(micAppMayHostMeeting);
    if (!mayHostMeeting) {
      // Filtre bon marché : aucun parcours, et reprise immédiate dès qu'une
      // application de réunion prend le micro.
      inspectionMisses = 0;
      nextInspectionAt = 0;
      lastInspections = null;
      return { status: "ok" as const, data: [] };
    }
    if (callAppId === null && at < nextInspectionAt && lastInspections) {
      return lastInspections;
    }
    const result = await detectCommands
      .inspectMeetingAccessibility()
      .catch(() => null);
    const sawMeeting =
      result?.status === "ok" &&
      result.data.some(
        (inspection) =>
          inspection.activeCall && inspectionShowsActiveMeeting(inspection),
      );
    inspectionMisses = sawMeeting ? 0 : inspectionMisses + 1;
    nextInspectionAt = at + speakerInspectionDelayMs(inspectionMisses);
    lastInspections = result;
    return result;
  };
  const report = (error: unknown) =>
    console.error("[speaker-context] observation failed", error);
  const persist = (
    observation: SpeakerContextInterval | null,
    at: number,
    observedGeneration?: number,
  ) =>
    enqueueDatabaseWrite(`session:${sessionId}`, async () => {
      const rows = await liveQueryClient.execute<{ context: string | null }>(
        "SELECT json_extract(metadata_json, '$.speaker_context') AS context FROM sessions WHERE id = ? AND deleted_at IS NULL",
        [sessionId],
      );
      if (
        !rows[0] ||
        (observation && (stopped || observedGeneration !== generation))
      )
        return;
      const previous = parseSpeakerContext(rows[0].context);
      if (observation && leaseStillCovers(previous, observation, at)) return;
      const next = observation
        ? appendSpeakerObservation(previous, observation)
        : closeSpeakerContext(previous, at);
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      await executeTransaction([
        {
          sql: "UPDATE sessions SET metadata_json = json_set(metadata_json, '$.speaker_context', json(?)), updated_at = ? WHERE id = ? AND deleted_at IS NULL",
          params: [JSON.stringify(next), new Date().toISOString(), sessionId],
        },
      ]);
    });

  const poll = async () => {
    const observedGeneration = generation;
    const at = Date.now();
    const [
      [micResult, inspectionsResult],
      rows,
      participantIds,
      currentDevice,
    ] = await Promise.all([
      detectCommands
        .listMicUsingApplications()
        .catch(() => null)
        .then(async (mic) => [mic, await inspectIfUseful(mic, at)] as const),
      liveQueryClient.execute<{
        title: string;
        event_json: string;
        owner_user_id: string;
        name: string;
        aliases: string | null;
      }>(
        "SELECT s.title, s.event_json, s.owner_user_id, COALESCE(h.name, '') AS name, json_extract(h.metadata_json, '$.aliases') AS aliases FROM sessions s LEFT JOIN humans h ON h.id = s.owner_user_id AND h.deleted_at IS NULL WHERE s.id = ? AND s.deleted_at IS NULL",
        [sessionId],
      ),
      getSessionParticipantHumanIds(sessionId),
      available && device === null
        ? transcriptionCommands.getCurrentMicrophoneDevice().catch(() => null)
        : Promise.resolve(null),
    ]);
    if (stopped || observedGeneration !== generation || !rows[0]) return;
    const row = rows[0];
    const micApps = micResult?.status === "ok" ? micResult.data : [];
    const inspections =
      inspectionsResult?.status === "ok" ? inspectionsResult.data : [];
    const active = inspections.filter(
      (inspection) =>
        inspection.activeCall &&
        inspectionShowsActiveMeeting(inspection) &&
        micApps.some((app) => app.id === inspection.app.id),
    );
    let meetingLink = "";
    try {
      meetingLink = JSON.parse(row.event_json).meeting_link ?? "";
    } catch {
      /* No calendar context. */
    }
    let aliases: string[] = [];
    try {
      const value = JSON.parse(row.aliases ?? "[]");
      if (Array.isArray(value))
        aliases = value.filter((name) => typeof name === "string");
    } catch {
      /* Invalid aliases provide no identity evidence. */
    }
    const participants = participantIds.length
      ? await liveQueryClient.execute<{ human_id: string; name: string }>(
          `SELECT id AS human_id, name FROM humans WHERE id IN (${participantIds.map(() => "?").join(",")}) AND deleted_at IS NULL ORDER BY id`,
          participantIds,
        )
      : [];
    if (stopped || observedGeneration !== generation) return;
    if (active.length === 1) {
      callAppId = active[0]!.app.id;
    } else if (callAppId) {
      // A failed lookup proves nothing; only a successful one can show the app let go.
      const releasedMicrophone =
        micResult?.status === "ok" &&
        !micApps.some((app) => app.id === callAppId);
      const leftCall = inspections.some(
        (inspection) =>
          inspection.app.id === callAppId && !inspection.activeCall,
      );
      if (releasedMicrophone || leftCall) callAppId = null;
    }
    // An observed pre-join/ended window overrides a scheduled link. A link alone is never attendance.
    const calendarCall = Boolean(
      meetingLink &&
      micApps.some((app) => MEETING_CAPABLE_MIC_APP.test(app.id)) &&
      inspections.length === 0,
    );
    const inputDevice = available
      ? (device ?? (currentDevice?.status === "ok" ? currentDevice.data : null))
      : null;
    await persist(
      {
        start_ms: at,
        end_ms: at + EVIDENCE_LEASE_MS,
        active_call: callAppId !== null,
        calendar_call: calendarCall,
        // A headset is isolated by construction; for anything else the runtime verdict
        // decides — headphones already keep speaker output out of the mic, and a
        // Bluetooth-swapped replacement is a room mic as far as we know.
        mic_isolated: available
          ? isPersonalMicrophone(inputDevice)
            ? true
            : isolated
          : null,
        shared_microphone: isSharedMicrophone(inputDevice),
        title: row.title,
        self_names: [row.name, ...aliases].filter(Boolean),
        participants,
      },
      at,
      observedGeneration,
    );
  };
  const schedule = () => {
    if (stopped || pending) return;
    pending = poll()
      .catch(report)
      .finally(() => {
        pending = null;
        if (repoll) {
          repoll = false;
          schedule();
        }
      });
  };
  const timer = setInterval(schedule, POLL_MS);
  schedule();
  return {
    microphone(update: {
      device?: string | null;
      isolated?: boolean;
      available?: boolean;
    }) {
      if ("available" in update) available = update.available ?? false;
      if ("device" in update) {
        device = update.device ?? null;
        isolated = null;
      }
      if ("isolated" in update) isolated = update.isolated ?? null;
      generation++;
      // Close the old interval immediately; an asynchronous inspection cannot extend old device evidence.
      const at = Date.now();
      void persist(null, at).catch(report);
      repoll = pending !== null;
      schedule();
    },
    stop() {
      stopped = true;
      generation++;
      clearInterval(timer);
      const at = Date.now();
      return persist(null, at).catch(report);
    },
  };
}

function evidenceFacts({
  start_ms: _start,
  end_ms: _end,
  ...facts
}: SpeakerContextInterval) {
  return JSON.stringify(facts);
}

// The stored interval already states this evidence beyond the next poll.
function leaseStillCovers(
  context: ReturnType<typeof parseSpeakerContext>,
  observation: SpeakerContextInterval,
  at: number,
) {
  const last = context.intervals[context.intervals.length - 1];
  return Boolean(
    last &&
    last.start_ms <= observation.start_ms &&
    last.end_ms - at >= EVIDENCE_RENEWAL_MARGIN_MS &&
    evidenceFacts(last) === evidenceFacts(observation),
  );
}
