import { Trans, useLingui } from "@lingui/react/macro";
import { useCommandState } from "cmdk";
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CaretDown,
  CaretRight,
  Check,
  Star,
} from "@syntheo/ui/components/icons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@syntheo/ui/components/ui/command";
import {
  AppFloatingPanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@syntheo/ui/components/ui/popover";
import { cn } from "@syntheo/utils";

import type { UserTemplate } from "~/templates/queries";
import { useOpenTemplatesTab } from "~/templates/use-open-templates-tab";
import { AUTO_TEMPLATE_ID, groupUserTemplates } from "~/templates/utils";

/**
 * Sélecteur du type de réunion (le modèle du compte-rendu) de la fiche
 * Préparer : recherche sur le titre, la description et « Utilisé pour »,
 * groupé comme la liste des modèles (Par défaut, Mes favoris, Tous les
 * modèles). « Automatique » correspond à un identifiant vide.
 */
export function MeetingTypePicker({
  templates,
  selectedTemplateId,
  onSelect,
}: {
  templates: UserTemplate[];
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
}) {
  const { t } = useLingui();
  const openTemplatesTab = useOpenTemplatesTab();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedValue = selectedTemplateId || AUTO_TEMPLATE_ID;
  const selectedTemplate = templates.find(
    (template) => template.id === selectedTemplateId,
  );
  const autoLabel = t`Automatic`;
  const selectedLabel = selectedTemplateId
    ? selectedTemplate?.title?.trim() || t`Untitled`
    : autoLabel;

  const query = search.trim().toLowerCase();
  const showAuto =
    !query || autoLabel.toLowerCase().includes(query) || "auto".includes(query);
  const { favorites, others } = useMemo(
    () => groupUserTemplates(templates, search),
    [templates, search],
  );

  // L'élément actif (`aria-activedescendant`) reste celui que choisit cmdk :
  // le premier à l'ouverture et après chaque recherche. Une valeur contrôlée
  // ne mettrait pas `aria-activedescendant` à jour. Le type courant est
  // signalé par une coche, lue par les lecteurs d'écran.
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    setSearch("");
  }, []);

  const handleSelect = useCallback(
    (value: string) => {
      handleOpenChange(false);
      onSelect(value === AUTO_TEMPLATE_ID ? "" : value);
    },
    [handleOpenChange, onSelect],
  );

  const handleManageTemplates = useCallback(() => {
    handleOpenChange(false);
    openTemplatesTab({
      showHomepage: false,
      isWebMode: false,
      selectedMineId: selectedTemplateId || null,
      selectedWebIndex: null,
    });
  }, [handleOpenChange, openTemplatesTab, selectedTemplateId]);

  const renderItem = (
    value: string,
    label: string,
    options: { favorite?: boolean } = {},
  ) => (
    <CommandItem
      key={value}
      value={value}
      onSelect={handleSelect}
      className="cursor-pointer"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {options.favorite ? (
        <Star aria-hidden className="text-primary [&_path]:fill-current" />
      ) : null}
      {value === selectedValue ? (
        <Check
          role="img"
          aria-label={t`Current type`}
          className="text-primary"
        />
      ) : null}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t`Meeting type: ${selectedLabel}`}
          className={cn([
            "bg-border text-foreground hover:bg-accent hover:text-accent-foreground inline-flex max-w-full items-center gap-1 rounded-md px-2 py-px text-[15px] leading-normal transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
            "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
          ])}
        >
          <span className="truncate">{selectedLabel}</span>
          <CaretDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        variant="app"
        align="start"
        className="w-80"
        aria-label={t`Meeting type`}
      >
        <AppFloatingPanel className="overflow-hidden">
          <Command
            label={t`Search a meeting type`}
            shouldFilter={false}
            loop
            className="rounded-[inherit] border-0 bg-transparent"
          >
            <CommandInput
              ref={inputRef}
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={t`Search a meeting type`}
            />
            <ActiveDescendantSync inputRef={inputRef} listRef={listRef} />
            <CommandList ref={listRef} label={t`Meeting types`}>
              <CommandEmpty>
                <span className="text-muted-foreground">
                  <Trans>No meeting type found</Trans>
                </span>
              </CommandEmpty>
              {showAuto ? (
                <CommandGroup heading={t`Default`}>
                  {renderItem(AUTO_TEMPLATE_ID, autoLabel)}
                </CommandGroup>
              ) : null}
              {favorites.length > 0 ? (
                <CommandGroup heading={t`My favorites`}>
                  {favorites.map((template) =>
                    renderItem(
                      template.id,
                      template.title?.trim() || t`Untitled`,
                      { favorite: true },
                    ),
                  )}
                </CommandGroup>
              ) : null}
              {others.length > 0 ? (
                <CommandGroup heading={t`All templates`}>
                  {others.map((template) =>
                    renderItem(
                      template.id,
                      template.title?.trim() || t`Untitled`,
                    ),
                  )}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </AppFloatingPanel>
        <button
          type="button"
          onClick={handleManageTemplates}
          className={cn([
            "text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          ])}
        >
          <Trans>Manage templates</Trans>
          <CaretRight aria-hidden className="size-3.5" />
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * cmdk 1.1.1 ne renseigne `aria-activedescendant` qu'après une flèche : à
 * l'ouverture et après une recherche, l'élément actif est marqué
 * (`aria-selected`) mais le champ ne le désigne pas. On aligne l'attribut sur
 * l'élément actif à chaque changement de valeur ou de recherche.
 */
function ActiveDescendantSync({
  inputRef,
  listRef,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const value = useCommandState((state) => state.value);
  const search = useCommandState((state) => state.search);

  useLayoutEffect(() => {
    const active = listRef.current?.querySelector(
      "[cmdk-item][aria-selected='true']",
    );
    for (const element of [inputRef.current, listRef.current]) {
      if (!element) continue;
      if (active?.id) {
        element.setAttribute("aria-activedescendant", active.id);
      } else {
        element.removeAttribute("aria-activedescendant");
      }
    }
  }, [inputRef, listRef, search, value]);

  return null;
}
