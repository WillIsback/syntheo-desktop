import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";

import { Warning } from "@syntheo/ui/components/icons";
import { toast } from "@syntheo/ui/components/ui/toast";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";

import { useConnectionHealth } from "./health";
import {
  getLanguageSupportIssue,
  resolveLiveLanguageSupportMode,
} from "./selection";
import { displayModelLabel } from "./shared";

import { getBaseLanguageDisplayName } from "~/settings/general/language";
import { useConfigValues } from "~/shared/config";
import {
  isConfiguredSttModel,
  isLiveTranscriptionSupported,
  isSupportedLanguagesBatch,
  isSupportedLanguagesLive,
} from "~/stt/capabilities";

const TRANSCRIPTION_LANGUAGE_WARNING_TOAST_ID =
  "transcription-language-warning";
const MAX_DISMISSED_TRANSCRIPTION_LANGUAGE_WARNINGS = 128;
const DISMISSED_TRANSCRIPTION_LANGUAGE_WARNINGS_KEY =
  "syntheo:dismissed-transcription-language-warnings";

function rememberDismissedTranscriptionLanguageWarning(warningKey: string) {
  try {
    const warnings = readDismissedTranscriptionLanguageWarnings().filter(
      (key) => key !== warningKey,
    );
    warnings.push(warningKey);
    localStorage.setItem(
      DISMISSED_TRANSCRIPTION_LANGUAGE_WARNINGS_KEY,
      JSON.stringify(
        warnings.slice(-MAX_DISMISSED_TRANSCRIPTION_LANGUAGE_WARNINGS),
      ),
    );
  } catch {
    return;
  }
}

function isTranscriptionLanguageWarningDismissed(warningKey: string) {
  return readDismissedTranscriptionLanguageWarnings().includes(warningKey);
}

function readDismissedTranscriptionLanguageWarnings(): string[] {
  try {
    const stored = JSON.parse(
      localStorage.getItem(DISMISSED_TRANSCRIPTION_LANGUAGE_WARNINGS_KEY) ??
        "[]",
    );
    return Array.isArray(stored)
      ? stored.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

export function TranscriptionLanguageWarningToast() {
  const { i18n, t } = useLingui();
  const warning = useTranscriptionLanguageWarning();

  if (!warning || isTranscriptionLanguageWarningDismissed(warning.key)) {
    return null;
  }

  const model = displayModelLabel(warning.model);
  const unsupportedLanguages = warning.unsupportedLanguages.map((language) =>
    getBaseLanguageDisplayName(language, i18n.locale),
  );
  const languages = formatLanguageList(
    unsupportedLanguages,
    (count) => t`${count} more`,
  );
  const description =
    unsupportedLanguages.length > 0
      ? t`${model} can't transcribe ${languages}. Try another model or change your spoken languages.`
      : t`${model} can't transcribe all selected languages together. Try another model or use fewer spoken languages.`;

  return (
    <TranscriptionLanguageWarningToastLifecycle
      key={warning.key}
      warningKey={warning.key}
      description={description}
      actionLabel={t`Got it`}
    />
  );
}

function TranscriptionLanguageWarningToastLifecycle({
  warningKey,
  description,
  actionLabel,
}: {
  warningKey: string;
  description: string;
  actionLabel: string;
}) {
  useMountEffect(() => {
    let shouldRememberDismissal = true;
    toast.warning(description, {
      id: TRANSCRIPTION_LANGUAGE_WARNING_TOAST_ID,
      duration: Infinity,
      icon: <Warning className="text-alert-foreground size-4 shrink-0" />,
      action: {
        label: actionLabel,
        onClick: () => {
          shouldRememberDismissal = false;
          rememberDismissedTranscriptionLanguageWarning(warningKey);
          clearTranscriptionLanguageWarningToast();
        },
      },
      onDismiss: () => {
        if (shouldRememberDismissal) {
          rememberDismissedTranscriptionLanguageWarning(warningKey);
        }
      },
    });

    return () => {
      shouldRememberDismissal = false;
      clearTranscriptionLanguageWarningToast();
    };
  });

  return null;
}

function clearTranscriptionLanguageWarningToast() {
  toast.dismiss(TRANSCRIPTION_LANGUAGE_WARNING_TOAST_ID);
}

function useTranscriptionLanguageWarning() {
  const {
    ai_language,
    current_stt_provider,
    current_stt_model,
    spoken_languages,
  } = useConfigValues([
    "ai_language",
    "current_stt_provider",
    "current_stt_model",
    "spoken_languages",
  ] as const);
  const health = useConnectionHealth();

  const selectedSttModel = isConfiguredSttModel(
    current_stt_provider,
    current_stt_model,
  )
    ? current_stt_model
    : undefined;
  const isConfigured = !!(current_stt_provider && selectedSttModel);
  const hasError = isConfigured && health.status === "error";
  const liveSupport = useQuery({
    queryKey: ["stt-live-support", current_stt_provider, selectedSttModel],
    queryFn: () =>
      isLiveTranscriptionSupported(current_stt_provider, selectedSttModel),
    enabled: isConfigured,
  });
  const useLiveMode = resolveLiveLanguageSupportMode({
    isOnDeviceModel: false,
    useLiveOnDeviceModel: false,
    liveSupported: liveSupport.data,
  });

  const languageSupportIssue = useQuery({
    queryKey: [
      "stt-language-support",
      current_stt_provider,
      selectedSttModel,
      useLiveMode,
      ai_language,
      spoken_languages,
    ],
    queryFn: async () => {
      const isSupported = (languages: readonly string[]) =>
        useLiveMode
          ? isSupportedLanguagesLive(
              current_stt_provider!,
              selectedSttModel ?? null,
              languages,
            )
          : isSupportedLanguagesBatch(
              current_stt_provider!,
              selectedSttModel ?? null,
              languages,
            );

      return await getLanguageSupportIssue(
        ai_language,
        spoken_languages,
        isSupported,
      );
    },
    enabled: isConfigured && liveSupport.data !== undefined && !!ai_language,
  });

  if (
    !isConfigured ||
    !selectedSttModel ||
    !languageSupportIssue.data ||
    hasError
  ) {
    return null;
  }

  return {
    key: [
      current_stt_provider,
      selectedSttModel,
      ai_language,
      ...(spoken_languages ?? []),
    ].join(":"),
    model: selectedSttModel,
    unsupportedLanguages: languageSupportIssue.data.unsupportedLanguages,
  };
}

function formatLanguageList(
  languages: string[],
  moreLabel: (count: number) => string,
) {
  const visibleLanguages = languages.slice(0, 3);
  const remainingCount = languages.length - visibleLanguages.length;

  if (remainingCount > 0) {
    visibleLanguages.push(moreLabel(remainingCount));
  }

  return visibleLanguages.join(", ");
}
