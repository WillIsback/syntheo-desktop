import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { cn } from "@syntheo/utils";

import { LevelMeter } from "./level-meter";
import { NOTE_STAGES, type NoteStage } from "./stage";

export { getNoteStage, type NoteStage } from "./stage";

// Kanji d'ornement devant chaque étape (identite.md § Clins d'œil).
const STAGE_KANJI: Record<NoteStage, string> = {
  prepare: "備",
  listen: "聴",
  synthesis: "結",
};

export type CapsuleListening = {
  seconds?: number;
  amplitude?: number;
  muted: boolean;
  finalizing: boolean;
  // Chrono et vumètre branchés directement sur l'écoute : ils changent
  // chaque seconde et dix fois par seconde, la capsule n'a pas à suivre.
  elapsed?: ReactNode;
  meter?: ReactNode;
};

export type CapsuleActions = {
  onCancel?: () => void;
  onStart: () => void;
  startDisabled?: boolean;
  onStop: () => void;
  onCopy: () => void;
  copyDisabled?: boolean;
  onExport: () => void;
  onAsk: () => void;
};

export function NoteCapsule({
  stage,
  listening,
  actions,
  modifierLabel = "Ctrl",
}: {
  stage: NoteStage;
  listening?: CapsuleListening;
  actions: CapsuleActions;
  modifierLabel?: string;
}) {
  const { t } = useLingui();

  return (
    <div
      role="group"
      aria-label={t`Note capsule`}
      data-note-capsule
      data-stage={stage}
      className={cn([
        "bg-primary text-primary-foreground shadow-capsule rounded-pill pointer-events-auto",
        "flex max-w-full items-center gap-1.5 p-1.5 text-sm whitespace-nowrap",
      ])}
    >
      <CapsuleSteps stage={stage} />
      <span aria-hidden="true" className="bg-primary-foreground/30 h-5 w-px" />
      {stage === "prepare" ? (
        <>
          {actions.onCancel ? (
            <CapsuleButton onClick={actions.onCancel}>
              <Trans>Cancel</Trans>
            </CapsuleButton>
          ) : null}
          <CapsuleButton
            tone="recording"
            onClick={actions.onStart}
            disabled={actions.startDisabled}
            shortcut={`${modifierLabel} ⇧ N`}
          >
            <Trans>Begin listening</Trans>
          </CapsuleButton>
        </>
      ) : null}
      {stage === "listen" ? (
        <>
          <span className="flex items-center gap-2 px-2">
            <span
              aria-hidden="true"
              className="bg-recording size-2 rounded-full"
            />
            <span
              role="timer"
              aria-label={t`Listening time`}
              className="font-mono text-[13px] tabular-nums"
            >
              {listening?.elapsed ?? formatElapsed(listening?.seconds ?? 0)}
            </span>
            {listening?.meter ?? (
              <LevelMeter
                amplitude={listening?.amplitude ?? 0}
                muted={listening?.muted}
              />
            )}
          </span>
          <CapsuleButton
            tone="primary"
            onClick={actions.onStop}
            disabled={listening?.finalizing}
          >
            {listening?.finalizing ? (
              <Trans>Finishing…</Trans>
            ) : (
              <Trans>Finish</Trans>
            )}
          </CapsuleButton>
        </>
      ) : null}
      {stage === "synthesis" ? (
        <>
          <CapsuleButton
            onClick={actions.onCopy}
            disabled={actions.copyDisabled}
          >
            <Trans>Copy</Trans>
          </CapsuleButton>
          <CapsuleButton onClick={actions.onExport}>
            <Trans>Export</Trans>
          </CapsuleButton>
          <CapsuleButton
            tone="primary"
            onClick={actions.onAsk}
            shortcut={`${modifierLabel} J`}
          >
            <Trans>Ask the note</Trans>
          </CapsuleButton>
        </>
      ) : null}
    </div>
  );
}

function CapsuleSteps({ stage }: { stage: NoteStage }) {
  const { t } = useLingui();
  const labels: Record<NoteStage, string> = {
    prepare: t`Prepare`,
    listen: t`Listen`,
    synthesis: t`Synthesis`,
  };

  return (
    <ol
      aria-label={t`Note steps`}
      className="text-primary-foreground/70 flex items-center gap-1.5 pr-2.5 pl-2 text-[13px]"
    >
      {NOTE_STAGES.map((step, index) => {
        const current = step === stage;
        return (
          <li
            key={step}
            aria-current={current ? "step" : undefined}
            className={cn([
              "flex items-center gap-1.5",
              current && "text-primary-foreground font-semibold",
            ])}
          >
            {index > 0 ? (
              <span aria-hidden="true" className="font-normal opacity-70">
                ·
              </span>
            ) : null}
            <span>
              <span
                aria-hidden="true"
                className="font-kanji mr-1 text-[11px] opacity-60"
              >
                {STAGE_KANJI[step]}
              </span>
              {labels[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CapsuleButton({
  children,
  onClick,
  disabled,
  shortcut,
  tone = "ghost",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  tone?: "ghost" | "primary" | "recording";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={shortcut ? toAriaShortcut(shortcut) : undefined}
      className={cn([
        "rounded-pill inline-flex items-center px-3.5 py-[7px] transition-colors",
        "focus-visible:ring-primary-foreground focus-visible:ring-offset-primary focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:cursor-default disabled:opacity-60",
        tone === "ghost" && "hover:bg-primary-foreground/10",
        tone === "primary" &&
          "bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-semibold",
        tone === "recording" &&
          "bg-recording text-background font-semibold hover:brightness-110",
      ])}
    >
      {children}
      {shortcut ? (
        <kbd
          aria-hidden="true"
          className="ml-1.5 font-[inherit] text-[11px] font-normal opacity-60"
        >
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

function toAriaShortcut(shortcut: string) {
  return shortcut
    .replace("⌘", "Meta")
    .replace("⇧", "Shift")
    .split(" ")
    .filter(Boolean)
    .join("+");
}

export function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${pad(minutes)}:${pad(rest)}`;
}
