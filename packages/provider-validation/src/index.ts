import { sha256 } from "js-sha256";

export type ProviderCredential = {
  type?: "stt" | "llm";
  provider: string;
  baseUrl: string;
  apiKey: string;
};

type CredentialFetch = (url: string, init: RequestInit) => Promise<Response>;
const verified = new WeakMap<CredentialFetch, Map<string, number>>();

export class ProviderCredentialError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

export function providerCredentialIdentity(credential: ProviderCredential) {
  return sha256(JSON.stringify(credential));
}

export function usesDeferredProviderAuthentication(
  type: "stt" | "llm" | undefined,
  provider: string,
) {
  return (
    // Les serveurs STT on-prem n'ont pas de sonde d'authentification commune :
    // la clé est vérifiée à l'ouverture de la session.
    type === "stt" && ["openai", "nvidia"].includes(provider)
  );
}

export async function verifyProviderCredentials(
  credential: ProviderCredential,
  fetcher: CredentialFetch,
  signal?: AbortSignal,
): Promise<void> {
  const apiKey = credential.apiKey.trim();
  // Les serveurs on-prem acceptent d'être lancés sans clé.
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey))
    throw new ProviderCredentialError("Enter a valid API key.");
  let base: URL;
  try {
    base = new URL(credential.baseUrl);
  } catch {
    throw new ProviderCredentialError("Enter a valid base URL.");
  }
  if (base.username || base.password || base.search || base.hash)
    throw new ProviderCredentialError(
      "Enter a base URL without credentials or query parameters.",
    );
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && isPrivateHost(base.hostname))
  )
    throw new ProviderCredentialError("Use HTTPS for provider credentials.");

  signal?.throwIfAborted();
  // These providers have no shared read-only credential probe.
  // Authenticate on the native session or transcription request instead.
  if (usesDeferredProviderAuthentication(credential.type, credential.provider))
    return;

  const identity = providerCredentialIdentity({ ...credential, apiKey });
  const recent = verified.get(fetcher) ?? new Map<string, number>();
  verified.set(fetcher, recent);
  if ((recent.get(identity) ?? 0) > Date.now()) return;

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.throwIfAborted();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 8_000);
  try {
    const request = credentialRequest({ ...credential, apiKey });
    const response = await fetcher(request.url, {
      ...request.init,
      signal: controller.signal,
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new ProviderCredentialError(
        "The provider rejected this key or its permissions. Check the key and try again.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderCredentialError(
        response.status === 429
          ? "The provider is rate limiting verification. Try again shortly."
          : "Couldn’t verify this key with the provider. Check the connection and try again.",
        true,
      );
    }
    const body = await readResponse(response, request.plainText);
    if (!request.accept(body))
      throw new ProviderCredentialError(
        "The provider did not confirm this key. Check the key and connection.",
      );

    controller.signal.throwIfAborted();
    // Saving and refreshing availability use the same proof, without retaining
    // raw credentials or turning a temporary network failure into a lost setup.
    recent.set(identity, Date.now() + 60_000);
    if (recent.size > 128) recent.delete(recent.keys().next().value!);
  } catch (error) {
    if (error instanceof ProviderCredentialError) throw error;
    throw new ProviderCredentialError(
      "Couldn’t verify this key. Check your connection and try again.",
      true,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

// Un serveur OpenAI-compatible on-prem prouve sa configuration en listant ses
// modèles. Aucune contre-épreuve par clé invalide : un vLLM sans --api-key
// accepte toute clé, ce qui est légitime sur un réseau privé.
function credentialRequest({ baseUrl, apiKey }: ProviderCredential) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};
  return {
    url: `${base}/models`,
    init: { method: "GET", headers, body: undefined as string | undefined },
    accept: (value: unknown) => {
      const data = record(value);
      return (
        !data.error && (Array.isArray(data.data) || Array.isArray(data.models))
      );
    },
    plainText: false,
  };
}

// Un endpoint on-prem en HTTP clair reste acceptable sur la machine ou un
// réseau privé (LAN, plage CGNAT de Tailscale, noms .local) ; ailleurs, HTTPS.
export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (["localhost", "[::1]"].includes(host) || host.endsWith(".local")) {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

async function readResponse(
  response: Response,
  plainText: boolean,
): Promise<unknown> {
  const limit = 8 * 1024 * 1024;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty verification response");
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Verification response too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return plainText ? text : JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
