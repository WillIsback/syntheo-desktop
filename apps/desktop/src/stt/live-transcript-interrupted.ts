import type { DegradedError } from "@syntheo/plugin-transcription";

import { PROVIDERS } from "~/settings/ai/stt/shared";

// Règle audio de Syntheo : rien n'est conservé, la coupure manquera au
// transcript.
const NO_AUDIO_KEPT_NOTE =
  "Aucun audio n'est conservé : ce passage manquera au transcript. Reconnexion…";

function providerDisplayName(providerId: string | null | undefined) {
  if (!providerId) return null;
  return (
    PROVIDERS.find((provider) => provider.id === providerId)?.displayName ??
    null
  );
}

function isProviderSideStreamError(message: string) {
  return (
    /provider error/i.test(message) ||
    /code=Some\(4\d{3}\)/.test(message) ||
    /^[\w-]+: /.test(message)
  );
}

function getPauseCause({
  degraded,
  sttProvider,
  online,
}: {
  degraded: DegradedError | null;
  sttProvider: string | null | undefined;
  online: boolean;
}) {
  const providerName =
    providerDisplayName(sttProvider) ?? "le service de transcription";

  if (!online) {
    return "vous êtes hors ligne";
  }

  if (degraded?.type === "authentication_failed") {
    return `${providerName} a refusé votre clé d'API`;
  }

  if (degraded?.type === "provider_configuration") {
    return `${providerName} a refusé les réglages de transcription`;
  }

  if (
    degraded?.type === "stream_error" &&
    isProviderSideStreamError(degraded.message)
  ) {
    return `${providerName} subit une panne`;
  }

  if (degraded) {
    return `Syntheo ne parvient pas à joindre ${providerName}`;
  }

  return `${providerName} n'envoie plus de texte`;
}

export function getLiveTranscriptPausedMessage({
  degraded,
  sttProvider,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
}: {
  degraded: DegradedError | null;
  sttProvider: string | null | undefined;
  online?: boolean;
}) {
  const cause = getPauseCause({ degraded, sttProvider, online });
  return `Transcript en direct en pause : ${cause}. ${NO_AUDIO_KEPT_NOTE}`;
}
