import { useLingui } from "@lingui/react/macro";

import { HeaderViewEnhanced } from "~/session/components/note-input/header-enhanced";
import { deleteEnhancedNote } from "~/session/queries";

// Choix du modèle du compte-rendu (régénérer, changer de modèle, basculer entre
// plusieurs comptes-rendus). Remplace la partie « Résumé » des anciens onglets.
export function SummarySwitcher({
  sessionId,
  enhancedNoteIds,
  currentNoteId,
  onSelectNote,
}: {
  sessionId: string;
  enhancedNoteIds: readonly string[];
  currentNoteId: string | null;
  onSelectNote: (enhancedNoteId: string) => void;
}) {
  const { t } = useLingui();
  const primaryId = enhancedNoteIds[0];

  if (enhancedNoteIds.length === 0) {
    return null;
  }

  return (
    <div
      role="group"
      aria-label={t`Summary templates`}
      data-tauri-drag-region="false"
      className="bg-foreground/10 dark:bg-accent/55 rounded-pill flex h-7 w-fit items-center gap-[2px] p-[2px]"
    >
      {enhancedNoteIds.map((id, index) => {
        const removable = id !== primaryId;
        return (
          <HeaderViewEnhanced
            key={id}
            sessionId={sessionId}
            enhancedNoteId={id}
            isActive={currentNoteId === id}
            canRemove={removable}
            onRemove={
              removable
                ? () => {
                    const previous = enhancedNoteIds[index - 1];
                    if (currentNoteId === id && previous) {
                      onSelectNote(previous);
                    }
                    void deleteEnhancedNote(id).catch((error) => {
                      console.error(
                        "[living-document] failed to remove summary",
                        error,
                      );
                    });
                  }
                : undefined
            }
            onSelectNote={onSelectNote}
            onClick={() => onSelectNote(id)}
          />
        );
      })}
    </div>
  );
}
