import { useMemo } from "react";

import type { AIProviderStorage } from "@anlg/store";

import { type ProviderId, PROVIDERS } from "~/settings/ai/stt/shared";
import { useAiProvidersState } from "~/settings/providers";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";

export const useSTTConnection = () => {
  const settingsReady = useSettingsReady();
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const) as {
    current_stt_provider: ProviderId | undefined;
    current_stt_model: string | undefined;
  };

  const { providers, isReady: providerConfigReady } =
    useAiProvidersState("stt");
  const providerConfig = (
    current_stt_provider ? providers[`stt:${current_stt_provider}`] : undefined
  ) as AIProviderStorage | undefined;

  const connection = useMemo(() => {
    if (!current_stt_provider || !current_stt_model) {
      return null;
    }

    // Un réglage hérité peut désigner un provider retiré ou désactivé : aucune
    // connexion, même si sa configuration (URL cloud, clé) est encore stockée.
    const provider = PROVIDERS.find(({ id }) => id === current_stt_provider);
    if (!provider || provider.disabled) {
      return null;
    }

    // L'URL enregistrée prime ; à défaut, le préréglage du provider s'applique
    // (Nemotron ASR sur le DGX), sans qu'une ligne stt:<id> soit nécessaire.
    const baseUrl =
      providerConfig?.base_url?.trim() || provider.baseUrl?.trim() || "";

    // Les endpoints on-prem n'exigent pas forcément de clé.
    if (!baseUrl) {
      return null;
    }

    // Le protocole est désigné explicitement : un hôte on-prem ne permet pas
    // de le deviner.
    const url = new URL(baseUrl);
    url.searchParams.set("provider", current_stt_provider);
    return {
      provider: current_stt_provider,
      model: current_stt_model,
      baseUrl: url.toString(),
      apiKey: providerConfig?.api_key?.trim() ?? "",
    };
  }, [current_stt_provider, current_stt_model, providerConfig]);

  return {
    conn: connection,
    isReady: settingsReady && connection !== null && providerConfigReady,
  };
};
