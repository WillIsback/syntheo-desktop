type ModelEntry = {
  id: string;
  isDownloaded?: boolean;
};

type PreferredProviderModelOptions = {
  allowSavedModelWithoutChoices?: boolean;
  keepUnavailableSavedModel?: boolean;
};

const DEFAULT_EXTERNAL_STT_MODELS: Record<string, string> = {
  local_file: "local-file",
  nvidia: "nemotron-asr-streaming",
};

// Providers that still exist. A selection saved with a removed cloud provider
// is cleared so the settings ask for an on-prem endpoint instead.
const KNOWN_STT_PROVIDERS = new Set([
  "anarlog",
  "soniqo",
  "apple_speech",
  "local_file",
  "openai",
  "nvidia",
]);

export function getDefaultSttModel(provider?: string | null) {
  return provider ? DEFAULT_EXTERNAL_STT_MODELS[provider] : undefined;
}

export function normalizeStoredSttSelection(
  provider: string | undefined,
  model: string | undefined,
) {
  // Chaîne vide et non undefined : value_json est TEXT NOT NULL en base.
  const cleared = { provider: "", model: "" };

  if (!provider) {
    return { provider, model };
  }

  if (provider === "anarlog") {
    if (model?.startsWith("soniqo-")) return { provider: "soniqo", model };
    if (model === "apple-speech") return { provider: "apple_speech", model };
    // Transcription hébergée par Anarlog : exige un compte, inexistant ici.
    return cleared;
  }

  if (!KNOWN_STT_PROVIDERS.has(provider)) {
    return cleared;
  }

  return { provider, model };
}

export function getPreferredProviderModel(
  savedModel: string | undefined,
  models: ModelEntry[],
  options?: PreferredProviderModelOptions,
) {
  const selectableModels = models.filter((model) => model.isDownloaded ?? true);

  if (
    options?.keepUnavailableSavedModel &&
    savedModel &&
    models.some((model) => model.id === savedModel)
  ) {
    return savedModel;
  }

  if (savedModel && selectableModels.some((model) => model.id === savedModel)) {
    return savedModel;
  }

  if (selectableModels.length > 0) {
    return selectableModels[0].id;
  }

  if (options?.allowSavedModelWithoutChoices) {
    return savedModel ?? "";
  }

  return "";
}
