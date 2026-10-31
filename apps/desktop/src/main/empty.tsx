import { HomePage } from "~/home";
import { StandardContentWrapper } from "~/shared/main";
import { type Tab } from "~/store/zustand/tabs";

// Onglet « empty » = accueil guidé (lot 1). La capsule de l'accueil est
// rendue par HomePage : une seule capsule par fenêtre.
export function TabContentEmpty({
  tab: _tab,
}: {
  tab: Extract<Tab, { type: "empty" }>;
}) {
  return (
    <StandardContentWrapper>
      <HomePage />
    </StandardContentWrapper>
  );
}
