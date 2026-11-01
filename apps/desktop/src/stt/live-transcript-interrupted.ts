import { t } from "@lingui/core/macro";

import type { DegradedError } from "@syntheo/plugin-transcription";

import { PROVIDERS } from "~/settings/ai/stt/shared";

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

// Le listener (crates/listener-core, supervisor) ne retente pas la connexion
// après un refus de clé ou de réglages : seule une action de l'utilisateur
// peut alors relancer la transcription en direct.
function isRetriedAutomatically(degraded: DegradedError | null) {
  return (
    degraded?.type !== "authentication_failed" &&
    degraded?.type !== "provider_configuration"
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
    providerDisplayName(sttProvider) ?? t`the transcription service`;

  if (!online) {
    return t`you are offline`;
  }

  if (degraded?.type === "authentication_failed") {
    return t`${providerName} rejected your API key`;
  }

  if (degraded?.type === "provider_configuration") {
    return t`${providerName} rejected the transcription settings`;
  }

  if (
    degraded?.type === "stream_error" &&
    isProviderSideStreamError(degraded.message)
  ) {
    return t`${providerName} is having an outage`;
  }

  if (degraded) {
    return t`Syntheo cannot reach ${providerName}`;
  }

  return t`${providerName} stopped sending text`;
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
  // Règle audio de Syntheo : rien n'est conservé, la coupure manquera à la
  // transcription.
  if (!isRetriedAutomatically(degraded)) {
    return t`Live transcription paused: ${cause}. No audio is kept: this passage will be missing from the transcription. Check the transcription server settings.`;
  }
  return t`Live transcription paused: ${cause}. No audio is kept: this passage will be missing from the transcription. Reconnecting…`;
}

export function getLiveTranscriptResumedMessage() {
  return t`Live transcription resumed.`;
}
