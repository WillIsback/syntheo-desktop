import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useId, useState } from "react";

import { CircleNotch } from "@syntheo/ui/components/icons";
import { cn } from "@syntheo/utils";

import type { ServerConnectionState, ServerFailure } from "./server-connection";

// Briques de la « carte serveur » (identite.md) : une carte par serveur,
// adresse en mono, « Tester la connexion », pastille d'état, modèles en
// boutons radio, « Avancé » replié.

export function ServerCard({
  title,
  status,
  children,
}: {
  title: ReactNode;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="border-border bg-card flex flex-col gap-3.5 rounded-[14px] border px-5 py-[18px]"
      data-server-card
    >
      <div className="flex flex-wrap items-center gap-2.5 text-sm">
        <h3 className="font-semibold">{title}</h3>
        {status}
      </div>
      {children}
    </section>
  );
}

export function ServerStatusChip({
  state,
  connectedLabel,
}: {
  state: ServerConnectionState;
  connectedLabel?: string;
}) {
  const { t } = useLingui();
  const chip = (tone: "good" | "bad" | "wait", label: string, busy = false) => (
    <span
      role="status"
      className={cn([
        "inline-flex items-center gap-[7px] rounded-full px-2.5 py-0.5 text-[13px] font-medium",
        tone === "good" && "bg-accent text-accent-foreground",
        tone === "bad" && "bg-alert text-alert-foreground",
        tone === "wait" && "bg-muted text-muted-foreground",
      ])}
    >
      {busy ? (
        <CircleNotch
          aria-hidden
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <i aria-hidden className="size-[7px] rounded-full bg-current" />
      )}
      {label}
    </span>
  );

  switch (state.status) {
    case "unconfigured":
      return chip("wait", t`No server yet`);
    case "untested":
      return chip("wait", t`Not tested`);
    case "testing":
      return chip("wait", t`Testing…`, true);
    case "connected":
      return chip(
        "good",
        connectedLabel ?? t`Connected · ${state.latencyMs} ms`,
      );
    case "failed":
      return chip(
        "bad",
        state.failure.reason === "unauthorized"
          ? t`Key refused`
          : state.failure.reason === "invalid_url"
            ? t`Invalid address`
            : t`Unreachable`,
      );
  }
}

export function ServerFailureBanner({
  kind,
  failure,
  baseUrl,
}: {
  kind: "stt" | "llm";
  failure: ServerFailure;
  baseUrl: string;
}) {
  const { t } = useLingui();
  const host = displayHost(baseUrl);
  let message: string;
  switch (failure.reason) {
    case "invalid_url":
      message = failure.message;
      break;
    case "unreachable":
      message = t`The server did not answer at ${host}. Check that it is running and that you are on the right network (VPN, Tailscale), then test again.`;
      break;
    case "unauthorized":
      message = t`The server refused the API key. Check it under “Advanced”, then test again.`;
      break;
    case "server_error": {
      const status = failure.status ?? 500;
      message = t`The server answered with an error (HTTP ${status}). It may still be starting: wait a minute, then test again.`;
      break;
    }
    case "not_found":
      message =
        kind === "llm"
          ? t`The server answers, but not as an OpenAI-compatible API. Check that the address ends with /v1, then test again.`
          : t`The server answers, but neither as an OpenAI server nor as an NVIDIA NIM. Check the address, then test again.`;
      break;
  }

  return (
    <div
      role="alert"
      className="border-alert-border bg-alert text-alert-foreground rounded-[10px] border px-3.5 py-2.5 text-sm"
    >
      {message}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground text-[13px] font-medium"
    >
      {children}
    </label>
  );
}

export const SERVER_INPUT_CLASS =
  "border-input bg-card focus-visible:ring-ring h-auto w-full rounded-[10px] border px-3 py-2 font-mono text-sm shadow-none";

export type ModelOption = { id: string; hint?: string };

export function ModelRadioList({
  label,
  models,
  value,
  onChange,
  footer,
}: {
  label: string;
  models: readonly ModelOption[];
  value: string;
  onChange: (model: string) => void;
  footer?: ReactNode;
}) {
  const labelId = useId();
  const { t } = useLingui();
  const isKnown = models.some((model) => model.id === value);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(isKnown ? "" : value);
  const showCustom = custom || (!!value && !isKnown) || models.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <span
        id={labelId}
        className="text-muted-foreground text-[13px] font-medium"
      >
        {label}
      </span>
      {models.length > 0 ? (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="flex flex-col gap-1.5"
        >
          {models.map((model) => {
            const checked = model.id === value;
            return (
              <button
                key={model.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  setCustom(false);
                  setDraft("");
                  onChange(model.id);
                }}
                className={cn([
                  "focus-visible:ring-ring flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
                  checked
                    ? "border-primary bg-accent"
                    : "border-border bg-background hover:bg-muted",
                ])}
              >
                <span
                  aria-hidden
                  className={cn([
                    "grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]",
                    checked ? "border-primary" : "border-input",
                  ])}
                >
                  {checked ? (
                    <span className="bg-primary size-2 rounded-full" />
                  ) : null}
                </span>
                <span className="min-w-0 truncate font-mono text-[13.5px] font-medium">
                  {model.id}
                </span>
                {model.hint ? (
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {model.hint}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {showCustom ? (
        <input
          aria-label={t`Model name`}
          className={SERVER_INPUT_CLASS}
          value={draft}
          placeholder={t`Model name served by your server`}
          onChange={(event) => {
            setCustom(true);
            setDraft(event.target.value);
            onChange(event.target.value.trim());
          }}
        />
      ) : null}
      <p className="text-muted-foreground text-[13px]">
        {footer}
        {!showCustom ? (
          <>
            {footer ? " " : null}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="text-primary underline underline-offset-[3px]"
            >
              <Trans>Enter another name</Trans>
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function ServerHelp({ children }: { children: ReactNode }) {
  return (
    <details className="group">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
        <Trans>Help</Trans>
      </summary>
      <div className="text-muted-foreground mt-2.5 flex flex-col gap-2 text-sm">
        {children}
      </div>
    </details>
  );
}

function displayHost(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return baseUrl;
  }
}
