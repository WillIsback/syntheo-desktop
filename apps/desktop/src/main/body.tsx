import { useMainAreaTopWindowDrag } from "./main-area-window-drag";
import { ClassicMainTabContent } from "./tab-content";
import { useClassicMainShortcuts } from "./useShortcuts";
import {
  hasViewNavigation,
  VIEW_NAVIGATION_WIDTH_PX,
  ViewNavigationLayout,
} from "./view-navigation";

import {
  boundedMinWidthPx,
  getMainContentMinWidth,
} from "~/shared/main/layout-widths";
import { type Tab, uniqueIdfromTab, useTabs } from "~/store/zustand/tabs";

// Plus de barre latérale permanente : le corps affiche l'onglet courant sur
// toute la largeur. Les vues qui ont besoin d'une navigation (Paramètres,
// Modèles, Calendrier, Contacts, Dossiers, Automatisations) la portent dans
// leur zone de contenu via `ViewNavigationLayout`. L'historique des notes
// passe par l'accueil et la palette `Ctrl K`.
export function ClassicMainBody() {
  const currentTab = useTabs((state) => state.currentTab);
  useClassicMainShortcuts();

  const isOnboarding = currentTab?.type === "onboarding";
  const mainAreaTopDrag = useMainAreaTopWindowDrag(!isOnboarding);
  const contentMinWidth = getMainContentMinWidth(currentTab);
  const minWidth =
    contentMinWidth == null
      ? undefined
      : boundedMinWidthPx(
          contentMinWidth +
            (hasViewNavigation(currentTab) ? VIEW_NAVIGATION_WIDTH_PX : 0),
        );

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div
        data-main-content-panel
        className="relative h-full min-h-0 min-w-0 flex-1 overflow-auto"
        style={{ minWidth }}
        onClickCapture={mainAreaTopDrag.onClickCapture}
        onDoubleClickCapture={mainAreaTopDrag.onDoubleClickCapture}
        onPointerCancel={mainAreaTopDrag.onPointerEnd}
        onPointerDown={mainAreaTopDrag.onPointerDown}
        onPointerMove={mainAreaTopDrag.onPointerMove}
        onPointerUp={mainAreaTopDrag.onPointerEnd}
      >
        {currentTab ? (
          <ViewNavigationLayout tab={currentTab}>
            <ClassicMainTabContent
              key={uniqueIdfromTab(currentTab)}
              tab={currentTab as Tab}
            />
          </ViewNavigationLayout>
        ) : null}
      </div>
    </div>
  );
}
