import { platform } from "@tauri-apps/plugin-os";
import { useCallback, useMemo, useState } from "react";

import { HomeView } from "./home-view";
import type { NextMeeting } from "./next-meeting";
import { useNextMeeting, useOwnerFirstName, useRecentNotes } from "./queries";

import { getOrCreateSessionForEventId } from "~/session/queries";
import { useOpenNoteDialog } from "~/shared/open-note-dialog";
import { useNewNote } from "~/shared/useNewNote";
import { useTabs } from "~/store/zustand/tabs";

export { HomeView } from "./home-view";

function getPrimaryModifierLabel() {
  try {
    return platform() === "macos" ? "⌘" : "Ctrl";
  } catch {
    return "Ctrl";
  }
}

// Démarrer : si une réunion de l'agenda est imminente (ou en cours), on
// reprend la logique existante de création depuis un événement (titre et
// participants) ; sinon, une note vierge comme Ctrl N.
export function useStartMeeting(nextMeeting: NextMeeting | null) {
  const openCurrent = useTabs((state) => state.openCurrent);
  const newNote = useNewNote({ behavior: "current" });
  const [starting, setStarting] = useState(false);

  const start = useCallback(() => {
    if (starting) return;
    if (!nextMeeting?.imminent) {
      newNote();
      return;
    }
    setStarting(true);
    void getOrCreateSessionForEventId(
      nextMeeting.id,
      nextMeeting.title || undefined,
    )
      .then((sessionId) => {
        openCurrent({ type: "sessions", id: sessionId });
      })
      .catch((error) => {
        console.error("[home] failed to start meeting note", error);
      })
      .finally(() => {
        setStarting(false);
      });
  }, [newNote, nextMeeting, openCurrent, starting]);

  return { start, starting };
}

export function HomePage() {
  const firstName = useOwnerFirstName();
  const nextMeeting = useNextMeeting();
  const recentNotes = useRecentNotes();
  const openCurrent = useTabs((state) => state.openCurrent);
  // Ouvre la palette de recherche existante (même action que Ctrl K).
  const { open: openSearch } = useOpenNoteDialog();
  const { start, starting } = useStartMeeting(nextMeeting);
  const modifierLabel = useMemo(() => getPrimaryModifierLabel(), []);

  const openNote = useCallback(
    (sessionId: string) => openCurrent({ type: "sessions", id: sessionId }),
    [openCurrent],
  );

  return (
    <HomeView
      firstName={firstName}
      nextMeeting={nextMeeting}
      recentNotes={recentNotes}
      starting={starting}
      modifierLabel={modifierLabel}
      onStart={start}
      onOpenNote={openNote}
      onSearch={openSearch}
    />
  );
}
