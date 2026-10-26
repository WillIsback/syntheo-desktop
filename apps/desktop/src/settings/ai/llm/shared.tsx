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

// Préréglage modifiable : le vLLM du DGX. La clé se saisit dans l'app,
// jamais dans le binaire ; le modèle est lu dans /v1/models.
export const LLM_VLLM_PRESET_URL = "https://spark-787d-1.tail6cba9f.ts.net/v1";

// Syntheo ne parle qu'à un serveur OpenAI-compatible on-premise (vLLM,
// Ollama, llama.cpp server, LM Studio, TGI, NIM LLM).
const _PROVIDERS = [
  {
    id: "custom",
    displayName: "vLLM (OpenAI-compatible)",
    badge: null,
    icon: <Shuffle />,
    baseUrl: LLM_VLLM_PRESET_URL,
    requirements: [{ kind: "requires_config", fields: ["base_url"] }],
  },
] as const satisfies readonly Provider[];

export const PROVIDERS: Provider[] = [..._PROVIDERS];
export type ProviderId = (typeof _PROVIDERS)[number]["id"];
