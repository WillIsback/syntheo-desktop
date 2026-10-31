import { useLingui } from "@lingui/react/macro";
import { useCallback, useRef, useState } from "react";

import { commands as openerCommands } from "@syntheo/plugin-opener2";
import { Headset, VideoCamera } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";
import { cn, parseEventInstant, safeParseDate } from "@syntheo/utils";

import { FolderPicker } from "../folder-picker";
import { useHasTranscript } from "../shared";
import { OverflowButton } from "./overflow";

import { useNow } from "~/calendar/hooks";
import { useEventCountdown } from "~/session/hooks/useEventCountdown";
import { useMeetingMicInUse } from "~/session/hooks/useMeetingMicInUse";
import {
  getRemoteMeeting,
  type RemoteMeeting,
} from "~/session/hooks/useRemoteMeeting";
import { useSessionEvent } from "~/session/hooks/useSessionEvent";
import {
  useWindowControlsGutter,
  WINDOW_CONTROLS_GUTTER_CLASS,
} from "~/shared/hooks/useWindowControlsGutter";
import type { EditorView, Tab } from "~/store/zustand/tabs/schema";
import { useListener } from "~/stt/contexts";
import { useStartListening } from "~/stt/useStartListening";
import {
  isMainWebviewWindow,
  requestMainListenerControl,
} from "~/stt/window-control";

// Le titre vit désormais dans le document et les actions d'écoute dans la
// capsule : l'en-tête ne garde que le dossier, « Rejoindre et enregistrer »
// pour une réunion en ligne, et le menu « Plus ».
export function OuterHeader({
  sessionId,
  currentView,
  standaloneWindow = false,
}: {
  sessionId: string;
  currentView: EditorView;
  tab?: Extract<Tab, { type: "sessions" }>;
  standaloneWindow?: boolean;
}) {
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const sessionEvent = useSessionEvent(sessionId);
  const hasTranscript = useHasTranscript(sessionId);
  // Syntheo ne conserve jamais l'audio d'une capture.
  const audioExists = false;
  const now = useNow();
  const showWindowControlsGutter = useWindowControlsGutter();
  const endedAt = sessionEvent?.ended_at
    ? safeParseDate(sessionEvent.ended_at)
    : null;
  const ended = !!endedAt && endedAt.getTime() <= now.getTime();
  const isRecording =
    sessionMode === "active" || sessionMode === "running_batch";
  const meetingOver = !isRecording && (ended || hasTranscript || audioExists);

  return (
    <div
      data-tauri-drag-region
      className={cn([
        "relative flex w-full items-center gap-[2px]",
        // 46px content box centers the 28px controls at 23px, on the macOS
        // traffic-light baseline.
        "h-12 pb-0.5",
        // Plus de barre latérale : seul le gutter des feux macOS reste réservé.
        showWindowControlsGutter ? WINDOW_CONTROLS_GUTTER_CLASS : "pl-2",
      ])}
    >
      <div
        data-tauri-drag-region
        data-session-header-spacer
        className="min-h-full min-w-0 flex-1"
      />
      <div
        data-tauri-drag-region
        className="relative z-10 flex shrink-0 items-center pr-1"
      >
        <FolderPicker sessionId={sessionId} align="end" />
        <HeaderMeetingControl
          sessionId={sessionId}
          sessionMode={sessionMode}
          meetingOver={meetingOver}
        />
        <OverflowButton
          standaloneWindow={standaloneWindow}
          sessionId={sessionId}
          currentView={currentView}
        />
      </div>
    </div>
  );
}

function HeaderMeetingControl({
  sessionId,
  sessionMode,
  meetingOver,
}: {
  sessionId: string;
  sessionMode: string;
  meetingOver: boolean;
}) {
  const sessionEvent = useSessionEvent(sessionId);
  const hasTranscript = useHasTranscript(sessionId);
  // Syntheo ne conserve jamais l'audio d'une capture.
  const audioExists = false;
  const now = useNow();
  const endedAt = sessionEvent?.ended_at
    ? safeParseDate(sessionEvent.ended_at)
    : null;
  const ended = !!endedAt && endedAt.getTime() <= now.getTime();
  if (sessionMode === "finalizing" || sessionMode === "running_batch") {
    return null;
  }

  // Pas de partage (cloud) : rien à proposer une fois la réunion terminée.
  if (meetingOver) {
    return null;
  }

  return (
    <HeaderMeetingAction
      sessionId={sessionId}
      event={sessionEvent}
      eventEnded={ended}
      sessionMode={sessionMode}
      hasTranscript={hasTranscript}
      audioExists={audioExists}
    />
  );
}

function meetingHasStarted(startedAt: string | undefined, now: Date) {
  const start = parseEventInstant(startedAt);
  return start != null && now.getTime() >= start.getTime();
}

function HeaderMeetingAction({
  sessionId,
  event,
  eventEnded,
  sessionMode,
  hasTranscript,
  audioExists,
}: {
  sessionId: string;
  event: {
    meeting_link?: string;
    started_at?: string;
  } | null;
  eventEnded: boolean;
  sessionMode: string;
  hasTranscript: boolean;
  audioExists: boolean;
}) {
  const startListening = useStartListening(sessionId);
  const remote = getRemoteMeeting(event?.meeting_link);
  const meetingLink = event?.meeting_link || null;
  const canJoinFromHeader = Boolean(
    !eventEnded &&
    !hasTranscript &&
    !audioExists &&
    meetingLink &&
    remote !== null,
  );
  const now = useNow();
  const meetingStarted = meetingHasStarted(event?.started_at, now);
  const meetingMicInUse = useMeetingMicInUse(
    canJoinFromHeader && sessionMode === "inactive" && meetingStarted,
  );
  const { t } = useLingui();
  const joiningMeetingRef = useRef(false);
  const [joiningMeeting, setJoiningMeeting] = useState(false);
  const start = useCallback(async () => {
    if (!isMainWebviewWindow()) {
      await requestMainListenerControl("start", sessionId);
      return;
    }

    await startListening();
  }, [sessionId, startListening]);
  const openMeeting = useCallback(async () => {
    if (!meetingLink) {
      return;
    }

    await openerCommands.openUrl(meetingLink, null);
  }, [meetingLink]);
  const joinMeeting = useCallback(async () => {
    if (joiningMeetingRef.current) {
      return;
    }

    joiningMeetingRef.current = true;
    setJoiningMeeting(true);
    try {
      await Promise.all([openMeeting(), start()]);
    } finally {
      joiningMeetingRef.current = false;
      setJoiningMeeting(false);
    }
  }, [openMeeting, start]);
  const countdown = useEventCountdown(sessionId);
  // Commencer et terminer l'écoute passent par la capsule ; l'en-tête ne
  // garde que « Rejoindre et enregistrer » pour une réunion en ligne.
  const action =
    sessionMode !== "active" &&
    canJoinFromHeader &&
    (!meetingStarted || !meetingMicInUse)
      ? {
          label: t`Join & record`,
          title: t`Join meeting and record`,
          icon: remote ? getMeetingDisplay(remote.type).icon : undefined,
          onClick: () => {
            void joinMeeting();
          },
        }
      : null;
  const disabled = sessionMode === "finalizing" || joiningMeeting;
  const isPrimaryCta = sessionMode === "inactive";
  const showCountdown =
    Boolean(countdown.label) &&
    sessionMode !== "active" &&
    sessionMode !== "running_batch" &&
    sessionMode !== "finalizing";

  if (!action && !showCountdown) {
    return null;
  }

  return (
    <div className="relative mr-1 ml-1 flex min-w-0 shrink-0 items-center">
      {action ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-tauri-drag-region="false"
          aria-label={action.label}
          title={action.title}
          disabled={disabled}
          onClick={action.onClick}
          className={cn([
            "max-w-56 shrink-0 gap-1.5 overflow-hidden border pr-2.5 pl-1.5 text-sm",
            isPrimaryCta
              ? "border-border text-foreground bg-transparent shadow-none"
              : "border-border bg-card text-foreground",
            disabled && "cursor-default opacity-60",
          ])}
        >
          {action.icon}
          <span className="truncate">{action.label}</span>
        </Button>
      ) : null}
      {showCountdown ? (
        <div
          data-header-meeting-countdown
          className="border-border bg-popover text-popover-foreground pointer-events-none absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 rounded-md border px-2.5 py-1 font-mono text-xs whitespace-nowrap tabular-nums shadow-sm"
        >
          <span
            data-header-meeting-countdown-tail
            aria-hidden="true"
            className="border-border bg-popover absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-t border-l"
          />
          <span className="relative">{countdown.label}</span>
        </div>
      ) : null}
    </div>
  );
}

function getMeetingDisplay(type: RemoteMeeting["type"]) {
  switch (type) {
    case "zoom":
      return {
        name: "Zoom",
        icon: (
          <img
            src="/assets/zoom-icon.svg"
            alt=""
            className="size-3.5 shrink-0"
          />
        ),
      };
    case "google-meet":
      return {
        name: "Meet",
        icon: (
          <img
            src="/assets/google-meet.svg"
            alt=""
            className="size-3.5 shrink-0"
          />
        ),
      };
    case "webex":
      return {
        name: "Webex",
        icon: (
          <img src="/assets/webex.png" alt="" className="size-3.5 shrink-0" />
        ),
      };
    case "teams":
      return {
        name: "Teams",
        icon: (
          <img src="/assets/teams.png" alt="" className="size-3.5 shrink-0" />
        ),
      };
    case "cal-com":
      return {
        name: "Cal.com",
        icon: <VideoCamera className="size-3.5 shrink-0" />,
      };
    case "x-call":
      return {
        name: "X",
        icon: (
          <img
            src="/assets/X logo.svg"
            alt=""
            className="size-3.5 shrink-0 dark:invert"
          />
        ),
      };
    default:
      return {
        name: "Meeting",
        icon: <Headset className="size-3.5 shrink-0" />,
      };
  }
}
