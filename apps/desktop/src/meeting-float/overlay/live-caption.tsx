import { useState } from "react";

import {
  commands as windowsCommands,
  events as windowsEvents,
  type LiveCaptionState,
} from "@syntheo/plugin-windows";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";

import { tokensFor, withAlpha } from "./palette";

// Sous-titres : toujours sur fond sumi (jetons sombres), comme des sous-titres
// de télévision, quel que soit le thème de l'app.
const CAPTION = tokensFor("dark");

const LIVE_CAPTION_MIN_WIDTH = 260;
const LIVE_CAPTION_MAX_WIDTH = 640;
const LIVE_CAPTION_MIN_LINE_COUNT = 1;
const LIVE_CAPTION_MAX_LINE_COUNT = 4;
const LIVE_CAPTION_LINE_HEIGHT = 22;
const LIVE_CAPTION_HORIZONTAL_PADDING = 16;
const LIVE_CAPTION_VERTICAL_PADDING = 10;
const LIVE_CAPTION_FOOTER_HEIGHT = 32;
const LIVE_CAPTION_FOOTER_SEPARATOR_HEIGHT = 1;
const LIVE_CAPTION_CORNER_RADIUS = 12;
const LIVE_CAPTION_MIN_OPACITY = 0.05;
const LIVE_CAPTION_MAX_OPACITY = 1;

export function LiveCaptionOverlayScreen() {
  const [state, setState] = useState<LiveCaptionState | null>(null);

  useMountEffect(() => {
    document.documentElement.dataset.liveCaption = "";

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void windowsCommands.liveCaptionCurrentState().then((result) => {
      if (cancelled || result.status === "error" || !result.data) {
        return;
      }
      setState(result.data);
    });

    windowsEvents.liveCaptionOverlayState
      .listen((event) => {
        if (!cancelled) {
          setState(event.payload.state);
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      });

    return () => {
      cancelled = true;
      delete document.documentElement.dataset.liveCaption;
      unlisteners.forEach((unlisten) => unlisten());
    };
  });

  if (!state || state.minimized) {
    return <div className="h-screen w-screen bg-transparent" />;
  }

  return (
    <div className="h-screen w-screen bg-transparent">
      <LiveCaptionOverlay
        state={state}
        onOpacityChange={(opacity) => {
          void windowsEvents.floatingBarSettingsChange.emit({
            floatingBarOpacity: null,
            liveCaptionOpacity: opacity,
            liveCaptionWidth: null,
            liveCaptionLineCount: null,
            liveCaptionPosition: null,
            liveCaptionMinimized: null,
          });
        }}
        onHide={() => {
          void windowsEvents.floatingBarSettingsChange.emit({
            floatingBarOpacity: null,
            liveCaptionOpacity: null,
            liveCaptionWidth: null,
            liveCaptionLineCount: null,
            liveCaptionPosition: null,
            liveCaptionMinimized: true,
          });
        }}
      />
    </div>
  );
}

export function LiveCaptionOverlay({
  state,
  onOpacityChange,
  onHide,
}: {
  state: LiveCaptionState;
  onOpacityChange: (opacity: number) => void;
  onHide: () => void;
}) {
  const lineCount = Math.min(
    Math.max(state.lineCount, LIVE_CAPTION_MIN_LINE_COUNT),
    LIVE_CAPTION_MAX_LINE_COUNT,
  );
  const width = Math.min(
    Math.max(state.width, LIVE_CAPTION_MIN_WIDTH),
    LIVE_CAPTION_MAX_WIDTH,
  );
  const opacity = Math.min(
    Math.max(state.opacity, LIVE_CAPTION_MIN_OPACITY),
    LIVE_CAPTION_MAX_OPACITY,
  );

  return (
    <div
      data-tauri-drag-region
      className="flex h-full w-full items-stretch justify-center"
    >
      <div
        className="flex h-full flex-col overflow-hidden"
        style={{
          width,
          borderRadius: LIVE_CAPTION_CORNER_RADIUS,
          background: withAlpha(CAPTION.background, opacity * 100),
        }}
      >
        <p
          data-tauri-drag-region
          className="m-0 text-center text-[16px] leading-[22px] font-medium"
          style={{
            color: CAPTION.foreground,
            padding: `${LIVE_CAPTION_VERTICAL_PADDING}px ${LIVE_CAPTION_HORIZONTAL_PADDING}px`,
            minHeight:
              LIVE_CAPTION_LINE_HEIGHT * lineCount +
              LIVE_CAPTION_VERTICAL_PADDING * 2,
            maxHeight:
              LIVE_CAPTION_LINE_HEIGHT * lineCount +
              LIVE_CAPTION_VERTICAL_PADDING * 2,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: lineCount,
            overflow: "hidden",
          }}
        >
          {state.text}
        </p>
        <div
          className="shrink-0"
          style={{
            height: LIVE_CAPTION_FOOTER_SEPARATOR_HEIGHT,
            background: withAlpha(CAPTION.foreground, 16),
          }}
        />
        <div
          className="flex items-center"
          style={{
            height: LIVE_CAPTION_FOOTER_HEIGHT,
            paddingLeft: LIVE_CAPTION_HORIZONTAL_PADDING,
            paddingRight: 8,
            gap: 8,
          }}
        >
          <input
            type="range"
            min={LIVE_CAPTION_MIN_OPACITY}
            max={LIVE_CAPTION_MAX_OPACITY}
            step={0.01}
            value={opacity}
            aria-label="Transcript opacity"
            data-tauri-drag-region="false"
            onChange={(event) => {
              onOpacityChange(Number(event.currentTarget.value));
            }}
            className="h-1 w-[120px] cursor-pointer appearance-none rounded-full"
            style={{ background: withAlpha(CAPTION.foreground, 25) }}
          />
          <span className="flex-1" />
          <button
            type="button"
            data-tauri-drag-region="false"
            aria-label="Hide transcript"
            onClick={onHide}
            className="h-5 rounded-full px-2 text-[11px] font-semibold"
            style={{
              color: CAPTION.foreground,
              background: withAlpha(CAPTION.card, 70),
              boxShadow: `inset 0 0 0 0.5px ${withAlpha(CAPTION.foreground, 18)}`,
            }}
          >
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
