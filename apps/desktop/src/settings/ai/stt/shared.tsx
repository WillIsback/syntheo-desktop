import { Apple, Nvidia, OpenAI } from "@lobehub/icons";
import type { ReactNode } from "react";

import type { LocalModel } from "@anlg/plugin-local-stt";
import { Cpu, Waveform } from "@anlg/ui/components/icons";

import { env } from "~/env";
import { AnarlogProviderIcon, ProviderLobeIcon } from "~/settings/ai/shared";
import { type ProviderRequirement } from "~/settings/ai/shared/eligibility";
import { sortProviders } from "~/settings/ai/shared/sort-providers";
import { localSttQueries } from "~/stt/useLocalSttModel";

export { localSttQueries as sttModelQueries };

type Provider = {
  builtIn?: boolean;
  disabled: boolean;
  id: string;
  displayName: string;
  description?: string;
  icon: ReactNode;
  baseUrl?: string;
  models: LocalModel[] | string[];
  badge?: string | null;
  requirements: ProviderRequirement[];
  links?: {
    models?: { label: string; url: string };
    setup?: { label: string; url: string };
  };
};

const displayModelId = (model: string): string => {
  if (model === "cloud") {
    return "Pro (Cloud)";
  }

  if (model === "local-file") {
    return "whisper.cpp .bin";
  }

  return model;
};

export function displayModelLabel(model: string, displayName?: string) {
  return displayName ?? displayModelId(model);
}

export function formatDownloadProgress(progress?: number | null) {
  if (progress == null || progress <= 0) {
    return null;
  }

  return `${Math.round(progress)}%`;
}

export function formatModelSize(sizeBytes?: number | null) {
  if (!sizeBytes) {
    return null;
  }

  const unit = sizeBytes >= 1024 * 1024 * 1024 ? "GB" : "MB";
  const value =
    unit === "GB" ? sizeBytes / 1024 / 1024 / 1024 : sizeBytes / 1024 / 1024;

  return `~${value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  })} ${unit}`;
}

const _PROVIDERS = [
  {
    // Transcription hébergée : exige un compte, retirée (suppression au 04b).
    disabled: true,
    id: "anarlog",
    displayName: "Anarlog",
    badge: "Recommended",
    builtIn: true,
    icon: <AnarlogProviderIcon />,
    baseUrl: new URL(
      "/stt",
      env.VITE_AI_API_URL ?? env.VITE_API_URL,
    ).toString(),
    models: ["cloud"],
    requirements: [],
  },
  {
    disabled: false,
    id: "soniqo",
    displayName: "Soniqo",
    badge: "On device",
    baseUrl: "",
    builtIn: true,
    icon: <Waveform />,
    models: [],
    requirements: [],
  },
  {
    disabled: false,
    id: "apple_speech",
    displayName: "Apple Speech",
    badge: "On device",
    baseUrl: "",
    builtIn: true,
    icon: <ProviderLobeIcon icon={Apple} />,
    models: [],
    requirements: [],
  },
  {
    disabled: false,
    id: "local_file",
    displayName: "BYO-model",
    badge: "On device",
    baseUrl: "",
    builtIn: true,
    icon: <Cpu />,
    models: ["local-file"],
    requirements: [],
  },
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
    displayName: "NVIDIA Speech NIM",
    badge: "Self-hosted",
    icon: <ProviderLobeIcon icon={Nvidia} />,
    baseUrl: undefined,
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

const PROVIDER_ORDER = [
  "soniqo",
  "apple_speech",
  "local_file",
  "openai",
  "nvidia",
] as const;

export const PROVIDERS = sortProviders(_PROVIDERS, PROVIDER_ORDER);
export type ProviderId = (typeof _PROVIDERS)[number]["id"];
