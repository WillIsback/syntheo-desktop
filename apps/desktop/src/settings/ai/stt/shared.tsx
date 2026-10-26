import { Nvidia, OpenAI } from "@lobehub/icons";
import type { ReactNode } from "react";

import { ProviderLobeIcon } from "~/settings/ai/shared";
import { type ProviderRequirement } from "~/settings/ai/shared/eligibility";
import { sortProviders } from "~/settings/ai/shared/sort-providers";

type Provider = {
  builtIn?: boolean;
  disabled: boolean;
  id: string;
  displayName: string;
  description?: string;
  icon: ReactNode;
  baseUrl?: string;
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

// Préréglage modifiable : le NIM Nemotron ASR du DGX (WebSocket). Voxtral
// Realtime (vLLM) passe par le provider OpenAI-compatible, URL à renseigner.
export const STT_NIM_PRESET_URL =
  "https://spark-787d-1.tail6cba9f.ts.net/v1/realtime";

const _PROVIDERS = [
  {
    disabled: false,
    id: "openai",
    displayName: "OpenAI-compatible",
    description:
      "OpenAI Realtime and /v1/audio/transcriptions (vLLM, speaches, faster-whisper-server)",
    badge: "Self-hosted",
    icon: <ProviderLobeIcon icon={OpenAI} />,
    baseUrl: undefined,
    models: [],
    requirements: [{ kind: "requires_config", fields: ["base_url"] }],
    links: {
      models: {
        label: "API documentation",
        url: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
      },
    },
  },
  {
    disabled: false,
    id: "nvidia",
    displayName: "Nemotron ASR (NIM, WebSocket)",
    badge: "Self-hosted",
    icon: <ProviderLobeIcon icon={Nvidia} />,
    baseUrl: STT_NIM_PRESET_URL,
    models: ["nemotron-asr-streaming"],
    requirements: [{ kind: "requires_config", fields: ["base_url"] }],
    links: {
      models: {
        label: "API documentation",
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
