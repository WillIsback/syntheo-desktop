import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";

import {
  ProviderCredentialError,
  validateProviderBaseUrl,
} from "@syntheo/provider-validation";
import { CircleNotch } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";

import { FieldLabel, SERVER_INPUT_CLASS } from "./server-card";
import type { ServerKind } from "./server-connection";

import {
  isKeychainAccessError,
  repairKeychainAccess,
  useAiProvidersState,
  useClearAiProvider,
  useSetAiProvider,
} from "~/settings/providers";
import { setSettingValues } from "~/settings/queries";
import { SettingsAlertToast } from "~/shared/ui/settings-alert";

type Values = { base_url: string; api_key: string };

// Adresse et clé d'un serveur. Enregistrées au fil de la saisie (après une
// courte pause), comme avant : l'adresse dans les réglages, la clé dans le
// trousseau du système (voir `providers.ts`).
export function ServerAddressForm(props: {
  kind: ServerKind;
  providerId: string;
  label: ReactNode;
  placeholder: string;
  testing: boolean;
  onTest: () => void;
  isCurrentProvider: boolean;
}) {
  const { providers, isReady } = useAiProvidersState(props.kind);
  if (!isReady) return null;

  const stored = providers[`${props.kind}:${props.providerId}`];
  return (
    <ServerAddressFields
      key={`${props.kind}:${props.providerId}`}
      {...props}
      hasSaved={!!stored?.base_url || !!stored?.api_key}
      hasSavedAddress={!!String(stored?.base_url ?? "").trim()}
      initial={{
        base_url: String(stored?.base_url ?? ""),
        api_key: String(stored?.api_key ?? ""),
      }}
    />
  );
}

function ServerAddressFields({
  kind,
  providerId,
  label,
  placeholder,
  testing,
  onTest,
  isCurrentProvider,
  hasSaved,
  hasSavedAddress,
  initial,
}: {
  kind: ServerKind;
  providerId: string;
  label: ReactNode;
  placeholder: string;
  testing: boolean;
  onTest: () => void;
  isCurrentProvider: boolean;
  hasSaved: boolean;
  hasSavedAddress: boolean;
  initial: Values;
}) {
  const { t } = useLingui();
  const urlId = useId();
  const keyId = useId();
  const mutation = useSetAiProvider(kind, providerId);
  const clear = useClearAiProvider(kind, providerId);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [keychainError, setKeychainError] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      const baseUrl = value.base_url.trim();
      if (baseUrl) {
        try {
          validateProviderBaseUrl(baseUrl);
        } catch (error) {
          setUrlError(
            error instanceof ProviderCredentialError
              ? error.message
              : t`Enter a full address, for example ${placeholder}.`,
          );
          return;
        }
      }
      setUrlError(null);
      try {
        await mutation.mutateAsync({
          base_url: baseUrl,
          api_key: value.api_key.trim(),
        });
        setKeychainError(false);
      } catch (error) {
        if (isKeychainAccessError(error)) setKeychainError(true);
      }
    },
    listeners: {
      onChangeDebounceMs: 500,
      onChange: ({ formApi }) => {
        mutation.reset();
        queueMicrotask(() => void formApi.handleSubmit());
      },
    },
  });

  const repair = useMutation<void, Error>({
    mutationFn: repairKeychainAccess,
    onSuccess: async () => {
      await form.handleSubmit();
    },
  });

  const reset = async () => {
    try {
      await clear.mutateAsync();
      if (isCurrentProvider) {
        await setSettingValues(
          kind === "llm"
            ? { current_llm_provider: "", current_llm_model: "" }
            : { current_stt_model: "" },
        );
      }
      form.reset({ base_url: "", api_key: "" });
      setConfirmReset(false);
      setUrlError(null);
      mutation.reset();
    } catch {
      return;
    }
  };

  const saveError =
    mutation.error && !isKeychainAccessError(mutation.error)
      ? mutation.error.message
      : null;

  return (
    <>
      <SettingsAlertToast
        id={`provider-keychain-access:${kind}:${providerId}`}
        description={
          keychainError
            ? (repair.error?.message ??
              t`macOS cannot access your login Keychain. Repairing briefly locks it and asks for your Mac password before Syntheo retries this API key.`)
            : undefined
        }
        variant="error"
        lifecycle="condition-bound"
        action={
          repair.isPending
            ? undefined
            : {
                label: t`Repair Keychain Access`,
                onClick: () => repair.mutate(),
              }
        }
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={urlId}>{label}</FieldLabel>
        <div className="flex gap-2">
          <form.Field name="base_url">
            {(field) => (
              <input
                id={urlId}
                className={SERVER_INPUT_CLASS}
                value={field.state.value}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!urlError}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={testing || !hasSavedAddress}
            className="shrink-0"
          >
            {testing ? (
              <CircleNotch
                aria-hidden
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            <Trans>Test connection</Trans>
          </Button>
        </div>
        {urlError || saveError ? (
          <p role="alert" className="text-destructive text-[13px]">
            {urlError ?? saveError}
          </p>
        ) : null}
      </div>
      <details>
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
          <Trans>Advanced</Trans>
        </summary>
        <div className="mt-2.5 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={keyId}>
              <Trans>API key (optional)</Trans>
            </FieldLabel>
            <form.Field name="api_key">
              {(field) => (
                <input
                  id={keyId}
                  type="password"
                  className={SERVER_INPUT_CLASS}
                  value={field.state.value}
                  placeholder={t`Leave empty if the server has no authentication`}
                  autoComplete="off"
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </div>
          {hasSaved ? (
            confirmReset ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  <Trans>Forget this server's address and key?</Trans>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={clear.isPending}
                  onClick={() => void reset()}
                  className="text-alert-foreground"
                >
                  <Trans>Reset</Trans>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmReset(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmReset(true)}
                className="text-alert-foreground self-start px-0 hover:bg-transparent"
              >
                <Trans>Reset this server…</Trans>
              </Button>
            )
          ) : null}
          {clear.error ? (
            <p role="alert" className="text-destructive text-[13px]">
              {clear.error.message}
            </p>
          ) : null}
        </div>
      </details>
    </>
  );
}
