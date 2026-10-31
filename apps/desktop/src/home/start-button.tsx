import { Trans, useLingui } from "@lingui/react/macro";

import { Microphone } from "@syntheo/ui/components/icons";
import { cn } from "@syntheo/utils";

// Kanji d'ornement des trois étapes (identite.md § Clins d'œil).
const STEPS = [
  { kanji: "備", key: "prepare" },
  { kanji: "聴", key: "listen" },
  { kanji: "結", key: "synthesis" },
] as const;

// Le seul bouton `primary` de l'accueil : crée une note et l'ouvre.
export function StartButton({
  onStart,
  busy = false,
  modifierLabel = "Ctrl",
}: {
  onStart: () => void;
  busy?: boolean;
  modifierLabel?: string;
}) {
  const { t } = useLingui();
  const labels: Record<(typeof STEPS)[number]["key"], string> = {
    prepare: t`Prepare`,
    listen: t`Listen`,
    synthesis: t`Synthesis`,
  };
  const shortcut = `${modifierLabel} N`;

  return (
    <button
      type="button"
      onClick={onStart}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-keyshortcuts={modifierLabel === "⌘" ? "Meta+N" : "Control+N"}
      data-start-button
      className={cn([
        "bg-primary text-primary-foreground hover:bg-primary-hover",
        "flex w-full items-center gap-[18px] rounded-2xl px-6 py-[22px] text-left",
        "motion-safe:transition-colors",
        "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:cursor-progress disabled:opacity-80",
      ])}
    >
      <span
        aria-hidden="true"
        className="bg-primary-foreground/15 grid size-[52px] flex-none place-items-center rounded-[14px]"
      >
        <Microphone className="size-6" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[19px] leading-snug font-semibold">
          <Trans>Start a meeting</Trans>
        </span>
        <span className="text-sm opacity-75">
          <Trans>Title and participants taken from the calendar</Trans>
        </span>
        <span data-steps className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {STEPS.map((step) => (
            <span
              key={step.key}
              className="border-primary-foreground/25 rounded-pill border px-[9px] py-px opacity-85"
            >
              <span aria-hidden="true" className="font-kanji mr-1 opacity-70">
                {step.kanji}
              </span>
              {labels[step.key]}
            </span>
          ))}
        </span>
      </span>
      <kbd
        aria-hidden="true"
        className="border-primary-foreground/30 ml-auto flex-none rounded-md border px-[7px] py-0.5 font-[inherit] text-xs opacity-80"
      >
        {shortcut}
      </kbd>
    </button>
  );
}
