import {
  commands as listenerCommands,
  type TranscriptionMode,
} from "@anlg/plugin-transcription";

type LiveTranscriptionConfig = {
  languages: string[];
  omittedLanguages?: string[];
  transcriptionMode?: TranscriptionMode;
};

export function isConfiguredSttModel(
  provider?: string | null,
  model?: string | null,
) {
  return !!provider && !!model;
}

export function getSttModelTranscriptionMode(
  provider?: string | null,
  model?: string | null,
): TranscriptionMode | undefined {
  if (provider === "nvidia") return "live";

  // Comme côté Rust (OpenAIAdapter::is_batch_only_model) : seuls les modèles
  // fichier de l'API OpenAI passent en batch ; un modèle on-prem (Voxtral sur
  // vLLM...) diffuse en temps réel.
  if (provider === "openai" && model) {
    return OPENAI_FILE_MODELS.has(model) ? "batch" : "live";
  }

  return undefined;
}

const OPENAI_FILE_MODELS = new Set([
  "whisper-1",
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
  "gpt-4o-transcribe-diarize",
]);

function baseLanguageCode(language: string) {
  return language.split(/[-_]/)[0]?.toLowerCase() ?? "";
}

export async function isSupportedLanguagesLive(
  provider: string,
  model: string | null | undefined,
  languages: readonly string[],
) {
  const result = await listenerCommands.isSupportedLanguagesLive(
    provider,
    model ?? null,
    [...languages],
  );

  return result.status === "ok" ? result.data : true;
}

export async function isSupportedLanguagesBatch(
  provider: string,
  model: string | null | undefined,
  languages: readonly string[],
) {
  const result = await listenerCommands.isSupportedLanguagesBatch(
    provider,
    model ?? null,
    [...languages],
  );

  return result.status === "ok" ? result.data : true;
}

export function getTranscriptionLanguages(
  mainLanguage: string | null | undefined,
  spokenLanguages: readonly string[] | null | undefined,
) {
  const seen = new Set<string>();
  const languages: string[] = [];

  for (const language of [mainLanguage, ...(spokenLanguages ?? [])]) {
    if (!language) {
      continue;
    }

    const baseCode = baseLanguageCode(language);
    if (!baseCode || seen.has(baseCode)) {
      continue;
    }

    seen.add(baseCode);
    languages.push(language);
  }

  return languages;
}

export async function getLiveTranscriptionConfig({
  provider,
  model,
  languages,
}: {
  provider?: string | null;
  model?: string | null;
  languages: readonly string[];
}): Promise<LiveTranscriptionConfig> {
  const config = {
    languages: [...languages],
    transcriptionMode: getSttModelTranscriptionMode(provider, model),
  } satisfies LiveTranscriptionConfig;

  if (
    !provider ||
    config.transcriptionMode === "batch" ||
    languages.length <= 1
  ) {
    return config;
  }

  if (await isSupportedLanguagesLive(provider, model, languages)) {
    return config;
  }

  const primaryLanguage = languages[0];
  if (
    primaryLanguage &&
    (await isSupportedLanguagesLive(provider, model, [primaryLanguage]))
  ) {
    return {
      ...config,
      languages: [primaryLanguage],
      omittedLanguages: languages.slice(1),
    };
  }

  return config;
}

export async function isLiveTranscriptionSupported(
  provider?: string | null,
  model?: string | null,
) {
  if (!provider || !model) {
    return false;
  }

  return isSupportedLanguagesLive(provider, model, []);
}
