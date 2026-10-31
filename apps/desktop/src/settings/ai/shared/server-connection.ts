import { useQuery } from "@tanstack/react-query";

import { providerCredentialIdentity } from "@syntheo/provider-validation";

import {
  probeServer,
  type ServerProbeResult,
  type ServerProtocol,
} from "./connection-test";

import { useAiProviders } from "~/settings/providers";
import { useConfigValue } from "~/shared/config";

export type ServerKind = "stt" | "llm";

export type ServerFailure = Extract<ServerProbeResult, { ok: false }>;

// États d'une carte serveur, partagés par la page et le menu des paramètres.
export type ServerConnectionState =
  | { status: "unconfigured" }
  | { status: "untested" }
  | { status: "testing" }
  | {
      status: "connected";
      latencyMs: number;
      protocol: ServerProtocol;
      models: string[];
    }
  | { status: "failed"; failure: ServerFailure };

export const SERVER_CONNECTION_QUERY_KEY = "server-connection";

// Le serveur de synthèse n'a qu'un protocole (OpenAI-compatible, `custom`) ;
// la transcription choisit entre ceux d'owhisper-client.
export const STT_SERVER_PROTOCOLS = ["openai", "nvidia"] as const;

export function resolveServerProviderId(
  kind: ServerKind,
  currentSttProvider: string | undefined,
  configured: Record<string, { base_url?: string } | undefined>,
): string {
  if (kind === "llm") return "custom";
  if (currentSttProvider) return currentSttProvider;
  // Sans choix enregistré, la carte montre le premier serveur déjà saisi.
  return (
    STT_SERVER_PROTOCOLS.find((id) =>
      String(configured[`stt:${id}`]?.base_url ?? "").trim(),
    ) ?? "openai"
  );
}

export function useServerConnection(kind: ServerKind) {
  const sttProvider = useConfigValue("current_stt_provider");
  const providers = useAiProviders(kind);
  const providerId = resolveServerProviderId(kind, sttProvider, providers);
  const config = providers[`${kind}:${providerId}`];
  const baseUrl = String(config?.base_url ?? "").trim();
  const apiKey = String(config?.api_key ?? "").trim();

  const query = useQuery({
    queryKey: [
      SERVER_CONNECTION_QUERY_KEY,
      kind,
      providerId,
      baseUrl,
      providerCredentialIdentity({ provider: providerId, baseUrl, apiKey }),
    ],
    queryFn: ({ signal }) =>
      probeServer({ type: kind, baseUrl, apiKey }, { signal }),
    enabled: baseUrl.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  return {
    providerId,
    baseUrl,
    apiKey,
    state: toConnectionState(baseUrl, query),
    test: () => void query.refetch(),
  };
}

export function toConnectionState(
  baseUrl: string,
  query: { isFetching: boolean; data?: ServerProbeResult },
): ServerConnectionState {
  if (!baseUrl) return { status: "unconfigured" };
  if (query.isFetching) return { status: "testing" };
  if (!query.data) return { status: "untested" };
  if (query.data.ok) {
    return {
      status: "connected",
      latencyMs: query.data.latencyMs,
      protocol: query.data.protocol,
      models: query.data.models,
    };
  }
  return { status: "failed", failure: query.data };
}
