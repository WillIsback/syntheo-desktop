import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";

import { providerCredentialIdentity } from "@syntheo/provider-validation";
import { cn } from "@syntheo/utils";

import { useConnectionHealth } from "./health";
import { getPreferredProviderModel } from "./selection";
import { LLM_BASE_URL_PLACEHOLDER } from "./shared";

import {
  normalizeReasoningEffort,
  type ReasoningEffort,
} from "~/ai/reasoning-effort";
import { removeNonStreamingModels } from "~/settings/ai/shared/list-common";
import { listCustomModels } from "~/settings/ai/shared/list-openai";
import { PersistAiSelection } from "~/settings/ai/shared/persist-selection";
import { ServerAddressForm } from "~/settings/ai/shared/server-address";
import {
  ModelRadioList,
  ServerCard,
  ServerFailureBanner,
  ServerHelp,
  ServerStatusChip,
} from "~/settings/ai/shared/server-card";
import { useServerConnection } from "~/settings/ai/shared/server-connection";
import { setSettingValues, useSetSettingValue } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";

const PROVIDER_ID = "custom";

export function LlmServerCard() {
  const { t } = useLingui();
  const connection = useServerConnection("llm");
  const { state, baseUrl, apiKey } = connection;
  const { current_llm_provider, current_llm_model } = useConfigValues([
    "current_llm_provider",
    "current_llm_model",
  ] as const);
  const model =
    current_llm_provider === PROVIDER_ID ? (current_llm_model ?? "") : "";

  // Même filtrage qu'avant (modèles de discussion en streaming), sur la
  // liste que le serveur publie en `/v1/models`.
  const listed = useQuery({
    queryKey: [
      "llm-server-models",
      baseUrl,
      providerCredentialIdentity({ provider: PROVIDER_ID, baseUrl, apiKey }),
    ],
    queryFn: async () =>
      removeNonStreamingModels(await listCustomModels(baseUrl, apiKey)),
    enabled: state.status === "connected",
    retry: false,
    staleTime: 60_000,
  });
  const models =
    listed.data && listed.data.models.length > 0
      ? listed.data.models
      : state.status === "connected"
        ? state.models
        : [];
  const defaultModel =
    baseUrl && models.length > 0
      ? getPreferredProviderModel(model || undefined, models)
      : "";
  const persistDefault =
    !!defaultModel &&
    (current_llm_provider !== PROVIDER_ID || (!model && !!defaultModel));

  const health = useConnectionHealth();
  const connectedLabel =
    state.status === "connected" && models.length > 0
      ? t`Connected · ${models.length} models available`
      : undefined;

  const chooseModel = (next: string) => {
    // L'effort dépend du modèle : un niveau resté d'un autre modèle pourrait
    // être refusé par le nouveau.
    void setSettingValues({
      current_llm_provider: PROVIDER_ID,
      current_llm_model: next,
      current_llm_reasoning_effort: "default",
    }).catch((error) => {
      console.error("[settings] failed to update LLM selection", error);
    });
  };

  return (
    <ServerCard
      title={<Trans>My server</Trans>}
      status={
        <ServerStatusChip state={state} connectedLabel={connectedLabel} />
      }
    >
      {persistDefault ? (
        <PersistAiSelection
          key={`llm:${defaultModel}`}
          type="llm"
          provider={PROVIDER_ID}
          model={model || defaultModel}
        />
      ) : null}
      {state.status === "failed" ? (
        <ServerFailureBanner
          kind="llm"
          failure={state.failure}
          baseUrl={baseUrl}
        />
      ) : null}
      <ServerAddressForm
        kind="llm"
        providerId={PROVIDER_ID}
        label={
          <Trans>
            Server address (OpenAI-compatible: vLLM, Ollama, llama.cpp, LM
            Studio)
          </Trans>
        }
        placeholder={LLM_BASE_URL_PLACEHOLDER}
        testing={state.status === "testing"}
        onTest={connection.test}
        isCurrentProvider={current_llm_provider === PROVIDER_ID}
      />
      {baseUrl ? (
        <ModelRadioList
          label={t`Model`}
          models={models.map((id) => ({ id }))}
          value={model}
          onChange={chooseModel}
          footer={
            state.status === "connected"
              ? undefined
              : t`Test the connection to list the models served.`
          }
        />
      ) : null}
      {model && state.status === "connected" && health.status === "error" ? (
        <p role="alert" className="text-alert-foreground text-[13px]">
          {t`The selected model did not answer: ${health.message ?? ""}`}
        </p>
      ) : null}
      <ServerHelp>
        <p>
          <Trans>
            Only on-premise OpenAI-compatible servers are supported (vLLM,
            Ollama, llama.cpp server, LM Studio…). The address usually ends with
            /v1, for example http://localhost:8000/v1.
          </Trans>
        </p>
      </ServerHelp>
    </ServerCard>
  );
}

const EFFORTS: ReasoningEffort[] = ["default", "low", "medium", "high"];

export function ReasoningEffortRow() {
  const { t } = useLingui();
  const { current_llm_reasoning_effort } = useConfigValues([
    "current_llm_reasoning_effort",
  ] as const);
  const setReasoningEffort = useSetSettingValue("current_llm_reasoning_effort");
  const effort = normalizeReasoningEffort(current_llm_reasoning_effort);
  const labels: Record<ReasoningEffort, string> = {
    default: t`Auto`,
    low: t`Low`,
    medium: t`Medium`,
    high: t`High`,
  };

  return (
    <div
      role="group"
      aria-label={t`Reasoning effort`}
      className="border-input inline-flex shrink-0 overflow-hidden rounded-lg border"
    >
      {EFFORTS.map((value, index) => (
        <button
          key={value}
          type="button"
          aria-pressed={effort === value}
          onClick={() => setReasoningEffort(value)}
          className={cn([
            "focus-visible:ring-ring px-3 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset",
            index > 0 && "border-input border-l",
            effort === value
              ? "bg-primary text-primary-foreground font-semibold"
              : "bg-card hover:bg-muted",
          ])}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  );
}
