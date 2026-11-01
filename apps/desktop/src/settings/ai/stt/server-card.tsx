import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef } from "react";

import { cn } from "@syntheo/utils";

import {
  STT_NIM_BASE_URL_PLACEHOLDER,
  STT_OPENAI_BASE_URL_PLACEHOLDER,
} from "./shared";

import type { ServerProtocol } from "~/settings/ai/shared/connection-test";
import { PersistAiSelection } from "~/settings/ai/shared/persist-selection";
import { ServerAddressForm } from "~/settings/ai/shared/server-address";
import {
  type ModelOption,
  ModelRadioList,
  ServerCard,
  ServerFailureBanner,
  ServerHelp,
  ServerStatusChip,
} from "~/settings/ai/shared/server-card";
import {
  STT_SERVER_PROTOCOLS,
  useServerConnection,
} from "~/settings/ai/shared/server-connection";
import { setAiProvider } from "~/settings/providers";
import { useSetSettingValues } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";
import { isConfiguredSttModel } from "~/stt/capabilities";
import {
  getDefaultSttModel,
  NVIDIA_NIM_ASR_MODELS,
} from "~/stt/model-selection";

type Protocol = (typeof STT_SERVER_PROTOCOLS)[number];

export function SttServerCard() {
  const { t } = useLingui();
  const protocolLabelId = useId();
  const queryClient = useQueryClient();
  const connection = useServerConnection("stt");
  const { state, baseUrl } = connection;
  const providerId = connection.providerId as Protocol;
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const);
  const setSelection = useSetSettingValues();
  const lastModels = useRef<Record<string, string>>({});

  const model =
    current_stt_provider === providerId &&
    isConfiguredSttModel(current_stt_provider, current_stt_model)
      ? (current_stt_model ?? "")
      : "";

  const protocols: Record<Protocol, { label: string; hint: string }> = {
    openai: {
      label: t`OpenAI · Realtime and batch`,
      hint: t`vLLM, speaches, faster-whisper-server`,
    },
    nvidia: { label: t`NVIDIA NIM · WebSocket`, hint: t`Nemotron, Parakeet` },
  };

  const nimHints: Record<(typeof NVIDIA_NIM_ASR_MODELS)[number], string> = {
    "nemotron-asr-streaming": t`English`,
    "parakeet-tdt-0.6b-v3": t`Multilingual`,
    "parakeet-tdt-0.6b-v2": t`English`,
    "cache-aware-parakeet-rnnt-multi-asr-streaming-sortformer": t`Multilingual · speakers`,
  };
  const models: ModelOption[] =
    providerId === "nvidia"
      ? NVIDIA_NIM_ASR_MODELS.map((id) => ({ id, hint: nimHints[id] }))
      : state.status === "connected"
        ? state.models.map((id) => ({ id }))
        : [];

  // Le modèle par défaut est enregistré dès qu'une adresse existe : celui du
  // protocole (NIM), sinon le premier que le serveur annonce.
  const fallbackModel =
    getDefaultSttModel(providerId) ??
    (state.status === "connected" && state.protocol === providerId
      ? state.models[0]
      : undefined);
  const persistDefault =
    !!baseUrl &&
    (current_stt_provider !== providerId || (!model && !!fallbackModel));

  const chooseProtocol = (next: Protocol) => {
    if (next === providerId) return;
    // Revenir au protocole précédent retrouve le modèle qu'il utilisait.
    if (model) lastModels.current[providerId] = model;
    setSelection({
      current_stt_provider: next,
      current_stt_model:
        lastModels.current[next] ?? getDefaultSttModel(next) ?? "",
    });
  };

  const detected: ServerProtocol | null =
    state.status === "connected" ? state.protocol : null;
  const detectedLabel = detected ? protocols[detected].label : "";
  const adoptDetected = async () => {
    if (!detected || detected === providerId) return;
    await setAiProvider("stt", detected, {
      base_url: baseUrl,
      api_key: connection.apiKey,
    });
    await queryClient.invalidateQueries({
      queryKey: ["ai-provider-api-keys", "stt"],
    });
    chooseProtocol(detected);
  };

  return (
    <ServerCard
      title={<Trans>My server</Trans>}
      status={<ServerStatusChip state={state} />}
    >
      {persistDefault ? (
        <PersistAiSelection
          key={`stt:${providerId}:${model || fallbackModel || ""}`}
          type="stt"
          provider={providerId}
          model={model || fallbackModel || ""}
        />
      ) : null}
      {state.status === "failed" ? (
        <ServerFailureBanner
          kind="stt"
          failure={state.failure}
          baseUrl={baseUrl}
        />
      ) : null}
      <ServerAddressForm
        kind="stt"
        providerId={providerId}
        label={<Trans>Server address</Trans>}
        placeholder={
          providerId === "nvidia"
            ? STT_NIM_BASE_URL_PLACEHOLDER
            : STT_OPENAI_BASE_URL_PLACEHOLDER
        }
        testing={state.status === "testing"}
        onTest={connection.test}
        isCurrentProvider={current_stt_provider === providerId}
      />
      <div className="flex flex-col gap-2">
        <span
          id={protocolLabelId}
          className="text-muted-foreground text-[13px] font-medium"
        >
          <Trans>Protocol</Trans>
          {detected === providerId ? (
            <span className="text-accent-foreground">
              {" · "}
              <Trans>detected automatically</Trans>
            </span>
          ) : null}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={protocolLabelId}
          className="flex flex-wrap gap-1.5"
        >
          {STT_SERVER_PROTOCOLS.map((id) => {
            const checked = id === providerId;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                title={protocols[id].hint}
                onClick={() => chooseProtocol(id)}
                className={cn([
                  "focus-visible:ring-ring rounded-md border px-2.5 py-0.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
                  checked
                    ? "border-primary bg-accent text-accent-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-muted",
                ])}
              >
                {protocols[id].label}
              </button>
            );
          })}
        </div>
        {detected && detected !== providerId ? (
          <p className="text-muted-foreground text-[13px]">
            {t`This server answers as ${detectedLabel}.`}{" "}
            <button
              type="button"
              onClick={() => void adoptDetected()}
              className="text-primary underline underline-offset-[3px]"
            >
              <Trans>Use this protocol</Trans>
            </button>
          </p>
        ) : null}
      </div>
      {baseUrl ? (
        <ModelRadioList
          key={providerId}
          label={t`Model`}
          models={models}
          value={model}
          onChange={(next) =>
            setSelection({
              current_stt_provider: providerId,
              current_stt_model: next,
            })
          }
          footer={
            providerId === "nvidia"
              ? t`NIM does not publish its model list: these are the models known for this protocol.`
              : state.status === "connected"
                ? undefined
                : t`Test the connection to list the models served.`
          }
        />
      ) : null}
      <ServerHelp>
        <p>
          <Trans>
            OpenAI: a server that speaks the OpenAI speech protocol (vLLM,
            speaches, faster-whisper-server), for example
            http://localhost:8000/v1. Live transcription uses /v1/realtime,
            imported files /v1/audio/transcriptions.
          </Trans>
        </p>
        <p>
          <Trans>
            NVIDIA NIM: your deployed Speech NIM WebSocket server, for example
            http://localhost:9000/v1/realtime. NVIDIA's hosted gRPC endpoint is
            not supported.
          </Trans>
        </p>
        <p>
          <Trans>
            The API key is optional for servers without authentication. It is
            kept in your system keychain.
          </Trans>
        </p>
      </ServerHelp>
    </ServerCard>
  );
}
