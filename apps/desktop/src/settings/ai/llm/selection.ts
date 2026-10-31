type PreferredProviderModelOptions = {
  allowSavedModelWithoutChoices?: boolean;
};

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
