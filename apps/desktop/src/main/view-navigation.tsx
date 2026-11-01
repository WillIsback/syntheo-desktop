import { useLingui } from "@lingui/react/macro";
import { type ReactNode } from "react";

import { VIEW_NAVIGATION_WIDTH_PX } from "~/shared/main/layout-widths";
import { AutomationsNav } from "~/sidebar/automations";
import { CalendarNav } from "~/sidebar/calendar";
import { ContactsNav } from "~/sidebar/contacts";
import { FoldersNav } from "~/sidebar/folders";
import { SettingsNav } from "~/sidebar/settings";
import { TemplatesNav } from "~/sidebar/templates";
import type { Tab } from "~/store/zustand/tabs";

// Sans barre latérale permanente, ces vues portent leur propre navigation :
// une colonne fixe à gauche, dans la zone de contenu, avec un retour vers
// l'accueil (ou vers la note d'origine).
const VIEW_NAVIGATION_TAB_TYPES = [
  "settings",
  "calendar",
  "contacts",
  "templates",
  "automations",
  "folders",
] as const satisfies readonly Tab["type"][];

type ViewNavigationTabType = (typeof VIEW_NAVIGATION_TAB_TYPES)[number];

export { VIEW_NAVIGATION_WIDTH_PX };

export function hasViewNavigation(
  tab: Pick<Tab, "type"> | null,
): tab is Pick<Tab, "type"> & { type: ViewNavigationTabType } {
  return (
    tab !== null &&
    (VIEW_NAVIGATION_TAB_TYPES as readonly Tab["type"][]).includes(tab.type)
  );
}

function ViewNavigationContent({ type }: { type: ViewNavigationTabType }) {
  switch (type) {
    case "settings":
      return <SettingsNav />;
    case "calendar":
      return <CalendarNav />;
    case "contacts":
      return <ContactsNav />;
    case "templates":
      return <TemplatesNav />;
    case "automations":
      return <AutomationsNav />;
    case "folders":
      return <FoldersNav />;
  }
}

export function ViewNavigationLayout({
  tab,
  children,
}: {
  tab: Pick<Tab, "type">;
  children: ReactNode;
}) {
  const { t } = useLingui();

  if (!hasViewNavigation(tab)) {
    return <>{children}</>;
  }

  return (
    <div data-view-navigation-layout className="flex h-full min-h-0 min-w-0">
      <aside
        aria-label={t`View navigation`}
        data-view-navigation={tab.type}
        style={{ width: VIEW_NAVIGATION_WIDTH_PX }}
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden pr-1"
      >
        <ViewNavigationContent type={tab.type} />
      </aside>
      <div className="relative h-full min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
