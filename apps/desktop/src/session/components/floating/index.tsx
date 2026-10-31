import { cn } from "@syntheo/utils";

import { SessionCapsule } from "../capsule/session-capsule";
import type { NoteStage } from "../capsule/stage";
import { setSessionFabSelectionHost } from "./selection-slot";

import { useShell } from "~/contexts/shell";
import type { EditorView, Tab } from "~/store/zustand/tabs/schema";

// La capsule remplace la barre « Posez toutes vos questions » : une seule par
// fenêtre, centrée en bas, avec l'action utile de l'étape en cours.
export function FloatingActionButton({
  currentView,
  stage,
  standaloneWindow = false,
  tab,
}: {
  currentView: EditorView;
  stage: NoteStage;
  standaloneWindow?: boolean;
  tab: Extract<Tab, { type: "sessions" }>;
}) {
  const { chat } = useShell();
  // Le chat flottant s'ouvre au même endroit : la capsule s'efface le temps
  // de la conversation.
  const chatCoversCapsule = chat.mode === "FloatingOpen";

  return (
    <div
      className={cn([
        "pointer-events-none absolute bottom-[22px] left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col-reverse items-center",
      ])}
    >
      <div
        className={cn([
          "peer/session-fab relative max-w-full",
          chatCoversCapsule && "invisible",
        ])}
        aria-hidden={chatCoversCapsule || undefined}
        inert={chatCoversCapsule || undefined}
      >
        <SessionCapsule
          tab={tab}
          stage={stage}
          currentView={currentView}
          standaloneWindow={standaloneWindow}
        />
      </div>
      <div
        ref={setSessionFabSelectionHost}
        data-session-fab-selection
        className={cn(["pointer-events-auto z-10 mb-2"])}
      />
    </div>
  );
}
