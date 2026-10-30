import { Nvidia, OpenAI } from "@lobehub/icons";
import type { ReactNode } from "react";

import { ProviderLobeIcon } from "~/settings/ai/shared";
import { type ProviderRequirement } from "~/settings/ai/shared/eligibility";
import { sortProviders } from "~/settings/ai/shared/sort-providers";
import { NVIDIA_NIM_ASR_MODELS } from "~/stt/model-selection";

type Provider = {
  builtIn?: boolean;
  disabled: boolean;
  id: string;
  displayName: string;
  description?: string;
  icon: ReactNode;
  baseUrl?: string;
  baseUrlPlaceholder?: string;
  models: string[];
  badge?: string | null;
  requirements: ProviderRequirement[];
  links?: {
    models?: { label: string; url: string };
    setup?: { label: string; url: string };
  };
};

export function displayModelLabel(model: string, displayName?: string) {
  return displayName ?? model;
}

// Aucune URL par défaut : l'utilisateur saisit celle de son serveur. Nemotron
// ASR passe par le NIM (WebSocket), Voxtral Realtime (vLLM) par le provider
// OpenAI-compatible.
export const STT_OPENAI_BASE_URL_PLACEHOLDER = "http://localhost:8000/v1";
export const STT_NIM_BASE_URL_PLACEHOLDER = "http://localhost:9000/v1/realtime";

const _PROVIDERS = [
  {
    disabled: false,
    id: "openai",
    displayName: "OpenAI-compatible",
    description:
      "OpenAI Realtime et /v1/audio/transcriptions (vLLM, speaches, faster-whisper-server)",
    badge: "Auto-hébergé",
    icon: <ProviderLobeIcon icon={OpenAI} />,
    baseUrl: undefined,
    baseUrlPlaceholder: STT_OPENAI_BASE_URL_PLACEHOLDER,
    models: [],
    requirements: [{ kind: "requires_config", fields: ["base_url"] }],
    links: {
      models: {
        label: "Documentation de l'API",
        url: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
      },
    },
  },
  {
    disabled: false,
    id: "nvidia",
    displayName: "Nemotron ASR (NIM, WebSocket)",
    badge: "Auto-hébergé",
    icon: <ProviderLobeIcon icon={Nvidia} />,
    baseUrl: undefined,
    baseUrlPlaceholder: STT_NIM_BASE_URL_PLACEHOLDER,
    models: [...NVIDIA_NIM_ASR_MODELS],
    requirements: [{ kind: "requires_config", fields: ["base_url"] }],
    links: {
      models: {
        label: "Documentation de l'API",
        url: "https://docs.nvidia.com/nim/speech/latest/reference/api-references/asr/realtime-asr.html",
      },
      setup: {
        label: "API setup",
        url: "https://docs.nvidia.com/nim/speech/latest/get-started/tutorials/asr.html",
      },
    },
  },
] as const satisfies readonly Provider[];

const PROVIDER_ORDER = ["openai", "nvidia"] as const;

export const PROVIDERS = sortProviders(_PROVIDERS, PROVIDER_ORDER);
export type ProviderId = (typeof _PROVIDERS)[number]["id"];
