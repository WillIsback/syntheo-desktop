import { Trans, useLingui } from "@lingui/react/macro";

import { formatMeetingTime } from "./format";
import { HomeCapsule } from "./home-capsule";
import type { NextMeeting } from "./next-meeting";
import { NoteIndex } from "./note-index";
import type { RecentNote } from "./queries";
import { StartButton } from "./start-button";

import { type PaletteId, useDocumentPalette } from "~/shared/theme/palette";

// Filigrane de l'accueil selon la palette (maquette, objet PAL) : 茶 Thé vert,
// 藤 Glycine, 紅 Laque et encre.
const WATERMARK: Record<PaletteId, string> = {
  cha: "茶",
  fuji: "藤",
  enji: "紅",
};

export type HomeViewProps = {
  firstName: string;
  nextMeeting: NextMeeting | null;
  recentNotes: readonly RecentNote[];
  starting?: boolean;
  modifierLabel?: string;
  onStart: () => void;
  onOpenNote: (sessionId: string) => void;
  onSearch: () => void;
};

// Accueil guidé « Thé vert » (maquette piste C, écran Accueil) : colonne de
// 640px, salutation, prochaine réunion, bouton Démarrer, « Reprendre ».
export function HomeView({
  firstName,
  nextMeeting,
  recentNotes,
  starting = false,
  modifierLabel = "Ctrl",
  onStart,
  onOpenNote,
  onSearch,
}: HomeViewProps) {
  const palette = useDocumentPalette();

  return (
    <div
      data-tauri-drag-region
      data-home
      className="bg-background relative flex h-full min-h-0 flex-col overflow-hidden"
    >
      <span
        aria-hidden="true"
        data-home-watermark
        className="font-kanji text-primary pointer-events-none absolute top-16 right-12 text-[300px] leading-none font-bold opacity-[0.06] select-none"
      >
        {WATERMARK[palette]}
      </span>
      <div className="relative flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pt-6 pb-24">
        <div className="mt-10 flex w-[640px] max-w-full flex-col gap-[26px]">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-foreground font-serif text-[52px] leading-[1.05] font-medium tracking-[-0.01em] text-balance">
              {firstName ? (
                <Trans>Hello {firstName}.</Trans>
              ) : (
                <Trans>Hello.</Trans>
              )}
            </h1>
            {nextMeeting ? <NextMeetingLine meeting={nextMeeting} /> : null}
          </header>
          <StartButton
            onStart={onStart}
            busy={starting}
            modifierLabel={modifierLabel}
          />
          <NoteIndex notes={recentNotes} onOpen={onOpenNote} />
          <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
            <span
              aria-hidden="true"
              className="bg-primary size-[7px] rounded-full"
            />
            <Trans>Everything is processed on your local server</Trans>
          </p>
        </div>
      </div>
      <HomeCapsule onSearch={onSearch} modifierLabel={modifierLabel} />
    </div>
  );
}

function NextMeetingLine({ meeting }: { meeting: NextMeeting }) {
  const { t, i18n } = useLingui();
  const title = meeting.title || t`Untitled meeting`;
  const time = formatMeetingTime(meeting.startedAt, i18n.locale);

  return (
    <p data-next-meeting className="text-muted-foreground text-base">
      <Trans>Your next meeting:</Trans>{" "}
      <b className="text-foreground font-medium">{title}</b>
      {meeting.ongoing ? t`, in progress.` : t`, at ${time}.`}
    </p>
  );
}
