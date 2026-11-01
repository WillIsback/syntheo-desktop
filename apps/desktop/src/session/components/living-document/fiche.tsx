import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, type ReactNode } from "react";

import { cn } from "@syntheo/utils";

import { MeetingTypePicker } from "./meeting-type-picker";

import { ParticipantInput } from "~/session/components/outer-header/metadata/participants/input";
import { useSession } from "~/session/queries";
import { getBaseLanguageDisplayName } from "~/settings/general/language";
import { useConfigValue } from "~/shared/config";
import { useUserTemplates } from "~/templates";

export function PrepareFiche({
  sessionId,
  onSelectTemplate,
}: {
  sessionId: string;
  onSelectTemplate: (templateId: string) => void;
}) {
  const selectedTemplateId = useSession(sessionId)?.raw_template_id ?? "";
  const templates = useUserTemplates();

  return (
    <dl
      data-note-fiche
      className="border-border grid grid-cols-[130px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 border-y py-4 text-[15px]"
    >
      <dt className="text-muted-foreground">
        <Trans>Type</Trans>
      </dt>
      <dd className="m-0 flex min-w-0 flex-wrap gap-1.5">
        <MeetingTypePicker
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          onSelect={onSelectTemplate}
        />
      </dd>
      <dt className="text-muted-foreground">
        <Trans>Participants</Trans>
      </dt>
      <dd className="m-0 min-w-0">
        <ParticipantInput sessionId={sessionId} />
      </dd>
      <dt className="text-muted-foreground">
        <Trans>Listening</Trans>
      </dt>
      <dd className="m-0 flex flex-wrap gap-1.5">
        <ListeningSources />
      </dd>
    </dl>
  );
}

function ListeningSources() {
  const { i18n } = useLingui();
  const spokenLanguages = useConfigValue("spoken_languages");
  const languages = useMemo(
    () =>
      (Array.isArray(spokenLanguages) ? spokenLanguages : [])
        .map((code) => getBaseLanguageDisplayName(String(code), i18n.locale))
        .map((name) => name.charAt(0).toLocaleUpperCase() + name.slice(1)),
    [i18n.locale, spokenLanguages],
  );

  return (
    <>
      <FicheTag>
        <Trans>Mic</Trans>
      </FicheTag>
      <FicheTag>
        <Trans>Computer audio</Trans>
      </FicheTag>
      {languages.map((language) => (
        <FicheTag key={language}>{language}</FicheTag>
      ))}
    </>
  );
}

const tokenClassName =
  "rounded-md px-2 py-px text-[15px] leading-normal transition-colors";

function FicheTag({ children }: { children: ReactNode }) {
  return (
    <span className={cn([tokenClassName, "bg-border text-foreground"])}>
      {children}
    </span>
  );
}
