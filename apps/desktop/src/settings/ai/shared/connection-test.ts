import {
  ProviderCredentialError,
  validateProviderBaseUrl,
} from "@syntheo/provider-validation";

import { providerFetch } from "~/ai/provider-fetch";

// « Tester la connexion » des cartes serveur. `verifyProviderCredentials`
// ne suffit pas ici : il ne sonde pas les serveurs de transcription (leur clé
// est vérifiée à l'ouverture de la session) et ses messages parlent de clé.
// La sonde reprend ses règles (même contrôle d'URL, même `/models`, même
// transport) et ajoute la latence et la détection du protocole.

export type ServerProtocol = "openai" | "nvidia";

export type ServerProbeFailure =
  | "invalid_url"
  | "unreachable"
  | "unauthorized"
  | "not_found"
  | "server_error";

export type ServerProbeResult =
  | {
      ok: true;
      latencyMs: number;
      protocol: ServerProtocol;
      models: string[];
    }
  | { ok: false; reason: "invalid_url"; message: string }
  | {
      ok: false;
      reason: Exclude<ServerProbeFailure, "invalid_url">;
      status?: number;
    };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_MODELS = 200;

export async function probeServer(
  {
    type,
    baseUrl,
    apiKey,
  }: { type: "stt" | "llm"; baseUrl: string; apiKey: string },
  {
    fetcher = providerFetch as Fetcher,
    signal,
    now = () => performance.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: {
    fetcher?: Fetcher;
    signal?: AbortSignal;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): Promise<ServerProbeResult> {
  let url: URL;
  try {
    url = validateProviderBaseUrl(baseUrl.trim());
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_url",
      message:
        error instanceof ProviderCredentialError
          ? error.message
          : String(error),
    };
  }

  const headers: Record<string, string> = apiKey.trim()
    ? { Authorization: `Bearer ${apiKey.trim()}` }
    : {};
  const request = (target: string) =>
    timedRequest(target, { headers, fetcher, signal, now, timeoutMs });

  // Le transcripteur OpenAI s'adresse en `/v1` ou `/v1/realtime` : la liste
  // des modèles vit toujours à côté, en `/v1/models`.
  let base = trimTrailingSlashes(url.toString());
  if (type === "stt") base = base.replace(/\/realtime$/, "");

  const models = await request(`${base}/models`);
  if (models.kind === "network") return { ok: false, reason: "unreachable" };
  if (models.status === 401 || models.status === 403) {
    return { ok: false, reason: "unauthorized", status: models.status };
  }
  if (models.ok) {
    const ids = modelIds(models.body);
    if (ids) {
      return {
        ok: true,
        latencyMs: models.latencyMs,
        protocol: "openai",
        models: ids,
      };
    }
  }

  // NVIDIA NIM ne publie pas de liste de modèles, mais expose sa sonde de
  // disponibilité standard à la racine du serveur.
  if (type === "stt") {
    const health = await request(`${url.origin}/v1/health/ready`);
    if (health.kind === "response") {
      if (health.status === 401 || health.status === 403) {
        return { ok: false, reason: "unauthorized", status: health.status };
      }
      if (health.ok) {
        return {
          ok: true,
          latencyMs: health.latencyMs,
          protocol: "nvidia",
          models: [],
        };
      }
    }
  }

  return models.status >= 500
    ? { ok: false, reason: "server_error", status: models.status }
    : { ok: false, reason: "not_found", status: models.status };
}

type TimedResponse =
  | { kind: "network" }
  | {
      kind: "response";
      ok: boolean;
      status: number;
      latencyMs: number;
      body: unknown;
    };

async function timedRequest(
  target: string,
  {
    headers,
    fetcher,
    signal,
    now,
    timeoutMs,
  }: {
    headers: Record<string, string>;
    fetcher: Fetcher;
    signal?: AbortSignal;
    now: () => number;
    timeoutMs: number;
  },
): Promise<TimedResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const started = now();
  try {
    const response = await fetcher(target, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "error",
    });
    const latencyMs = Math.max(0, Math.round(now() - started));
    let body: unknown = undefined;
    if (response.ok) {
      body = await response.json().catch(() => undefined);
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    return {
      kind: "response",
      ok: response.ok,
      status: response.status,
      latencyMs,
      body,
    };
  } catch {
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function modelIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { data?: unknown; models?: unknown };
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : null;
  if (!list) return null;

  return list
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && "id" in entry
          ? String((entry as { id: unknown }).id)
          : "",
    )
    .filter((id) => id.length > 0)
    .slice(0, MAX_MODELS);
}

function trimTrailingSlashes(value: string) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}
