import { md2json } from "@syntheo/editor/markdown";
import type { SessionEvent } from "@syntheo/store";

import { liveQueryClient } from "~/db";
import { WELCOME_NOTE_TRACKING_ID } from "~/onboarding/welcome-note.constants";
import { createSession } from "~/session/queries";
import { DEFAULT_USER_ID } from "~/shared/utils";

const PENDING_WELCOME_SESSION_KEY = "syntheo.pending-welcome-session";

const WELCOME_NOTE = `Bienvenue sur Syntheo 👋

Cette note explique en quelques lignes comment Syntheo fonctionne.

Cliquez sur **Enregistrer** en haut à droite pour démarrer l'écoute. Syntheo capture votre microphone et l'audio système ; l'audio n'est jamais écrit sur disque.

Pour obtenir une transcription et un compte rendu, configurez un fournisseur de transcription dans les réglages. S'il n'est pas encore prêt, Syntheo affichera un raccourci de configuration.

Quand vous avez terminé, arrêtez l'écoute : si la transcription et l'intelligence sont configurées, Syntheo génère automatiquement votre résumé.`;

const WELCOME_NOTE_TITLE = "Bienvenue sur Syntheo";

let pendingWelcomeSession: Promise<string> | null = null;

export function getOrCreateWelcomeSession(): Promise<string> {
  if (!pendingWelcomeSession) {
    pendingWelcomeSession = findOrCreateWelcomeSession().finally(() => {
      pendingWelcomeSession = null;
    });
  }
  return pendingWelcomeSession;
}

export function setPendingWelcomeSession(sessionId: string | null) {
  if (sessionId) {
    localStorage.setItem(PENDING_WELCOME_SESSION_KEY, sessionId);
  } else {
    localStorage.removeItem(PENDING_WELCOME_SESSION_KEY);
  }
}

export function takePendingWelcomeSession(): string | null {
  const sessionId = localStorage.getItem(PENDING_WELCOME_SESSION_KEY);
  localStorage.removeItem(PENDING_WELCOME_SESSION_KEY);
  return sessionId;
}

async function findOrCreateWelcomeSession(): Promise<string> {
  const rows = await liveQueryClient.execute<{ id: string }>(
    `
      SELECT id
      FROM sessions
      WHERE deleted_at IS NULL
        AND CASE
          WHEN json_valid(event_json)
          THEN json_extract(event_json, '$.tracking_id')
        END = ?
      ORDER BY created_at, id
      LIMIT 1
    `,
    [WELCOME_NOTE_TRACKING_ID],
  );
  if (rows[0]) return rows[0].id;

  const now = new Date().toISOString();
  const event: SessionEvent = {
    tracking_id: WELCOME_NOTE_TRACKING_ID,
    calendar_id: "",
    title: WELCOME_NOTE_TITLE,
    started_at: now,
    ended_at: "",
    is_all_day: false,
    has_recurrence_rules: false,
    meeting_link: "",
    description: "Présentation rapide de Syntheo.",
  };

  return createSession(WELCOME_NOTE_TITLE, DEFAULT_USER_ID, {
    event_json: JSON.stringify(event),
    raw_md: JSON.stringify(md2json(WELCOME_NOTE)),
  });
}
