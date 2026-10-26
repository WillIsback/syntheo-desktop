type PreferredProviderModelOptions = {
  allowSavedModelWithoutChoices?: boolean;
};

export function isSameModelSelection(
  provider: string | undefined,
  model: string | undefined,
  otherProvider: string | undefined,
  otherModel: string | undefined,
) {
  return provider === otherProvider && model === otherModel;
}

export function getPreferredProviderModel(
  savedModel: string | undefined,
  models: string[],
  options?: PreferredProviderModelOptions,
) {
  if (savedModel && models.includes(savedModel)) {
    return savedModel;
  }

  if (models.length > 0) {
    return models[0];
  }

  if (options?.allowSavedModelWithoutChoices) {
    return savedModel ?? "";
  }

  return "";
}

export async function getDefaultLlmSelection(
  providerIds: readonly string[],
  currentProvider: string | undefined,
  currentModel: string | undefined,
  loadModels: (provider: string) => Promise<string[]>,
) {
  for (const provider of providerIds) {
    try {
      const models = await loadModels(provider);
      const model = getPreferredProviderModel(
        provider === currentProvider ? currentModel : undefined,
        models,
        { allowSavedModelWithoutChoices: provider === "custom" },
      );

      if (model) {
        return { provider, model };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function shouldShowMissingModelWarning({
  isConfigured,
  isResolvingSelection,
  providerSettingsReady,
  settingsReady,
}: {
  isConfigured: boolean;
  isResolvingSelection: boolean;
  providerSettingsReady: boolean;
  settingsReady: boolean;
}) {
  return (
    providerSettingsReady &&
    settingsReady &&
    !isResolvingSelection &&
    !isConfigured
  );
}

// Une sélection enregistrée avec un provider LLM retiré est vidée : les
// réglages redemandent un serveur OpenAI-compatible on-premise.
export function normalizeStoredLlmSelection(
  provider: string | undefined,
  model: string | undefined,
) {
  // Chaîne vide et non undefined : value_json est TEXT NOT NULL en base.
  if (provider && provider !== "custom") return { provider: "", model: "" };
  return { provider, model };
}
