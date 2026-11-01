import { useLingui } from "@lingui/react";
import { Trans, useLingui as useLinguiMacro } from "@lingui/react/macro";
import { useRef, useState } from "react";

import { CircleNotch } from "@syntheo/ui/components/icons";

import { OnboardingButton } from "./shared";
import {
  getOrCreateWelcomeSession,
  setPendingWelcomeSession,
} from "./welcome-note";

import { STAGE_KANJI } from "~/session/components/capsule";
import {
  NOTE_STAGES,
  type NoteStage,
} from "~/session/components/capsule/stage";
import { NoteSeal } from "~/session/components/living-document/provenance";
import { createSession } from "~/session/queries";
import { flushAutomaticRelaunch } from "~/shared/relaunch";
import { commands } from "~/types/tauri.gen";

// Récit du thé en version courte (identite.md § Récit) : les trois temps d'une
// note, chacun avec son kanji d'ornement, puis le sceau 記 de la note terminée.
export function FinalDescription() {
  const { t } = useLinguiMacro();
  const steps: Record<NoteStage, { label: string; text: string }> = {
    prepare: {
      label: t`Prepare`,
      text: t`Before the meeting, choose its type and add the participants.`,
    },
    listen: {
      label: t`Listen`,
      text: t`Take your notes while the transcript scrolls in the margin.`,
    },
    synthesis: {
      label: t`Synthesis`,
      text: t`Syntheo completes your notes into a meeting summary.`,
    },
  };

  return (
    <div data-onboarding-story className="flex flex-col gap-3">
      <p>
        <Trans>Syn·thé·o: what gathers around tea.</Trans>
      </p>
      <ol className="flex flex-col gap-1.5">
        {NOTE_STAGES.map((stage) => (
          <li key={stage} className="flex items-baseline gap-2.5">
            <span
              aria-hidden="true"
              className="font-kanji text-primary w-4 shrink-0 text-[15px] opacity-60"
            >
              {STAGE_KANJI[stage]}
            </span>
            <span>
              <span className="text-foreground font-medium">
                {steps[stage].label}
              </span>{" "}
              · {steps[stage].text}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-end gap-3">
        <p>
          <Trans>
            A meeting can't be replayed: audio is never kept, only the note
            remains. Your notes belong to you.
          </Trans>
        </p>
        <NoteSeal />
      </div>
    </div>
  );
}

export function FinalSection({
  onContinue,
}: {
  onContinue: (sessionId: string) => void;
}) {
  const { i18n } = useLingui();
  const translate = i18n._.bind(i18n);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const finishPromiseRef = useRef<Promise<void> | null>(null);
  const welcomeSessionRef = useRef<string | null>(null);

  const handleContinue = async () => {
    if (finishPromiseRef.current) return;

    setStatus("loading");
    const finishPromise = finishOnboarding(onContinue, welcomeSessionRef);
    finishPromiseRef.current = finishPromise;
    try {
      await finishPromise;
    } catch (error) {
      console.error("Failed to finish onboarding", error);
      setStatus("error");
    } finally {
      finishPromiseRef.current = null;
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <OnboardingButton
        className="px-6 py-2 text-sm disabled:cursor-wait disabled:opacity-70"
        disabled={status === "loading"}
        onClick={() => void handleContinue()}
      >
        {status === "loading" ? (
          <span className="flex items-center gap-2">
            <CircleNotch className="size-4 animate-spin" />
            <Trans>Open Syntheo</Trans>
          </span>
        ) : (
          <Trans>Open Syntheo</Trans>
        )}
      </OnboardingButton>
      {status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          {translate({
            id: "onboarding.finish-error",
            message: "Couldn't open Syntheo. Please try again.",
          })}
        </p>
      )}
    </div>
  );
}

export async function finishOnboarding(
  onContinue?: (sessionId: string) => void,
  welcomeSessionRef?: { current: string | null },
) {
  const welcomeSessionId =
    welcomeSessionRef?.current ??
    (await getOrCreateWelcomeSession().catch((error) => {
      console.error("Failed to create welcome note", error);
      return createSession();
    }));
  if (welcomeSessionRef) {
    welcomeSessionRef.current = welcomeSessionId;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const result = await commands.setOnboardingNeeded(false);
  if (result.status === "error") {
    throw new Error(result.error);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  setPendingWelcomeSession(welcomeSessionId);
  if (await flushAutomaticRelaunch()) {
    return;
  }
  setPendingWelcomeSession(null);
  onContinue?.(welcomeSessionId);
}
