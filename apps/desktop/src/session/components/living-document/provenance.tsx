import { Trans, useLingui } from "@lingui/react/macro";

// Légende « qui a écrit quoi » : vos notes en user-ink (vert), ce que
// Syntheo complète à l'encre foreground (jamais en italique ni en gris).
export function ProvenanceLegend() {
  const { t } = useLingui();

  return (
    <p
      data-provenance-legend
      aria-label={t`Text provenance`}
      className="text-muted-foreground flex items-center gap-4 text-[13px]"
    >
      <span className="text-user-ink flex items-center">
        <i
          aria-hidden="true"
          className="bg-user-ink mr-1.5 inline-block size-2.5 rounded-[2px]"
        />
        <Trans>Your notes</Trans>
      </span>
      <span className="text-foreground flex items-center">
        <i
          aria-hidden="true"
          className="bg-foreground mr-1.5 inline-block size-2.5 rounded-[2px]"
        />
        <Trans>Completed by Syntheo</Trans>
      </span>
    </p>
  );
}

// Sceau 記 (« consigné ») en bas à droite du compte-rendu terminé.
// Clin d'œil purement décoratif : toujours aria-hidden.
export function NoteSeal() {
  return (
    <span
      aria-hidden="true"
      data-note-seal
      className="border-seal text-seal font-kanji mt-2 grid size-[46px] shrink-0 -rotate-5 place-items-center self-end rounded-[7px] border-2 text-[25px] leading-none font-bold opacity-85 select-none"
    >
      記
    </span>
  );
}
