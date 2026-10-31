import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";

import { parseWebTemplates, type WebTemplate } from "./codec";
import {
  useCreateTemplate,
  useDeleteTemplate,
  useToggleTemplateFavorite,
  useUserTemplates,
  type UserTemplate,
} from "./queries";

import { useWebResources } from "~/shared/ui/resource-list";
import { type Tab, useTabs } from "~/store/zustand/tabs";

export const AUTO_TEMPLATE_ID = "__auto__";

export function resolveTemplateTabSelection({
  isWebMode,
  selectedMineId,
  selectedWebIndex,
  userTemplates,
  webTemplates,
}: {
  isWebMode: boolean | null | undefined;
  selectedMineId: string | null | undefined;
  selectedWebIndex: number | null | undefined;
  userTemplates: UserTemplate[];
  webTemplates: WebTemplate[];
}) {
  const hasUserTemplates = userTemplates.length > 0;
  const hasWebTemplates = webTemplates.length > 0;

  let effectiveIsWebMode = isWebMode ?? (hasWebTemplates && !hasUserTemplates);

  if (effectiveIsWebMode && !hasWebTemplates) {
    effectiveIsWebMode = false;
  }

  if (!effectiveIsWebMode && !hasUserTemplates && hasWebTemplates) {
    effectiveIsWebMode = true;
  }

  if (effectiveIsWebMode) {
    const effectiveSelectedWebIndex =
      selectedWebIndex !== null &&
      selectedWebIndex !== undefined &&
      selectedWebIndex >= 0 &&
      selectedWebIndex < webTemplates.length
        ? selectedWebIndex
        : hasWebTemplates
          ? 0
          : null;

    return {
      isWebMode: true,
      selectedMineId: null,
      selectedWebIndex: effectiveSelectedWebIndex,
      selectedWebTemplate:
        effectiveSelectedWebIndex !== null
          ? (webTemplates[effectiveSelectedWebIndex] ?? null)
          : null,
    };
  }

  return {
    isWebMode: false,
    selectedMineId:
      selectedMineId === AUTO_TEMPLATE_ID
        ? AUTO_TEMPLATE_ID
        : (userTemplates.find((template) => template.id === selectedMineId)
            ?.id ??
          userTemplates[0]?.id ??
          AUTO_TEMPLATE_ID),
    selectedWebIndex: null,
    selectedWebTemplate: null,
  };
}

export function getTemplateCreatorLabel({
  isUserTemplate,
  creatorName,
  format = "full",
}: {
  isUserTemplate: boolean;
  creatorName?: string | null;
  format?: "full" | "short";
}) {
  const name = isUserTemplate
    ? creatorName?.trim() || translate`you`
    : "Syntheo";
  return format === "short"
    ? translate`by ${name}`
    : translate`Created by ${name}`;
}

export function filterWebTemplatesAgainstUserTemplates({
  userTemplates,
  webTemplates,
}: {
  userTemplates: Array<{ title?: string | null }>;
  webTemplates: WebTemplate[];
}) {
  const userTemplateTitles = new Set(
    userTemplates.flatMap((template) => {
      const title = normalizeTemplateTitle(template.title);
      return title ? [title] : [];
    }),
  );

  if (userTemplateTitles.size === 0) {
    return webTemplates;
  }

  return webTemplates.filter((template) => {
    const title = normalizeTemplateTitle(template.title);
    return !title || !userTemplateTitles.has(title);
  });
}

function templateMatchesSearch(template: UserTemplate, query: string) {
  return [
    template.title,
    template.description,
    template.category,
    ...(template.targets ?? []),
  ].some((value) => value?.toLowerCase().includes(query));
}

function compareTitles(a: { title?: string }, b: { title?: string }) {
  return (a.title || "").localeCompare(b.title || "", "fr");
}

/**
 * Répartit les modèles de l'utilisateur entre « Mes favoris » (épinglés, dans
 * l'ordre d'épinglage) et « Tous les modèles » (les autres, par ordre
 * alphabétique), après filtrage par la recherche.
 */
export function groupUserTemplates(
  userTemplates: UserTemplate[],
  search = "",
): { favorites: UserTemplate[]; others: UserTemplate[] } {
  const query = search.trim().toLowerCase();
  const visible = query
    ? userTemplates.filter((template) => templateMatchesSearch(template, query))
    : userTemplates;

  const favorites = visible
    .filter((template) => template.pinned)
    .sort(
      (a, b) =>
        (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity) ||
        compareTitles(a, b),
    );
  const others = visible
    .filter((template) => !template.pinned)
    .sort(compareTitles);

  return { favorites, others };
}

export function useTemplateTab(tab: Extract<Tab, { type: "templates" }>) {
  const { t } = useLingui();
  const updateTabState = useTabs((state) => state.updateTemplatesTabState);
  const userTemplates = useUserTemplates();
  const createTemplate = useCreateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const toggleTemplateFavorite = useToggleTemplateFavorite();
  const { data: rawWebTemplates = [], isLoading: isWebLoading } =
    useWebResources<Record<string, unknown>>("templates");
  const webTemplates = useMemo(
    () =>
      filterWebTemplatesAgainstUserTemplates({
        userTemplates,
        webTemplates: parseWebTemplates(rawWebTemplates),
      }),
    [rawWebTemplates, userTemplates],
  );

  const { isWebMode, selectedMineId, selectedWebIndex, selectedWebTemplate } =
    resolveTemplateTabSelection({
      isWebMode: tab.state.isWebMode,
      selectedMineId: tab.state.selectedMineId,
      selectedWebIndex: tab.state.selectedWebIndex,
      userTemplates,
      webTemplates,
    });

  const setSelectedMineId = useCallback(
    (id: string | null) => {
      updateTabState(tab, {
        ...tab.state,
        isWebMode: false,
        selectedMineId: id,
        selectedWebIndex: null,
      });
    },
    [updateTabState, tab],
  );

  const setSelectedWebIndex = useCallback(
    (index: number | null) => {
      updateTabState(tab, {
        ...tab.state,
        isWebMode: true,
        selectedMineId: null,
        selectedWebIndex: index,
      });
    },
    [updateTabState, tab],
  );

  const createDefaultTemplate = useCallback(async () => {
    const id = await createTemplate({
      title: t`New template`,
      description: "",
      sections: [],
    });

    if (id) {
      setSelectedMineId(id);
    }

    return id;
  }, [createTemplate, setSelectedMineId, t]);

  return {
    userTemplates,
    webTemplates,
    isWebLoading,
    isWebMode,
    selectedMineId,
    selectedWebIndex,
    selectedWebTemplate,
    setSelectedMineId,
    setSelectedWebIndex,
    createTemplate,
    createDefaultTemplate,
    deleteTemplate,
    toggleTemplateFavorite,
  };
}

function normalizeTemplateTitle(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
