import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import type { AIProviderStorage } from "@syntheo/store";
import { Warning } from "@syntheo/ui/components/icons";
import { Input } from "@syntheo/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@syntheo/ui/components/ui/select";
import { toast } from "@syntheo/ui/components/ui/toast";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";
import { cn } from "@syntheo/utils";

import { HealthStatusIndicator, useConnectionHealth } from "./health";
import {
  getDefaultSttSelection,
  getLanguageSupportIssue,
  resolveLiveLanguageSupportMode,
} from "./selection";
import { displayModelLabel, type ProviderId, PROVIDERS } from "./shared";

import { useBillingAccess } from "~/billing/billing-context";
import {
  providerRowId,
  ProviderIconSlot,
  useProviderAvailability,
} from "~/settings/ai/shared";
import {
  getProviderSelectionBlockers,
  requiresEntitlement,
} from "~/settings/ai/shared/eligibility";
import { PersistAiSelection } from "~/settings/ai/shared/persist-selection";
import {
  getConfiguredProviderIds,
  getConfiguredProviders,
  getVisibleModelSelection,
} from "~/settings/ai/shared/selection";
import { getBaseLanguageDisplayName } from "~/settings/general/language";
import { useAiProvidersState } from "~/settings/providers";
import { useSetSettingValues } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";
import { SettingsAlertToast } from "~/shared/ui/settings-alert";
import {
  isConfiguredSttModel,
  isLiveTranscriptionSupported,
  isSupportedLanguagesBatch,
  isSupportedLanguagesLive,
} from "~/stt/capabilities";
import {
  getDefaultSttModel,
  getPreferredProviderModel,
} from "~/stt/model-selection";

export function SelectProviderAndModel() {
  const { t } = useLingui();
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const);
  const billing = useBillingAccess();
  const { providers: configuredProviders, isReady: providerSettingsReady } =
    useConfiguredMapping();
  const health = useConnectionHealth();
  const [pendingProvider, setPendingProvider] = useState<ProviderId | null>(
    null,
  );

  const selectedSttModel = isConfiguredSttModel(
    current_stt_provider,
    current_stt_model,
  )
    ? current_stt_model
    : undefined;
  const selectedProvider = current_stt_provider as ProviderId | undefined;
  const selectedProviderConfigured = selectedProvider
    ? (configuredProviders[selectedProvider]?.configured ?? false)
    : false;
  const visibleSelection = getVisibleModelSelection(
    selectedProvider,
    selectedSttModel,
    selectedProviderConfigured,
  );
  const selectableProviders = PROVIDERS.filter(({ disabled }) => !disabled);
  const configuredProviderIds = getConfiguredProviderIds(
    selectableProviders,
    configuredProviders,
    selectedProvider,
  );
  const defaultSelection =
    providerSettingsReady && !visibleSelection.model
      ? getDefaultSttSelection(
          configuredProviderIds,
          configuredProviders,
          selectedProvider,
          current_stt_model,
        )
      : null;
  const effectiveSelection = pendingProvider
    ? { provider: pendingProvider, model: "" }
    : (defaultSelection ?? visibleSelection);
  const visibleProvider = effectiveSelection.provider as ProviderId | "";
  const isConfigured = !!(visibleProvider && effectiveSelection.model);
  const hasError = isConfigured && health.status === "error";
  const alertDescription = !providerSettingsReady
    ? undefined
    : !isConfigured
      ? t`Choose a transcription model to start listening.`
      : hasError
        ? health.message
        : undefined;
  const displayedSttModel = effectiveSelection.model;
  const providerOptions = getConfiguredProviders(
    selectableProviders,
    configuredProviders,
  );

  const setSelection = useSetSettingValues();
  const lastSelectedModelsRef = useRef<Record<string, string>>(
    current_stt_provider && selectedSttModel
      ? { [current_stt_provider]: selectedSttModel }
      : {},
  );
  const rememberModel = (provider?: string, model?: string) => {
    if (!provider || model === undefined) {
      return;
    }

    lastSelectedModelsRef.current[provider] = model;
  };

  const handleProviderChange = (provider: string) => {
    rememberModel(current_stt_provider, selectedSttModel);

    const providerId = provider as ProviderId;
    const nextModels = configuredProviders[providerId]?.models ?? [];
    const nextModel =
      getPreferredProviderModel(
        lastSelectedModelsRef.current[provider],
        nextModels,
        { allowSavedModelWithoutChoices: true },
      ) ||
      getDefaultSttModel(providerId) ||
      "";

    if (!nextModel) {
      setPendingProvider(providerId);
      setSelection({
        current_stt_provider: provider,
        current_stt_model: "",
      });
      return;
    }

    setPendingProvider(null);
    rememberModel(provider, nextModel);
    setSelection({
      current_stt_provider: provider,
      current_stt_model: nextModel,
    });
  };

  const handleModelChange = (model: string) => {
    if (!visibleProvider) {
      return;
    }

    rememberModel(visibleProvider, model);
    setPendingProvider(null);
    setSelection({
      current_stt_provider: visibleProvider,
      current_stt_model: model,
    });
  };
  return (
    <div className="flex flex-col gap-4">
      {defaultSelection && !pendingProvider ? (
        <PersistAiSelection
          key={`stt:${defaultSelection.provider}:${defaultSelection.model}`}
          type="stt"
          provider={defaultSelection.provider}
          model={defaultSelection.model}
        />
      ) : null}
      <SettingsAlertToast
        id="stt-settings-alert"
        description={alertDescription}
        variant={hasError ? "error" : "warning"}
        lifecycle="condition-bound"
      />
      {!alertDescription && <TranscriptionLanguageWarningToast />}

      <h3 className="text-md font-sans font-semibold">
        <Trans>Model being used</Trans>
      </h3>
      <div className="flex flex-row items-center gap-4">
        <div className="min-w-0 flex-2" data-stt-provider-selector>
          <Select value={visibleProvider} onValueChange={handleProviderChange}>
            <SelectTrigger
              corners={{ radius: 18, smoothing: 0 }}
              className="bg-card rounded-[18px] shadow-none"
            >
              <SelectValue placeholder={t`Select a provider`} />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.length === 0 && (
                <div className="text-muted-foreground px-2 py-3 text-center text-sm">
                  <Trans>No providers found.</Trans>
                </div>
              )}
              {providerOptions.map((provider) => {
                const configured =
                  configuredProviders[provider.id]?.configured ?? false;
                const requiresPro = requiresEntitlement(
                  provider.requirements,
                  "pro",
                );
                const locked = requiresPro && !billing.isPaid;
                return (
                  <SelectItem
                    key={provider.id}
                    value={provider.id}
                    disabled={provider.disabled || locked}
                    className={cn([
                      "data-disabled:text-muted-foreground data-disabled:!opacity-100",
                      !configured && !locked && "text-muted-foreground",
                    ])}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <ProviderIconSlot>{provider.icon}</ProviderIconSlot>
                        <span>{provider.displayName}</span>
                        {requiresPro ? (
                          <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase">
                            <Trans>Pro</Trans>
                          </span>
                        ) : null}
                      </div>
                      {locked ? (
                        <span className="text-muted-foreground text-[11px]">
                          <Trans>Upgrade to Pro to use this provider.</Trans>
                        </span>
                      ) : "description" in provider && provider.description ? (
                        <span className="text-muted-foreground text-[11px]">
                          {provider.description}
                        </span>
                      ) : null}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <span className="text-muted-foreground">/</span>

        <div className="flex min-w-0 flex-3 items-center gap-2">
          <Input
            value={displayedSttModel || ""}
            onChange={(event) => handleModelChange(event.target.value)}
            className="text-xs"
            placeholder={t`Enter a model identifier`}
          />
          {isConfigured && <HealthStatusIndicator />}
        </div>
      </div>
    </div>
  );
}

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

function TranscriptionLanguageWarningToast() {
  const { i18n, t } = useLingui();
  const warning = useTranscriptionLanguageWarning();

  if (!warning || isTranscriptionLanguageWarningDismissed(warning.key)) {
    return null;
  }

  const model = displayModelLabel(warning.model);
  const unsupportedLanguages = warning.unsupportedLanguages.map((language) =>
    getBaseLanguageDisplayName(language, i18n.locale),
  );
  const description =
    unsupportedLanguages.length > 0
      ? t`${model} can't transcribe ${formatLanguageList(unsupportedLanguages)}. Try another model or change your spoken languages.`
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
      icon: <Warning className="size-4 shrink-0 text-amber-500" />,
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

function formatLanguageList(languages: string[]) {
  const visibleLanguages = languages.slice(0, 3);
  const remainingCount = languages.length - visibleLanguages.length;

  if (remainingCount > 0) {
    visibleLanguages.push(`${remainingCount} more`);
  }

  return visibleLanguages.join(", ");
}

type ModelEntry = {
  id: string;
  isDownloaded: boolean;
};

export function useConfiguredMapping(): {
  providers: Record<
    ProviderId,
    {
      configured: boolean;
      models: ModelEntry[];
    }
  >;
  isReady: boolean;
} {
  const billing = useBillingAccess();
  const availability = useProviderAvailability("stt", PROVIDERS);
  const { providers: configuredProviders, isReady } =
    useAiProvidersState("stt");

  const providers = Object.fromEntries(
    PROVIDERS.map((provider) => {
      const config = configuredProviders[providerRowId("stt", provider.id)] as
        | AIProviderStorage
        | undefined;
      const baseUrl = String(config?.base_url || provider.baseUrl || "").trim();
      const apiKey = String(config?.api_key || "").trim();

      const eligible =
        getProviderSelectionBlockers(provider.requirements, {
          isAuthenticated: true,
          isPaid: billing.isPaid,
          config: { base_url: baseUrl, api_key: apiKey },
        }).length === 0;

      // Le modèle servi par l'endpoint on-prem est saisi librement.
      return [
        provider.id,
        { configured: eligible, models: [] as ModelEntry[] },
      ];
    }),
  ) as Record<
    ProviderId,
    {
      configured: boolean;
      models: ModelEntry[];
    }
  >;

  return {
    providers,
    isReady:
      isReady &&
      Object.values(availability).every((value) => value !== undefined),
  };
}
