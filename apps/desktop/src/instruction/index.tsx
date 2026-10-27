import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { commands as openerCommands } from "@syntheo/plugin-opener2";
import { ArrowSquareOut, CaretLeft } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";
import { cn } from "@syntheo/utils";

import { WindowsWindowControls } from "~/main/windows-window-controls";
import { useLatestRef } from "~/shared/hooks/useLatestRef";
import { usesWindowsStyleTitleBar } from "~/shared/hooks/useWindowControlsGutter";

function useInstructionCleanup(onCleanup?: () => void) {
  const cleanupRef = useLatestRef(onCleanup);

  useMountEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  });
}

function InstructionShell({
  title,
  description,
  icon,
  onBack,
  onClose,
  action,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  onBack: () => void;
  onClose: () => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="from-background via-card to-card relative flex h-full flex-col overflow-hidden bg-linear-to-b select-none">
      <div className="from-muted/40 pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b to-transparent" />
      {usesWindowsStyleTitleBar() ? (
        <div
          data-tauri-drag-region
          className="absolute inset-x-0 top-0 z-20 flex h-10 justify-end"
        >
          <WindowsWindowControls onClose={onClose} />
        </div>
      ) : null}

      <div
        data-tauri-drag-region
        className="relative z-10 flex shrink-0 items-center px-3 pt-12"
      >
        <button
          type="button"
          onClick={onBack}
          className={cn([
            "text-muted-foreground hover:bg-muted/70 hover:text-muted-foreground flex h-9 items-center gap-1.5 rounded-full px-3 transition-colors",
          ])}
        >
          <CaretLeft className="h-4 w-4" />
          <span className="text-xs font-medium">
            <Trans>Back</Trans>
          </span>
        </button>
      </div>

      <div
        data-tauri-drag-region
        className="relative z-10 flex flex-1 items-center justify-center p-6"
      >
        <div className="flex w-full max-w-sm flex-col items-center gap-6 px-10 pb-10 text-center">
          {icon ?? (
            <img
              src="/assets/syntheo-icon.png"
              alt=""
              className="h-14 w-14 object-contain object-center"
            />
          )}

          <div className="flex max-w-full flex-col gap-3">
            <h2 className="text-foreground font-sans text-[22px] leading-[1.15] font-semibold break-words sm:text-[28px]">
              {title}
            </h2>
            <p className="text-muted-foreground text-sm leading-6">
              {description}
            </p>
          </div>

          {action ? <div className="w-full">{action}</div> : null}
          {children ? (
            <div className="flex w-full flex-col items-center gap-3">
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ExternalInstruction({
  title,
  description,
  icon,
  actionLabel,
  onBack,
  onClose,
  url,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  actionLabel: string;
  onBack: () => void;
  onClose: () => void;
  url?: string;
}) {
  return (
    <InstructionShell
      title={title}
      description={description}
      icon={icon}
      onBack={onBack}
      onClose={onClose}
      action={
        url ? (
          <Button
            variant="outline"
            className={cn([
              "bg-card text-muted-foreground hover:bg-background border-border h-10 w-full",
            ])}
            onClick={() => void openerCommands.openUrl(url, null)}
          >
            {actionLabel}
            <ArrowSquareOut className="size-3.5" />
          </Button>
        ) : undefined
      }
    />
  );
}

// Seul l'écran générique « continuer dans le navigateur » reste : connexion,
// facturation et intégrations cloud n'existent plus dans Syntheo.
export function InstructionScreen({
  onBack,
  onClose,
  url,
  onCleanup,
}: {
  onBack: () => void;
  onClose: () => void;
  url?: string;
  onCleanup?: () => void;
}) {
  const { t } = useLingui();
  useInstructionCleanup(onCleanup);

  return (
    <ExternalInstruction
      title={t`Open in your browser`}
      description={t`Continue in your browser, then return to Syntheo.`}
      actionLabel={t`Reopen in browser`}
      onBack={onBack}
      onClose={onClose}
      url={url}
    />
  );
}
