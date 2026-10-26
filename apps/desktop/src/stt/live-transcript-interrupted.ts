import type { DegradedError } from "@anlg/plugin-transcription";

import { PROVIDERS } from "~/settings/ai/stt/shared";

// Règle audio de Syntheo : rien n'est conservé, la coupure manquera au
// transcript (traduction française avec le lot i18n).
const NO_AUDIO_KEPT_NOTE =
  "No audio is kept, so this part will be missing from the transcript. Reconnecting…";

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
    providerDisplayName(sttProvider) ?? "the transcription service";

  if (!online) {
    return "you're offline";
  }

  if (degraded?.type === "authentication_failed") {
    return `${providerName} rejected your API key`;
  }

  if (degraded?.type === "provider_configuration") {
    return `${providerName} rejected the transcription settings`;
  }

  if (
    degraded?.type === "stream_error" &&
    isProviderSideStreamError(degraded.message)
  ) {
    return `${providerName} is having an outage`;
  }

  if (degraded) {
    return `Anarlog can't reach ${providerName}`;
  }

  return `${providerName} stopped sending words`;
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
  return `Live transcript paused because ${cause}. ${NO_AUDIO_KEPT_NOTE}`;
}
