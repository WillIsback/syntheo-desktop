import { useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { NoteCapsule, type NoteStage } from "./index";
import { registerPreparedNoteStart } from "./start-shortcut";

import { useShell } from "~/contexts/shell";
import {
  copyTextToClipboard,
  getStoredNoteMarkdown,
} from "~/session/components/note-input/header-shared";
import { ExportModal } from "~/session/components/outer-header/overflow/export-modal";
import { useEnhancedNote, useSession } from "~/session/queries";
import { leaveOverlayTab } from "~/shared/leave-overlay-tab";
import type { EditorView, Tab } from "~/store/zustand/tabs/schema";
import { useListener } from "~/stt/contexts";
import { useStartListening } from "~/stt/useStartListening";
import {
  isMainWebviewWindow,
  requestMainListenerControl,
} from "~/stt/window-control";

function getPrimaryModifierLabel() {
  try {
    return platform() === "macos" ? "⌘" : "Ctrl";
  } catch {
    return "Ctrl";
  }
}

export function SessionCapsule({
  tab,
  stage,
  currentView,
  standaloneWindow = false,
}: {
  tab: Extract<Tab, { type: "sessions" }>;
  stage: NoteStage;
  currentView: EditorView;
  standaloneWindow?: boolean;
}) {
  const { t } = useLingui();
  const sessionId = tab.id;
  const { chat } = useShell();
  const modifierLabel = useMemo(() => getPrimaryModifierLabel(), []);

  const startListening = useStartListening(sessionId);
  const stopListening = useListener((state) => state.stop);
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const isLiveSession = useListener(
    (state) => state.live.sessionId === sessionId,
  );
  const seconds = useListener((state) =>
    state.live.sessionId === sessionId ? state.live.seconds : 0,
  );
  const amplitude = useListener((state) =>
    state.live.sessionId === sessionId
      ? Math.min(
          Math.hypot(state.live.amplitude.mic, state.live.amplitude.speaker),
          1,
        )
      : 0,
  );
  const muted = useListener((state) =>
    state.live.sessionId === sessionId ? state.live.muted : false,
  );

  const start = useCallback(() => {
    if (!isMainWebviewWindow()) {
      void requestMainListenerControl("start", sessionId);
      return;
    }

    void startListening();
  }, [sessionId, startListening]);

  const stop = useCallback(() => {
    if (!isMainWebviewWindow()) {
      void requestMainListenerControl("stop", sessionId);
      return;
    }

    stopListening();
  }, [sessionId, stopListening]);

  // Ctrl ⇧ N lance l'écoute de cette note tant qu'elle est en préparation.
  const canStartFromShortcut = tab.active && stage === "prepare";
  useEffect(() => {
    if (!canStartFromShortcut || standaloneWindow) {
      return;
    }

    return registerPreparedNoteStart(start);
  }, [canStartFromShortcut, standaloneWindow, start]);
  // Les fenêtres de note autonomes n'ont pas les raccourcis globaux.
  useHotkeys(
    "mod+shift+n",
    start,
    {
      enabled: canStartFromShortcut && standaloneWindow,
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [start],
  );

  const session = useSession(sessionId);
  const enhancedNoteId = currentView.type === "enhanced" ? currentView.id : "";
  const enhancedContent = useEnhancedNote(enhancedNoteId)?.content;
  const markdown = useMemo(
    () =>
      getStoredNoteMarkdown(
        currentView.type === "enhanced" ? enhancedContent : session?.raw_md,
      ),
    [currentView.type, enhancedContent, session?.raw_md],
  );
  const copy = useCallback(() => {
    void copyTextToClipboard(markdown, {
      success: t`Note copied to clipboard`,
      error: t`Failed to copy the note`,
    });
  }, [markdown, t]);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportMounted, setExportMounted] = useState(false);
  const openExport = useCallback(() => {
    setExportMounted(true);
    requestAnimationFrame(() => setExportOpen(true));
  }, []);

  // « Demander à la note » réutilise le chat existant (Ctrl J).
  const ask = useCallback(() => {
    chat.sendEvent({ type: "OPEN" });
  }, [chat]);

  return (
    <>
      <NoteCapsule
        stage={stage}
        modifierLabel={modifierLabel}
        listening={{
          seconds: isLiveSession ? seconds : 0,
          amplitude,
          muted,
          finalizing: sessionMode === "finalizing",
        }}
        actions={{
          onCancel: standaloneWindow ? undefined : leaveOverlayTab,
          onStart: start,
          onStop: stop,
          onCopy: copy,
          copyDisabled: markdown.length === 0,
          onExport: openExport,
          onAsk: ask,
        }}
      />
      {exportMounted ? (
        <ExportModal
          sessionId={sessionId}
          currentView={currentView}
          open={exportOpen}
          onOpenChange={setExportOpen}
        />
      ) : null}
    </>
  );
}
