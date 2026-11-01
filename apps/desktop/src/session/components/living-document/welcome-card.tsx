import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentType } from "react";

import { Sparkle, Sun, Waveform } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";

import { WELCOME_NOTE_TRACKING_ID } from "~/onboarding/welcome-note.constants";
import { useSession } from "~/session/queries";
import { type SettingsTab, useTabs } from "~/store/zustand/tabs";

// Une note ne peut contenir que du texte : les trois réglages essentiels sont
// proposés en vrais boutons, au-dessus de la seule note de bienvenue.
export function WelcomeCard({ sessionId }: { sessionId: string }) {
  const eventJson = useSession(sessionId)?.event_json;
  if (!isWelcomeNote(eventJson)) return null;
  return <WelcomeSettings />;
}

export function isWelcomeNote(eventJson: string | null | undefined): boolean {
  if (!eventJson) return false;
  try {
    const event = JSON.parse(eventJson) as { tracking_id?: unknown };
    return event.tracking_id === WELCOME_NOTE_TRACKING_ID;
  } catch {
    return false;
  }
}

function WelcomeSettings() {
  const { t } = useLingui();
  const openNew = useTabs((state) => state.openNew);
  const shortcuts: Array<{
    tab: SettingsTab;
    label: string;
    hint: string;
    icon: ComponentType<{ className?: string }>;
  }> = [
    {
      tab: "appearance",
      label: t`Appearance`,
      hint: t`Theme and palette`,
      icon: Sun,
    },
    {
      tab: "transcription",
      label: t`Transcription`,
      hint: t`Server that turns speech into text`,
      icon: Waveform,
    },
    {
      tab: "intelligence",
      label: t`Synthesis`,
      hint: t`Server that writes the summary`,
      icon: Sparkle,
    },
  ];

  return (
    <section
      data-welcome-card
      aria-labelledby="welcome-card-title"
      className="border-border bg-card rounded-lg border px-4 py-3"
    >
      <h2
        id="welcome-card-title"
        className="text-foreground mb-2 text-[15px] font-medium"
      >
        <Trans>Three settings to get started</Trans>
      </h2>
      <div className="flex flex-wrap gap-2">
        {shortcuts.map(({ tab, label, hint, icon: Icon }) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant="outline"
            title={hint}
            onClick={() => openNew({ type: "settings", state: { tab } })}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Button>
        ))}
      </div>
    </section>
  );
}
