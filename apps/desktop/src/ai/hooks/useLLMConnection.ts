import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  defaultSettingsMiddleware,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from "ai";
import { useMemo } from "react";

import type { AIProviderStorage } from "@anlg/store";

import { providerFetch } from "../provider-fetch";
import {
  normalizeReasoningEffort,
  type ReasoningEffort,
  reasoningProviderOptions,
} from "../reasoning-effort";

import { type ProviderId, PROVIDERS } from "~/settings/ai/llm/shared";
import {
  getProviderSelectionBlockers,
  type ProviderEligibilityContext,
} from "~/settings/ai/shared/eligibility";
import { useAiProvider } from "~/settings/providers";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";

type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]["model"];

type LLMConnectionInfo = {
  providerId: ProviderId;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  reasoningEffort: ReasoningEffort;
};

export type LLMConnectionStatus =
  | { status: "pending"; reason: "managed_disabled" | "settings_loading" }
  | { status: "pending"; reason: "missing_provider" }
  | { status: "pending"; reason: "missing_model"; providerId: ProviderId }
  | { status: "error"; reason: "provider_not_found"; providerId: string }
  | {
      status: "error";
      reason: "missing_config";
      providerId: ProviderId;
      missing: Array<"base_url" | "api_key">;
    }
  | { status: "success"; providerId: ProviderId; isHosted: boolean };

type LLMConnectionResult = {
  conn: LLMConnectionInfo | null;
  status: LLMConnectionStatus;
};

export const useLanguageModel = (): LanguageModelV3 | null => {
  const { conn } = useLLMConnection();

  return useMemo(() => {
    if (!conn) return null;
    return createLanguageModel(conn);
  }, [conn]);
};

export const useLLMConnection = (): LLMConnectionResult => {
  const settingsReady = useSettingsReady();

  const {
    intelligence_disabled,
    current_llm_provider,
    current_llm_model,
    current_llm_reasoning_effort,
  } = useConfigValues([
    "intelligence_disabled",
    "current_llm_provider",
    "current_llm_model",
    "current_llm_reasoning_effort",
  ] as const);
  const providerConfig = useAiProvider("llm", current_llm_provider) as
    | AIProviderStorage
    | undefined;

  return useMemo<LLMConnectionResult>(
    () =>
      !settingsReady || intelligence_disabled
        ? {
            conn: null,
            status: {
              status: "pending",
              reason: intelligence_disabled
                ? "managed_disabled"
                : "settings_loading",
            },
          }
        : resolveLLMConnection({
            providerId: current_llm_provider,
            modelId: current_llm_model,
            reasoningEffort: normalizeReasoningEffort(
              current_llm_reasoning_effort,
            ),
            providerConfig,
          }),
    [
      settingsReady,
      intelligence_disabled,
      current_llm_model,
      current_llm_provider,
      current_llm_reasoning_effort,
      providerConfig,
    ],
  );
};

export const useLLMConnectionStatus = (): LLMConnectionStatus => {
  const { status } = useLLMConnection();
  return status;
};

const resolveLLMConnection = (params: {
  providerId: string | undefined;
  modelId: string | undefined;
  reasoningEffort: ReasoningEffort;
  providerConfig: AIProviderStorage | undefined;
}): LLMConnectionResult => {
  const {
    providerId: rawProviderId,
    modelId,
    reasoningEffort,
    providerConfig,
  } = params;

  if (!rawProviderId) {
    return {
      conn: null,
      status: { status: "pending", reason: "missing_provider" },
    };
  }

  const providerId = rawProviderId as ProviderId;

  if (!modelId) {
    return {
      conn: null,
      status: { status: "pending", reason: "missing_model", providerId },
    };
  }

  const providerDefinition = PROVIDERS.find((p) => p.id === providerId);

  if (!providerDefinition) {
    return {
      conn: null,
      status: {
        status: "error",
        reason: "provider_not_found",
        providerId: rawProviderId,
      },
    };
  }

  const baseUrl =
    providerConfig?.base_url?.trim() ||
    providerDefinition.baseUrl?.trim() ||
    "";
  const apiKey = providerConfig?.api_key?.trim() || "";

  const context: ProviderEligibilityContext = {
    isAuthenticated: false,
    isPaid: true,
    config: { base_url: baseUrl, api_key: apiKey },
  };

  const blockers = getProviderSelectionBlockers(
    providerDefinition.requirements,
    context,
  );

  if (blockers.length > 0) {
    const blocker = blockers[0];
    if (blocker.code === "missing_config") {
      return {
        conn: null,
        status: {
          status: "error",
          reason: "missing_config",
          providerId,
          missing: blocker.fields,
        },
      };
    }
  }

  return {
    conn: { providerId, modelId, baseUrl, apiKey, reasoningEffort },
    status: { status: "success", providerId, isHosted: false },
  };
};

const wrapWithThinkingMiddleware = (
  model: LanguageModelV3,
): LanguageModelV3 => {
  return wrapLanguageModel({
    model,
    middleware: [
      extractReasoningMiddleware({ tagName: "think" }),
      extractReasoningMiddleware({ tagName: "thinking" }),
    ],
  });
};

const createLanguageModel = (conn: LLMConnectionInfo): LanguageModelV3 => {
  const model = createProviderModel(conn);
  const providerOptions = reasoningProviderOptions(
    conn.providerId,
    conn.modelId,
    conn.reasoningEffort,
  );
  if (!providerOptions) {
    return model;
  }

  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({ settings: { providerOptions } }),
  });
};

const createProviderModel = (conn: LLMConnectionInfo): LanguageModelV3 => {
  const config: Parameters<typeof createOpenAICompatible>[0] = {
    fetch: providerFetch,
    name: conn.providerId,
    baseURL: conn.baseUrl,
  };
  if (conn.apiKey) {
    config.apiKey = conn.apiKey;
  }
  const provider = createOpenAICompatible(config);
  return wrapWithThinkingMiddleware(provider.chatModel(conn.modelId));
};
