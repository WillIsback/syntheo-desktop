import { Trans, useLingui } from "@lingui/react/macro";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { MagnifyingGlass, Star, X } from "@syntheo/ui/components/icons";
import { cn } from "@syntheo/utils";

import { type WebTemplate } from "./codec";
import { getTemplateCopyTitle, type UserTemplate } from "./queries";
import { AUTO_TEMPLATE_ID, groupUserTemplates, useTemplateTab } from "./utils";

import { useConfigValue } from "~/shared/config";
import { useNativeContextMenu } from "~/shared/hooks/useNativeContextMenu";
import { CustomSidebarHeader } from "~/sidebar/custom-sidebar-header";
import { type Tab } from "~/store/zustand/tabs";

type ListEntry =
  | { source: "auto"; key: string; selected: boolean }
  | { source: "user"; key: string; selected: boolean; template: UserTemplate }
  | {
      source: "web";
      key: string;
      selected: boolean;
      index: number;
      template: WebTemplate;
    };

/**
 * Liste des modèles, rangée en trois groupes : « Par défaut » (Automatique),
 * « Mes favoris » (modèles épinglés) et « Tous les modèles ».
 */
export function TemplatesSidebarContent({
  tab,
}: {
  tab: Extract<Tab, { type: "templates" }>;
}) {
  const { t } = useLingui();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const autoPrompt = useConfigValue("auto_summary_prompt");
  const defaultTemplateId = useConfigValue("selected_template_id");

  const {
    userTemplates,
    webTemplates,
    isWebMode,
    selectedMineId,
    selectedWebIndex,
    setSelectedMineId,
    setSelectedWebIndex,
    createTemplate,
    createDefaultTemplate,
    deleteTemplate,
    toggleTemplateFavorite,
  } = useTemplateTab(tab);

  const handleDuplicateTemplate = useCallback(
    async (template: UserTemplate) => {
      const id = await createTemplate({
        title: getTemplateCopyTitle(template.title),
        description: template.description ?? "",
        category: template.category,
        icon: template.icon,
        targets: template.targets,
        sections: template.sections.map((section) => ({ ...section })),
      });

      if (id) {
        setSelectedMineId(id);
      }
    },
    [createTemplate, setSelectedMineId],
  );

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      await deleteTemplate(id);

      if (selectedMineId === id) {
        setSelectedMineId(null);
      }
    },
    [deleteTemplate, selectedMineId, setSelectedMineId],
  );

  const query = search.trim().toLowerCase();
  const autoLabel = t`Automatic`;
  const showAuto =
    !query || autoLabel.toLowerCase().includes(query) || "auto".includes(query);

  const { favorites, others } = useMemo(
    () => groupUserTemplates(userTemplates, search),
    [userTemplates, search],
  );

  const filteredWeb = useMemo(
    () =>
      webTemplates.flatMap((template, index) => {
        const matches =
          !query ||
          [
            template.title,
            template.description,
            template.category,
            ...(template.targets ?? []),
          ].some((value) => value?.toLowerCase().includes(query));
        return matches ? [{ template, index }] : [];
      }),
    [query, webTemplates],
  );

  const groups = useMemo(() => {
    const auto: ListEntry[] = showAuto
      ? [
          {
            source: "auto",
            key: AUTO_TEMPLATE_ID,
            selected: !isWebMode && selectedMineId === AUTO_TEMPLATE_ID,
          },
        ]
      : [];
    const toUserEntry = (template: UserTemplate): ListEntry => ({
      source: "user",
      key: template.id,
      selected: !isWebMode && selectedMineId === template.id,
      template,
    });
    const web: ListEntry[] = filteredWeb.map(({ template, index }) => ({
      source: "web",
      key: template.slug || `web-${index}`,
      selected: isWebMode && selectedWebIndex === index,
      index,
      template,
    }));

    return [
      { id: "default", label: t`Default`, entries: auto },
      {
        id: "favorites",
        label: t`My favorites`,
        entries: favorites.map(toUserEntry),
      },
      {
        id: "all",
        label: t`All templates`,
        entries: [...others.map(toUserEntry), ...web],
      },
    ].filter((group) => group.entries.length > 0);
  }, [
    favorites,
    filteredWeb,
    isWebMode,
    others,
    selectedMineId,
    selectedWebIndex,
    showAuto,
    t,
  ]);

  const flatEntries = useMemo(
    () => groups.flatMap((group) => group.entries),
    [groups],
  );

  const selectEntry = useCallback(
    (entry: ListEntry) => {
      if (entry.source === "auto") {
        setSelectedMineId(AUTO_TEMPLATE_ID);
      } else if (entry.source === "user") {
        setSelectedMineId(entry.template.id);
      } else {
        setSelectedWebIndex(entry.index);
      }
    },
    [setSelectedMineId, setSelectedWebIndex],
  );

  // Alt + flèches : passer au modèle précédent ou suivant depuis l'éditeur.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        (event.key !== "ArrowUp" && event.key !== "ArrowDown")
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }

      if (flatEntries.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentIndex = flatEntries.findIndex((entry) => entry.selected);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        currentIndex === -1
          ? step === 1
            ? 0
            : flatEntries.length - 1
          : Math.max(0, Math.min(flatEntries.length - 1, currentIndex + step));

      const nextEntry = flatEntries[nextIndex];
      if (nextEntry && nextIndex !== currentIndex) {
        selectEntry(nextEntry);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [flatEntries, selectEntry]);

  useEffect(() => {
    const selectedElement = scrollContainerRef.current?.querySelector(
      "[data-template-selected='true']",
    );
    if (selectedElement instanceof HTMLElement) {
      selectedElement.scrollIntoView({ block: "nearest" });
    }
  }, [selectedMineId, selectedWebIndex]);

  const isEmpty = flatEntries.length === 0;
  const hasNoTemplates =
    userTemplates.length === 0 && webTemplates.length === 0;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <CustomSidebarHeader />

      <div className="pb-3">
        <div className="border-border bg-card focus-within:ring-ring/50 flex h-8 w-full items-center gap-2 rounded-lg border px-2.5 focus-within:ring-2">
          <MagnifyingGlass
            aria-hidden="true"
            className="text-faint size-4 shrink-0"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
              }
            }}
            aria-label={t`Search templates`}
            placeholder={t`Search a template`}
            className="placeholder:text-faint min-w-0 flex-1 bg-transparent text-sm outline-hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-faint hover:text-foreground shrink-0"
              aria-label={t`Clear search`}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      <nav
        ref={scrollContainerRef}
        aria-label={t`Templates`}
        className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto"
      >
        {isEmpty ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {search && !hasNoTemplates ? (
              <Trans>No template found</Trans>
            ) : (
              <Trans>No templates yet</Trans>
            )}
          </p>
        ) : (
          groups.map((group) => (
            <TemplateGroup key={group.id} label={group.label}>
              {group.entries.map((entry) =>
                entry.source === "auto" ? (
                  <TemplateListButton
                    key={entry.key}
                    selected={entry.selected}
                    onSelect={() => selectEntry(entry)}
                    label={autoLabel}
                    meta={
                      autoPrompt.trim() ? (
                        <span className="text-faint text-xs">
                          <Trans>customized</Trans>
                        </span>
                      ) : null
                    }
                  />
                ) : entry.source === "user" ? (
                  <UserTemplateListItem
                    key={entry.key}
                    template={entry.template}
                    selected={entry.selected}
                    isDefault={defaultTemplateId === entry.template.id}
                    onSelect={setSelectedMineId}
                    onToggleFavorite={toggleTemplateFavorite}
                    onDuplicate={handleDuplicateTemplate}
                    onDelete={handleDeleteTemplate}
                  />
                ) : (
                  <TemplateListButton
                    key={entry.key}
                    selected={entry.selected}
                    onSelect={() => selectEntry(entry)}
                    label={entry.template.title?.trim() || t`Untitled`}
                  />
                ),
              )}
            </TemplateGroup>
          ))
        )}
      </nav>

      <button
        type="button"
        onClick={() => void createDefaultTemplate()}
        className="border-input bg-card hover:bg-muted focus-visible:ring-ring/50 mt-3 flex h-9 w-full shrink-0 items-center justify-center rounded-lg border text-sm font-medium outline-hidden focus-visible:ring-2"
      >
        <Trans>+ New template</Trans>
      </button>
    </div>
  );
}

function TemplateGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col">
      <h3
        id={labelId}
        className="text-faint px-2 pb-1 text-[11px] font-semibold tracking-[0.08em] uppercase"
      >
        {label}
      </h3>
      {children}
    </div>
  );
}

function TemplateListButton({
  label,
  selected,
  onSelect,
  onContextMenu,
  meta,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  meta?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      aria-current={selected ? "true" : undefined}
      data-template-selected={selected}
      className={cn([
        "focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-sm outline-hidden select-none focus-visible:ring-2",
        selected
          ? "bg-accent text-accent-foreground font-semibold"
          : "hover:bg-muted",
      ])}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta}
    </button>
  );
}

function UserTemplateListItem({
  template,
  selected,
  isDefault,
  onSelect,
  onToggleFavorite,
  onDuplicate,
  onDelete,
}: {
  template: UserTemplate;
  selected: boolean;
  isDefault: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void | Promise<void>;
  onDuplicate: (template: UserTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLingui();
  const contextMenu = useMemo(
    () => [
      {
        id: `favorite-template-${template.id}`,
        text: template.pinned ? t`Remove from favorites` : t`Add to favorites`,
        action: () => void onToggleFavorite(template.id),
      },
      { separator: true as const },
      {
        id: `duplicate-template-${template.id}`,
        text: t`Duplicate`,
        action: () => onDuplicate(template),
      },
      {
        id: `delete-template-${template.id}`,
        text: t`Delete`,
        action: () => onDelete(template.id),
      },
    ],
    [onDelete, onDuplicate, onToggleFavorite, t, template],
  );
  const showContextMenu = useNativeContextMenu(contextMenu);

  return (
    <TemplateListButton
      label={template.title?.trim() || t`Untitled`}
      selected={selected}
      onSelect={() => onSelect(template.id)}
      onContextMenu={(event) => {
        onSelect(template.id);
        void showContextMenu(event);
      }}
      meta={
        <>
          {isDefault ? (
            <span className="text-faint text-xs font-normal">
              <Trans>default</Trans>
            </span>
          ) : null}
          {template.pinned ? (
            <Star
              className="text-primary size-3 shrink-0 [&_path]:fill-current"
              aria-label={t`In favorites`}
            />
          ) : null}
        </>
      }
    />
  );
}
