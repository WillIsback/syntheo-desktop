import { useLingui } from "@lingui/react/macro";
import { useMemo, type ReactNode } from "react";

import { safeParseDate } from "@syntheo/utils";

import { useSessionEvent } from "~/session/hooks/useSessionEvent";
import { useSession } from "~/session/queries";
import { useSessionParticipants } from "~/session/queries/participants";
import { useUserTemplate } from "~/templates";

export function formatNoteDate(date: Date, locale: string) {
  const day = date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day.charAt(0).toLocaleUpperCase()}${day.slice(1)} · ${time}`;
}

// Ligne de métadonnées sous le titre : date, type de réunion, participants.
export function NoteMeta({
  sessionId,
  children,
}: {
  sessionId: string;
  children?: ReactNode;
}) {
  const { i18n } = useLingui();
  const session = useSession(sessionId);
  const event = useSessionEvent(sessionId);
  const templateId = session?.raw_template_id || null;
  const { data: template } = useUserTemplate(templateId);
  const participants = useSessionParticipants(sessionId);
  const date = useMemo(() => {
    const parsed = safeParseDate(event?.started_at ?? session?.created_at);
    return parsed ? formatNoteDate(parsed, i18n.locale) : null;
  }, [event?.started_at, i18n.locale, session?.created_at]);
  const typeTitle = template?.title?.trim() || null;
  const names = participants
    .map((participant) => participant.name?.trim())
    .filter((name): name is string => Boolean(name));

  return (
    <div
      data-note-meta
      className="text-muted-foreground flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm"
    >
      {date ? <span>{date}</span> : null}
      {typeTitle ? <MetaTag>{typeTitle}</MetaTag> : null}
      {names.map((name) => (
        <MetaTag key={name}>{name}</MetaTag>
      ))}
      {children ? (
        <span className="ml-auto flex items-center gap-1.5">{children}</span>
      ) : null}
    </div>
  );
}

function MetaTag({ children }: { children: ReactNode }) {
  return (
    <span className="border-border text-foreground rounded-md border px-2 py-0.5">
      {children}
    </span>
  );
}
