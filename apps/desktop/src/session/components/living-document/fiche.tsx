import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, type ReactNode } from "react";

import { cn } from "@syntheo/utils";

import { ParticipantInput } from "~/session/components/outer-header/metadata/participants/input";
import { useSession } from "~/session/queries";
import { getBaseLanguageDisplayName } from "~/settings/general/language";
import { useConfigValue } from "~/shared/config";
import { type UserTemplate, useUserTemplates } from "~/templates";

const MAX_TYPE_TOKENS = 5;
const DEFAULT_TYPE_TEMPLATE_IDS = [
  "default-daily-standup",
  "default-one-on-one-meeting",
  "default-project-kickoff",
  "default-sales-discovery-call",
];

// Types de réunion proposés : le modèle choisi, les favoris, puis quelques
// modèles par défaut. « Automatique » laisse Syntheo choisir.
export function getMeetingTypeTemplates(
  templates: readonly UserTemplate[],
  selectedTemplateId: string,
): UserTemplate[] {
  const selected = templates.find(
    (template) => template.id === selectedTemplateId,
  );
  const pinned = templates
    .filter((template) => template.pinned)
    .sort(
      (a, b) =>
        (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity) ||
        (a.title || "").localeCompare(b.title || ""),
    );
  const defaults = DEFAULT_TYPE_TEMPLATE_IDS.flatMap((id) => {
    const template = templates.find((candidate) => candidate.id === id);
    return template ? [template] : [];
  });
  const seen = new Set<string>();

  return [...(selected ? [selected] : []), ...pinned, ...defaults]
    .filter((template) => {
      if (seen.has(template.id)) return false;
      seen.add(template.id);
      return true;
    })
    .slice(0, MAX_TYPE_TOKENS);
}

export function PrepareFiche({
  sessionId,
  onSelectTemplate,
}: {
  sessionId: string;
  onSelectTemplate: (templateId: string) => void;
}) {
  const { t } = useLingui();
  const selectedTemplateId = useSession(sessionId)?.raw_template_id ?? "";
  const templates = useUserTemplates();
  const typeTemplates = useMemo(
    () => getMeetingTypeTemplates(templates, selectedTemplateId),
    [selectedTemplateId, templates],
  );

  return (
    <dl
      data-note-fiche
      className="border-border grid grid-cols-[130px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 border-y py-4 text-[15px]"
    >
      <dt className="text-muted-foreground">
        <Trans>Type</Trans>
      </dt>
      <dd
        role="group"
        aria-label={t`Meeting type`}
        className="m-0 flex flex-wrap gap-1.5"
      >
        <FicheToken
          pressed={selectedTemplateId === ""}
          onClick={() => onSelectTemplate("")}
        >
          <Trans>Automatic</Trans>
        </FicheToken>
        {typeTemplates.map((template) => (
          <FicheToken
            key={template.id}
            pressed={selectedTemplateId === template.id}
            onClick={() => onSelectTemplate(template.id)}
          >
            {template.title || t`Untitled`}
          </FicheToken>
        ))}
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

function FicheToken({
  children,
  pressed,
  onClick,
}: {
  children: ReactNode;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn([
        tokenClassName,
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
        pressed
          ? "bg-primary text-primary-foreground"
          : "bg-border text-foreground hover:bg-accent hover:text-accent-foreground",
      ])}
    >
      {children}
    </button>
  );
}
