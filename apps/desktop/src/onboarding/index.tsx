import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { useCallback, useEffect, useState } from "react";

import { commands as sfxCommands } from "@syntheo/plugin-sfx";
import { SpeakerHigh, SpeakerX } from "@syntheo/ui/components/icons";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";
import { cn } from "@syntheo/utils";

import { CalendarSection } from "./calendar";
import {
  getInitialStep,
  getNextStep,
  getPrevStep,
  getStepStatus,
} from "./config";
import { FinalDescription, FinalSection, finishOnboarding } from "./final";
import { ImportSection } from "./imports";
import { PermissionsSection } from "./permissions";
import { OnboardingSection } from "./shared";

import { StandaloneWindowShell } from "~/shared/window-shell";
import { type Tab, useTabs } from "~/store/zustand/tabs";

export function TabContentOnboarding({
  tab: _tab,
}: {
  tab: Extract<Tab, { type: "onboarding" }>;
}) {
  const openCurrent = useTabs((state) => state.openCurrent);

  const handleFinish = useCallback(
    (sessionId: string) => {
      openCurrent({ type: "sessions", id: sessionId });
    },
    [openCurrent],
  );

  return <OnboardingScreen onFinish={handleFinish} />;
}

function OnboardingScreen({
  onFinish,
}: {
  onFinish: (sessionId: string) => void;
}) {
  return (
    <OnboardingScreenContent
      onFinish={onFinish}
      headerClassName="px-12 pt-4 pb-8"
      headerDragRegion
    />
  );
}

export function StandaloneOnboardingScreen({
  onFinish,
}: {
  onFinish: (sessionId: string) => void;
}) {
  return (
    <StandaloneWindowShell>
      <OnboardingScreenContent
        onFinish={onFinish}
        headerClassName="px-12 pt-4 pb-8"
        headerDragRegion
      />
    </StandaloneWindowShell>
  );
}

function OnboardingScreenContent({
  onFinish,
  headerClassName,
  headerDragRegion = false,
}: {
  onFinish: (sessionId: string) => void;
  headerClassName: string;
  headerDragRegion?: boolean;
}) {
  const queryClient = useQueryClient();
  const [isMuted, setIsMuted] = useState(false);
  const [currentStep, setCurrentStep] = useState(getInitialStep);
  const currentPlatform = platform();

  const goNext = useCallback(() => {
    const next = getNextStep(currentStep);
    if (next) setCurrentStep(next);
  }, [currentPlatform, currentStep]);

  const skipCurrentStep = useCallback(() => {
    const next = getNextStep(currentStep);
    if (next) setCurrentStep(next);
  }, [currentPlatform, currentStep]);

  const goBack = useCallback(() => {
    const prev = getPrevStep(currentStep);
    if (prev) setCurrentStep(prev);
  }, [currentStep]);

  useEffect(() => {}, [currentPlatform, currentStep]);

  useMountEffect(() => {
    sfxCommands.play("BGM").catch(console.error);
    return () => {
      sfxCommands.stop("BGM").catch(console.error);
    };
  });

  useEffect(() => {
    sfxCommands.setVolume("BGM", isMuted ? 0 : 0.2).catch(console.error);
  }, [isMuted]);

  const handleFinish = useCallback(
    (sessionId: string) => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding-needed"] });
      onFinish(sessionId);
    },
    [currentPlatform, onFinish, queryClient],
  );

  return (
    <div className="bg-background relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        data-tauri-drag-region={headerDragRegion || undefined}
        className="relative z-30 flex h-12 shrink-0 items-center justify-end pr-3 pl-12"
      >
        <button
          onClick={() => setIsMuted((prev) => !prev)}
          data-tauri-drag-region="false"
          className="hover:bg-accent rounded-full p-1.5 transition-colors"
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? (
            <SpeakerX size={16} className="text-muted-foreground" />
          ) : (
            <SpeakerHigh size={16} className="text-muted-foreground" />
          )}
        </button>
      </div>

      <div
        data-tauri-drag-region={headerDragRegion || undefined}
        className={cn([
          "relative z-10 flex shrink-0 items-center",
          headerClassName,
        ])}
      >
        <h1 className="font-hand text-foreground text-4xl leading-none font-semibold tracking-normal">
          <Trans>Welcome to Syntheo</Trans>
        </h1>
      </div>

      <div className="scroll-fade-y relative z-10 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-12 pb-16">
          <OnboardingSection
            title={<Trans>Start with permissions</Trans>}
            completedTitle={<Trans>Permissions granted</Trans>}
            description={
              currentPlatform === "macos" ? (
                <Trans>
                  Syntheo needs microphone and system audio to transcribe your
                  meetings, plus Accessibility to read meeting controls, visible
                  chat.
                </Trans>
              ) : (
                <Trans>
                  Syntheo needs access to your microphone and system audio to
                  record and transcribe your meetings
                </Trans>
              )
            }
            status={getStepStatus("permissions", currentStep)}
            skippable={false}
            onBack={goBack}
            onNext={goNext}
          >
            <PermissionsSection onContinue={goNext} />
          </OnboardingSection>

          <OnboardingSection
            title={<Trans>Connect calendar</Trans>}
            description={
              <Trans>
                Syntheo lit votre calendrier local pour vous rappeler vos
                réunions
              </Trans>
            }
            completedTitle={<Trans>Calendar connected</Trans>}
            status={getStepStatus("calendar", currentStep)}
            onBack={goBack}
            onNext={goNext}
            onSkip={skipCurrentStep}
          >
            <CalendarSection onContinue={goNext} />
          </OnboardingSection>

          <OnboardingSection
            title={<Trans>Bring your meeting history</Trans>}
            description={
              <Trans>
                Import notes and transcripts from the meeting apps you already
                use.
              </Trans>
            }
            completedTitle={<Trans>Meeting history imported</Trans>}
            status={getStepStatus("imports", currentStep)}
            onBack={goBack}
            onNext={goNext}
            onSkip={skipCurrentStep}
          >
            <ImportSection onContinue={goNext} onSkip={skipCurrentStep} />
          </OnboardingSection>

          <OnboardingSection
            title={<Trans>Ready to go</Trans>}
            description={<FinalDescription />}
            status={getStepStatus("final", currentStep)}
            skippable={false}
            onBack={goBack}
            onNext={() => void finishOnboarding(handleFinish)}
          >
            <FinalSection onContinue={handleFinish} />
          </OnboardingSection>
        </div>
      </div>
    </div>
  );
}
