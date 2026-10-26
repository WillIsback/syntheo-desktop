import type { ReactNode } from "react";

import { Shuffle } from "@anlg/ui/components/icons";

import { type ProviderRequirement } from "~/settings/ai/shared/eligibility";

export type Provider = {
  id: string;
  displayName: string;
  badge: string | null;
  icon: ReactNode;
  baseUrl?: string;
  authKind?: "api" | "subscription";
  requirements: ProviderRequirement[];
  checkAvailability?: (baseUrl: string, apiKey: string) => Promise<boolean>;
  hideAdvanced?: boolean;
  links?: {
    download?: { label: string; url: string };
    models?: { label: string; url: string };
    setup?: { label: string; url: string };
  };
};

// Syntheo ne parle qu'à un serveur OpenAI-compatible on-premise (vLLM,
// Ollama, llama.cpp server, LM Studio, TGI, NIM LLM).
const _PROVIDERS = [
  {
    id: "custom",
    displayName: "Custom",
    badge: null,
    icon: <Shuffle />,
    baseUrl: undefined,
    requirements: [
      { kind: "requires_config", fields: ["base_url", "api_key"] },
    ],
  },
] as const satisfies readonly Provider[];

export const PROVIDERS: Provider[] = [..._PROVIDERS];
export type ProviderId = (typeof _PROVIDERS)[number]["id"];
