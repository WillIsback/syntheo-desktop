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

// Contrôle d'URL partagé : appliqué à l'enregistrement d'un provider, même
// quand aucune sonde d'authentification n'est déclenchée. Un endpoint on-prem
// en HTTP clair reste acceptable sur la machine ou un réseau privé ; ailleurs,
// HTTPS est exigé.
export function validateProviderBaseUrl(baseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ProviderCredentialError("Saisissez une URL de base valide.");
  }
  if (base.username || base.password || base.search || base.hash)
    throw new ProviderCredentialError(
      "Saisissez une URL de base sans identifiants ni paramètres de requête.",
    );
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && isPrivateHost(base.hostname))
  )
    throw new ProviderCredentialError(
      "Utilisez HTTPS : le HTTP n'est accepté que sur cette machine ou un réseau privé.",
    );
  return base;
}

export async function verifyProviderCredentials(
  credential: ProviderCredential,
  fetcher: CredentialFetch,
  signal?: AbortSignal,
): Promise<void> {
  const apiKey = credential.apiKey.trim();
  // Les serveurs on-prem acceptent d'être lancés sans clé.
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey))
    throw new ProviderCredentialError("Saisissez une clé d'API valide.");
  validateProviderBaseUrl(credential.baseUrl);

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
        "Le fournisseur a refusé cette clé ou ses autorisations. Vérifiez la clé et réessayez.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderCredentialError(
        response.status === 429
          ? "Le fournisseur limite les vérifications. Réessayez dans quelques instants."
          : "Impossible de vérifier cette clé auprès du fournisseur. Vérifiez la connexion et réessayez.",
        true,
      );
    }
    const body = await readResponse(response, request.plainText);
    if (!request.accept(body))
      throw new ProviderCredentialError(
        "Le fournisseur n'a pas confirmé cette clé. Vérifiez la clé et la connexion.",
      );

    controller.signal.throwIfAborted();
    // Saving and refreshing availability use the same proof, without retaining
    // raw credentials or turning a temporary network failure into a lost setup.
    recent.set(identity, Date.now() + 60_000);
    if (recent.size > 128) recent.delete(recent.keys().next().value!);
  } catch (error) {
    if (error instanceof ProviderCredentialError) throw error;
    throw new ProviderCredentialError(
      "Impossible de vérifier cette clé. Vérifiez votre connexion et réessayez.",
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
  // Retire les « / » de fin sans expression régulière : parcours linéaire
  // borné, insensible aux entrées bourrées de répétitions de « / ».
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") end--;
  const base = baseUrl.slice(0, end);
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
// réseau privé (LAN, plage CGNAT de Tailscale, noms .local, noms MagicDNS
// *.ts.net) ; ailleurs, HTTPS.
//
// Les noms MagicDNS en `.ts.net` ne se résolvent que dans le tailnet, dont
// tout le trafic est chiffré de bout en bout par WireGuard ; et Tailscale
// Funnel, seul moyen de les exposer sur Internet, ne le fait qu'en HTTPS.
// Le HTTP clair vers ces noms ne quitte donc jamais le tunnel chiffré.
// Seul le suffixe exact « .ts.net » compte : « evil-ts.net » est refusé.
export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (
    ["localhost", "[::1]"].includes(host) ||
    host.endsWith(".local") ||
    isTailnetName(host)
  ) {
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

// Nom de machine sous `.ts.net` : au moins une étiquette non vide avant le
// suffixe (ni « ts.net » ni « .ts.net » seuls).
function isTailnetName(host: string) {
  const suffix = ".ts.net";
  if (!host.endsWith(suffix)) return false;
  const labels = host.slice(0, -suffix.length).split(".");
  return labels.every((label) => label.length > 0);
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
