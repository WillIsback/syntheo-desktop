import type { ReactNode } from "react";

// Titre de page des paramètres : Newsreader 36px (identite.md), suivi d'une
// phrase qui dit à quoi sert la page.
export function SettingsPageTitle({
  title,
  lede,
}: {
  title: ReactNode;
  lede?: ReactNode;
}) {
  return (
    <div>
      <h2 className="font-serif text-[36px] leading-[1.1] font-medium">
        {title}
      </h2>
      {lede ? <p className="text-muted-foreground mt-1.5">{lede}</p> : null}
    </div>
  );
}
