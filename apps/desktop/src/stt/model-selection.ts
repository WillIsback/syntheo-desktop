type ModelEntry = {
  id: string;
  isDownloaded?: boolean;
};

type PreferredProviderModelOptions = {
  allowSavedModelWithoutChoices?: boolean;
  keepUnavailableSavedModel?: boolean;
};

// NVIDIA Speech NIM exposes no model catalogue (no `/v1/models`), so the
// realtime WebSocket server validates the model against the deployed container
// instead. List the ids the streaming ASR deployments accept as suggestions;
// any other id can still be typed by hand.
export const NVIDIA_NIM_ASR_MODELS = [
  "nemotron-asr-streaming",
  "parakeet-tdt-0.6b-v3",
  "parakeet-tdt-0.6b-v2",
  // Multilingual Nemotron ASR Streaming NIM (`type=multi`, fr-FR included).
  // Deployments that serve the multilingual container expose this id, which is
  // the one the realtime WebSocket accepts (`nemotron-asr-streaming` is only a
  // label the container no longer answers to directly).
  "cache-aware-parakeet-rnnt-multi-asr-streaming-sortformer",
] as const;

const DEFAULT_EXTERNAL_STT_MODELS: Record<string, string> = {
  nvidia: NVIDIA_NIM_ASR_MODELS[0],
};

// Providers that still exist. A selection saved with a removed cloud provider
// is cleared so the settings ask for an on-prem endpoint instead.
const KNOWN_STT_PROVIDERS = new Set(["openai", "nvidia"]);

export function getDefaultSttModel(provider?: string | null) {
  return provider ? DEFAULT_EXTERNAL_STT_MODELS[provider] : undefined;
}

// Native `<datalist>` suggestions for on-prem providers that cannot be
// discovered from the server. Empty means free text only.
export function getSttModelSuggestions(
  provider?: string | null,
): readonly string[] {
  return provider === "nvidia" ? NVIDIA_NIM_ASR_MODELS : [];
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
