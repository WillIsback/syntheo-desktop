import type { SessionMode } from "~/store/zustand/listener/general";
import type { EditorView } from "~/store/zustand/tabs/schema";

// Les trois étapes du « document vivant » : 備 Préparer, 聴 Écouter, 結 Synthèse.
export type NoteStage = "prepare" | "listen" | "synthesis";

export const NOTE_STAGES: readonly NoteStage[] = [
  "prepare",
  "listen",
  "synthesis",
];

// Il n'existe pas d'état « avant écoute » explicite : on le dérive.
// - Écouter : capture en cours ou en cours de finalisation.
// - Synthèse : plus de capture, mais une transcription ou un compte-rendu
//   existe (ou une transcription différée tourne encore).
// - Préparer : tout le reste (note neuve, pas encore écoutée).
export function getNoteStage({
  sessionMode,
  hasTranscript,
  hasEnhancedNotes,
}: {
  sessionMode: SessionMode;
  hasTranscript: boolean;
  hasEnhancedNotes: boolean;
}): NoteStage {
  if (sessionMode === "active" || sessionMode === "finalizing") {
    return "listen";
  }

  if (sessionMode === "running_batch" || hasTranscript || hasEnhancedNotes) {
    return "synthesis";
  }

  return "prepare";
}

// Vue d'éditeur affichée par le document vivant : les notes de l'utilisateur
// avant et pendant l'écoute, le compte-rendu (s'il existe) pour la synthèse.
// La transcription n'est plus une vue : elle vit dans la marge.
export function getLivingDocumentView(
  stage: NoteStage,
  tabView: EditorView | null | undefined,
  enhancedNoteIds: readonly string[],
): EditorView {
  if (stage !== "synthesis") {
    return { type: "raw" };
  }

  if (tabView?.type === "enhanced" && enhancedNoteIds.includes(tabView.id)) {
    return tabView;
  }

  const firstEnhancedNoteId = enhancedNoteIds[0];
  return firstEnhancedNoteId
    ? { type: "enhanced", id: firstEnhancedNoteId }
    : { type: "raw" };
}

// Vues entre lesquelles on peut basculer (Ctrl ⌥ ← / →) : les comptes-rendus.
export function getLivingDocumentViews(
  enhancedNoteIds: readonly string[],
): EditorView[] {
  return enhancedNoteIds.length > 0
    ? enhancedNoteIds.map((id) => ({ type: "enhanced", id }))
    : [{ type: "raw" }];
}
