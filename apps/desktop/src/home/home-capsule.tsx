import { Trans, useLingui } from "@lingui/react/macro";

import { cn } from "@syntheo/utils";

// Capsule de l'accueil, réduite à « Rechercher une note » (maquette piste C,
// écran Accueil). Même forme que la capsule de note (lot 2) : pilule
// `primary`, `shadow-capsule`, centrée en bas ; bouton fantôme à l'intérieur.
export function HomeCapsule({
  onSearch,
  modifierLabel = "Ctrl",
}: {
  onSearch: () => void;
  modifierLabel?: string;
}) {
  const { t } = useLingui();

  return (
    <div className="pointer-events-none absolute bottom-[22px] left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 justify-center">
      <div
        role="group"
        aria-label={t`Home capsule`}
        data-home-capsule
        className={cn([
          "bg-primary text-primary-foreground shadow-capsule rounded-pill pointer-events-auto",
          "flex max-w-full items-center gap-1.5 p-1.5 text-sm whitespace-nowrap",
        ])}
      >
        <button
          type="button"
          onClick={onSearch}
          aria-keyshortcuts={modifierLabel === "⌘" ? "Meta+K" : "Control+K"}
          className={cn([
            "rounded-pill hover:bg-primary-foreground/10 inline-flex items-center px-3.5 py-[7px] motion-safe:transition-colors",
            "focus-visible:ring-primary-foreground focus-visible:ring-offset-primary focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          ])}
        >
          <Trans>Search a note</Trans>
          <kbd
            aria-hidden="true"
            className="ml-1.5 font-[inherit] text-[11px] font-normal opacity-60"
          >
            {`${modifierLabel} K`}
          </kbd>
        </button>
      </div>
    </div>
  );
}
