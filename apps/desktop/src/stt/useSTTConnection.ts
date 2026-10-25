import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { commands as localSttCommands } from "@anlg/plugin-local-stt";
import type { AIProviderStorage } from "@anlg/store";

import { useBillingAccess } from "~/billing/billing-context";
import { type ProviderId, PROVIDERS } from "~/settings/ai/stt/shared";
import { useAiProvidersState } from "~/settings/providers";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";
import {
  isAnarlogCloudSttModel,
  isLocalFileSttModel,
  isOnDeviceSttModel,
  isRealtimeLocalModel,
} from "~/stt/capabilities";
import { localSttQueries } from "~/stt/useLocalSttModel";

export const useSTTConnection = () => {
  const billing = useBillingAccess();
  const settingsReady = useSettingsReady();
  const { current_stt_provider, current_stt_model, local_stt_model_path } =
    useConfigValues([
      "current_stt_provider",
      "current_stt_model",
      "local_stt_model_path",
    ] as const) as {
      current_stt_provider: ProviderId | undefined;
      current_stt_model: string | undefined;
      local_stt_model_path: string | undefined;
    };

  const { providers, isReady: providerConfigReady } =
    useAiProvidersState("stt");
  const providerConfig = (
    current_stt_provider ? providers[`stt:${current_stt_provider}`] : undefined
  ) as AIProviderStorage | undefined;

  const localModel = isOnDeviceSttModel(current_stt_provider, current_stt_model)
    ? current_stt_model
    : null;
  const isLocalFile = isLocalFileSttModel(
    current_stt_provider,
    current_stt_model,
  );
  const isLocalModel = !!localModel || isLocalFile;

  const isCloudModel = isAnarlogCloudSttModel(
    current_stt_provider,
    current_stt_model,
  );
  const localBatchModel = useQuery({
    ...localSttQueries.isDownloaded("soniqo-parakeet-batch"),
    enabled: isRealtimeLocalModel(current_stt_model),
  });

  const local = useQuery({
    enabled: isLocalModel,
    queryKey: [
      "stt-connection",
      current_stt_provider,
      localModel,
      isLocalFile,
      local_stt_model_path,
    ],
    refetchInterval: (query) =>
      query.state.data?.status === "loading" ? 1000 : false,
    queryFn: async () => {
      if (isLocalFile) {
        const path = local_stt_model_path?.trim();
        if (!path) {
          return {
            status: "not_selected" as const,
            connection: null,
          };
        }

        const started = await localSttCommands.startServerForPath(path);
        if (started.status === "error") {
          return {
            status: "error" as const,
            error: started.error,
            connection: null,
          };
        }

        return {
          status: "ready" as const,
          connection: {
            provider: "local_file" as const,
            model: "local-file" as const,
            baseUrl: started.data,
            apiKey: "",
          },
        };
      }

      if (!localModel) {
        return null;
      }

      const downloaded = await localSttCommands.isModelDownloaded(localModel);
      if (downloaded.status !== "ok" || !downloaded.data) {
        return { status: "not_downloaded" as const, connection: null };
      }

      const serverResult = await localSttCommands.getServerForModel(localModel);

      if (serverResult.status !== "ok") {
        return null;
      }

      const server = serverResult.data;

      if (server?.status === "ready" && server.url) {
        return {
          status: "ready" as const,
          connection: {
            provider: current_stt_provider!,
            model: localModel,
            baseUrl: server.url,
            apiKey: "",
          },
        };
      }

      return {
        status: server?.status ?? "loading",
        connection: null,
      };
    },
  });

  const defaultBaseUrl = PROVIDERS.find(
    (provider) => provider.id === current_stt_provider,
  )?.baseUrl;
  const baseUrl = providerConfig?.base_url?.trim() || defaultBaseUrl?.trim();
  const apiKey = providerConfig?.api_key?.trim();

  const connection = useMemo(() => {
    if (!current_stt_provider || !current_stt_model) {
      return null;
    }

    if (isLocalModel) {
      return local.data?.connection ?? null;
    }

    // STT hébergé par Anarlog : exige un compte, inexistant dans Syntheo.
    if (isCloudModel) {
      return null;
    }

    // Un réglage hérité peut désigner un provider retiré ou désactivé : aucune
    // connexion, même si sa configuration (URL cloud, clé) est encore stockée.
    const provider = PROVIDERS.find(({ id }) => id === current_stt_provider);
    if (!provider || provider.disabled) {
      return null;
    }

    // Les endpoints on-prem n'exigent pas forcément de clé.
    if (!baseUrl) {
      return null;
    }

    // Le protocole est désigné explicitement : un hôte on-prem ne permet pas
    // de le deviner.
    let routedBaseUrl = baseUrl;
    if (
      current_stt_provider === "openai" ||
      current_stt_provider === "nvidia"
    ) {
      const url = new URL(baseUrl);
      url.searchParams.set("provider", current_stt_provider);
      routedBaseUrl = url.toString();
    }
    return {
      provider: current_stt_provider,
      model: current_stt_model,
      baseUrl: routedBaseUrl,
      apiKey: apiKey ?? "",
    };
  }, [
    current_stt_provider,
    current_stt_model,
    localModel,
    isLocalModel,
    isCloudModel,
    local.data,
    baseUrl,
    apiKey,
  ]);

  return {
    conn: connection,
    isReady:
      settingsReady &&
      connection !== null &&
      (isLocalModel
        ? !local.isPending
        : isCloudModel
          ? billing.isReady
          : providerConfigReady),
    local,
    localBatchDiarizationAvailable: localBatchModel.data === true,
    isLocalModel,
    isCloudModel,
  };
};
