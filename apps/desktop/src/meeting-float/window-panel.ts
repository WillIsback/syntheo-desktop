import { commands as windowsCommands } from "@syntheo/plugin-windows";

import type { FloatingRouteState } from "./route-state";

let sentTranscriptSessionId: string | null = null;
let sentTranscriptBubbles: FloatingRouteState["transcriptBubbles"] | null =
  null;

type FloatingSyncOutcome =
  | { kind: "synced"; sessionId: string | null }
  | { kind: "unavailable" };

export function createFloatingMeetingWindowSynchronizer(
  onPresented?: (state: FloatingRouteState | null) => void,
) {
  let desiredRouteState: FloatingRouteState | null = null;
  let desiredRevision = 0;
  let appliedRevision = 0;
  let shownSessionId: string | null = null;
  let appliedRouteState: FloatingRouteState | null = null;
  let nativeCommandsUnavailable = false;
  let running: Promise<void> | null = null;
  let disposeRequested = false;
  let disposed = false;
  const idleWaiters: Array<() => void> = [];

  const resolveIdleWaiters = () => {
    idleWaiters.splice(0).forEach((resolve) => resolve());
  };
  const applyDesiredRevision = async () => {
    const revision = desiredRevision;
    const routeState = desiredRouteState;

    if (nativeCommandsUnavailable && routeState) {
      appliedRevision = revision;
      return;
    }

    let outcome: FloatingSyncOutcome;
    try {
      outcome = await syncFloatingMeetingWindow(
        routeState,
        shownSessionId,
        appliedRouteState,
        () => revision === desiredRevision || desiredRouteState !== null,
      );
    } catch (error) {
      console.error(
        "[meeting-float] failed to synchronize the floating panel",
        error,
      );
      if (revision === desiredRevision) {
        appliedRevision = revision;
      }
      return;
    }

    if (revision !== desiredRevision) {
      if (desiredRouteState && outcome.kind !== "unavailable") {
        shownSessionId = outcome.sessionId;
        appliedRouteState = routeState;
      }
      return;
    }

    appliedRevision = revision;
    if (outcome.kind === "unavailable") {
      nativeCommandsUnavailable = true;
      return;
    }

    shownSessionId = outcome.sessionId;
    appliedRouteState = routeState;
    onPresented?.(routeState);
  };
  const drain = async (): Promise<void> => {
    if (appliedRevision >= desiredRevision) {
      if (disposeRequested) {
        disposed = true;
      }
      return;
    }

    await applyDesiredRevision();
    return drain();
  };
  const schedule = () => {
    if (running || disposed) {
      return;
    }

    running = drain().finally(() => {
      running = null;
      if (appliedRevision < desiredRevision) {
        schedule();
        return;
      }
      resolveIdleWaiters();
    });
  };
  const waitForIdle = () => {
    if (!running && appliedRevision >= desiredRevision) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve);
    });
  };

  return {
    update(routeState: FloatingRouteState | null) {
      if (disposeRequested) {
        return;
      }
      desiredRouteState = routeState;
      desiredRevision += 1;
      schedule();
    },
    dispose() {
      if (!disposeRequested) {
        disposeRequested = true;
        desiredRouteState = null;
        desiredRevision += 1;
        schedule();
      }
      return waitForIdle();
    },
  };
}

async function syncFloatingMeetingWindow(
  routeState: FloatingRouteState | null,
  shownSessionId: string | null,
  appliedRouteState: FloatingRouteState | null,
  shouldContinue: () => boolean,
): Promise<FloatingSyncOutcome> {
  if (!shouldContinue()) {
    return { kind: "synced", sessionId: null };
  }

  if (!routeState) {
    await hideFloatingMeetingPanel();
    return { kind: "synced", sessionId: null };
  }

  const ready = await showFloatingMeetingWindow(
    routeState,
    shownSessionId !== routeState.sessionId,
    shouldContinue,
    appliedRouteState,
  );
  if (!shouldContinue()) {
    await hideFloatingMeetingPanel();
    return { kind: "synced", sessionId: null };
  }

  return ready
    ? { kind: "synced", sessionId: routeState.sessionId }
    : { kind: "unavailable" };
}

export async function showFloatingMeetingWindow(
  routeState: FloatingRouteState,
  shouldShow: boolean,
  shouldContinue: () => boolean = () => true,
  appliedRouteState: FloatingRouteState | null = null,
): Promise<boolean> {
  if (!shouldContinue()) {
    return false;
  }

  const amplitudeOnly =
    !shouldShow &&
    appliedRouteState !== null &&
    isAmplitudeOnlyFloatingRouteUpdate(appliedRouteState, routeState);
  const shouldSendTranscript =
    !amplitudeOnly &&
    (shouldShow ||
      sentTranscriptSessionId !== routeState.sessionId ||
      sentTranscriptBubbles !== routeState.transcriptBubbles);

  const updateResult = amplitudeOnly
    ? await windowsCommands.floatingBarUpdateAmplitude(routeState.amplitude)
    : await windowsCommands.floatingBarUpdate({
        dictation: routeState.dictation ?? null,
        amplitude: routeState.amplitude,
        title: routeState.title,
        status: routeState.status,
        colorScheme: routeState.colorScheme,
        opacity: routeState.opacity,
        liveCaptionOpacity: routeState.liveCaptionOpacity,
        liveCaptionWidth: routeState.liveCaptionWidth,
        liveCaptionLineCount: routeState.liveCaptionLineCount,
        liveCaptionPosition: routeState.liveCaptionPosition,
        liveCaptionMinimized: routeState.liveCaptionMinimized,
        liveCaptionToggleVisible: routeState.liveCaptionToggleVisible,
        sessionId: routeState.sessionId,
        transcriptBubbles: shouldSendTranscript
          ? routeState.transcriptBubbles
          : null,
        transcriptNotice: routeState.transcriptNotice ?? null,
      });
  if (!shouldContinue()) {
    await hideFloatingMeetingPanel();
    return false;
  }

  if (updateResult.status === "error") {
    console.error(
      "[meeting-float] failed to update the floating panel",
      updateResult.error,
    );
    return false;
  }

  if (shouldShow) {
    const shown = await windowsCommands.floatingBarShow();
    if (!shouldContinue()) {
      await hideFloatingMeetingPanel();
      return false;
    }
    if (shown.status === "error") {
      console.error(
        "[meeting-float] failed to show the floating panel",
        shown.error,
      );
      return false;
    }
  }

  if (shouldSendTranscript) {
    sentTranscriptSessionId = routeState.sessionId;
    sentTranscriptBubbles = routeState.transcriptBubbles;
  }

  return true;
}

function isAmplitudeOnlyFloatingRouteUpdate(
  previousState: FloatingRouteState,
  nextState: FloatingRouteState,
) {
  return (
    previousState.amplitude !== nextState.amplitude &&
    previousState.sessionId === nextState.sessionId &&
    previousState.title === nextState.title &&
    JSON.stringify(previousState.dictation) ===
      JSON.stringify(nextState.dictation) &&
    previousState.status === nextState.status &&
    previousState.colorScheme === nextState.colorScheme &&
    previousState.opacity === nextState.opacity &&
    previousState.liveCaptionOpacity === nextState.liveCaptionOpacity &&
    previousState.liveCaptionWidth === nextState.liveCaptionWidth &&
    previousState.liveCaptionLineCount === nextState.liveCaptionLineCount &&
    previousState.liveCaptionPosition === nextState.liveCaptionPosition &&
    previousState.liveCaptionMinimized === nextState.liveCaptionMinimized &&
    previousState.liveCaptionToggleVisible ===
      nextState.liveCaptionToggleVisible &&
    previousState.transcriptBubbles === nextState.transcriptBubbles &&
    previousState.transcriptNotice === nextState.transcriptNotice
  );
}

export async function hideFloatingMeetingPanel() {
  sentTranscriptSessionId = null;
  sentTranscriptBubbles = null;
  const result = await windowsCommands.floatingBarHide();
  if (result.status === "error") {
    console.error(
      "[meeting-float] failed to hide the floating panel",
      result.error,
    );
  }
}

export async function hideLiveCaptionPanel() {
  const result = await windowsCommands.liveCaptionHide();
  if (result.status === "error") {
    console.error(
      "[meeting-float] failed to hide the live caption panel",
      result.error,
    );
  }
}
