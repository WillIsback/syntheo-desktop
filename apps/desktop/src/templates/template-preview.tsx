import { Trans, useLingui } from "@lingui/react/macro";

import type { TemplateSection } from "@syntheo/store";

/**
 * Mode « Aperçu » : la forme de la synthèse que produira le modèle.
 * Les consignes sont en `faint`, le texte que Syntheo rédigera en `ai-ink`.
 */
export function TemplatePreview({
  title,
  sections,
  date = new Date(),
}: {
  title: string;
  sections: TemplateSection[];
  date?: Date;
}) {
  const { t, i18n } = useLingui();
  const day = i18n.date(date, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const heading = `${title.trim() || t`Untitled`} · ${day}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground flex flex-wrap gap-4 text-[13px]">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="bg-ai-ink inline-block size-2.5 rounded-[2px]"
          />
          <Trans>Written by Syntheo</Trans>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="bg-faint inline-block size-2.5 rounded-[2px]"
          />
          <Trans>Template instruction</Trans>
        </span>
      </div>

      <article
        aria-label={t`Summary preview`}
        className="border-border bg-card flex flex-col gap-2 rounded-[14px] border px-7 py-6"
      >
        <h2 className="font-serif text-[28px] leading-tight font-medium">
          {heading}
        </h2>
        {sections.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Trans>Add sections to see the shape of the summary.</Trans>
          </p>
        ) : (
          sections.map((section, index) => (
            <section key={index} className="flex flex-col gap-1">
              <h3 className="mt-2 font-serif text-[22px] leading-[1.35] font-medium">
                {section.title.trim() || t`Untitled section`}
              </h3>
              {section.description.trim() ? (
                <p className="text-muted-foreground text-sm whitespace-pre-line italic">
                  {section.description}
                </p>
              ) : null}
              <p className="text-ai-ink text-[15px]">
                <Trans>— Sample line written from this instruction.</Trans>
              </p>
            </section>
          ))
        )}
      </article>
    </div>
  );
}
