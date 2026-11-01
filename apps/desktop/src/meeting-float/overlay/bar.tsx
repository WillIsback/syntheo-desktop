import { useEffect, useRef, useState } from "react";

import type {
  FloatingBarState,
  FloatingTranscriptBubble,
} from "@syntheo/plugin-windows";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  CaretDown,
  Square,
  WarningCircle,
} from "@syntheo/ui/components/icons";
import { DancingSticks } from "@syntheo/ui/components/ui/dancing-sticks";
import { cn } from "@syntheo/utils";

import { DictationTranscript } from "./dictation";
import {
  FLOATING_BAR_COMPACT_GAP,
  FLOATING_BAR_COMPACT_HEIGHT,
  FLOATING_BAR_COMPACT_HORIZONTAL_PADDING,
  FLOATING_BAR_COMPACT_ICON_SIZE,
  FLOATING_BAR_COMPACT_SOLO_STOP_WIDTH,
  FLOATING_BAR_COMPACT_STOP_WIDTH,
  FLOATING_BAR_COMPACT_RADIUS,
  FLOATING_BAR_CONTROL_RADIUS,
  FLOATING_BAR_EXPANDED_RADIUS,
  FLOATING_BAR_HOVER_HANDLE_HEIGHT,
  FLOATING_BAR_HOVER_HANDLE_TOP_PADDING,
  FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT,
  FLOATING_BAR_INSET,
  compactControlsWidth,
} from "./layout";
import { tokensFor, withAlpha } from "./palette";

import { type PaletteId, useDocumentPalette } from "~/shared/theme/palette";

export function FloatingBarOverlay({
  state,
  onStop,
  onToggleExpanded,
}: {
  state: FloatingBarState;
  onStop: () => void;
  onToggleExpanded: (expanded: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isExpanded =
    state.liveCaptionToggleVisible && !state.liveCaptionMinimized;
  const showsHoverHandle = hovered && !isExpanded;
  // Re-rend la barre (et ses enfants, qui lisent la palette du document) quand
  // la palette change dans les paramètres.
  const palette = useDocumentPalette();
  const colors = barColors(state, palette);
  const controlsWidth = compactControlsWidth(state.liveCaptionToggleVisible);
  const expandsUpward = state.layout?.expandsUpward ?? false;

  return (
    <div
      className="relative h-full w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isExpanded && (
        <div
          data-tauri-drag-region
          className="absolute inset-x-0 top-0"
          style={{
            height:
              FLOATING_BAR_INSET + FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT,
          }}
        />
      )}
      <div
        className="absolute overflow-hidden"
        style={{
          left: FLOATING_BAR_INSET,
          right: FLOATING_BAR_INSET,
          bottom: FLOATING_BAR_INSET,
          top:
            FLOATING_BAR_INSET +
            (showsHoverHandle ? 0 : FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT),
          borderRadius: isExpanded
            ? FLOATING_BAR_EXPANDED_RADIUS
            : FLOATING_BAR_COMPACT_RADIUS,
          background:
            hovered && !isExpanded ? colors.envelopeSurface : colors.surface,
          boxShadow: `inset 0 0 0 0.5px ${colors.outerStroke}`,
        }}
      >
        {showsHoverHandle && <HoverHandle color={colors.handle} />}
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            top: showsHoverHandle
              ? FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT
              : 0,
          }}
        >
          {isExpanded && (
            <div
              className="absolute inset-x-0"
              style={{
                top: expandsUpward ? 0 : FLOATING_BAR_COMPACT_HEIGHT,
                bottom: expandsUpward ? FLOATING_BAR_COMPACT_HEIGHT : 0,
              }}
            >
              <TranscriptList
                key={state.dictation?.sessionId ?? "meeting"}
                dictation={state.dictation}
                bubbles={state.transcriptBubbles ?? []}
                colorScheme={state.colorScheme}
                notice={state.transcriptNotice ?? null}
              />
            </div>
          )}
          <div
            className="absolute flex -translate-x-1/2 items-center justify-center"
            style={{
              left: state.layout
                ? state.layout.controlsCenterX - FLOATING_BAR_INSET
                : `calc(100% - ${FLOATING_BAR_COMPACT_HORIZONTAL_PADDING + controlsWidth / 2}px)`,
              top: expandsUpward ? undefined : 0,
              bottom: expandsUpward ? 0 : undefined,
              width: controlsWidth,
              height: FLOATING_BAR_COMPACT_HEIGHT,
            }}
          >
            <FloatingControls
              state={state}
              isExpanded={isExpanded}
              colors={colors}
              onStop={onStop}
              onToggleExpanded={onToggleExpanded}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatingControls({
  state,
  isExpanded,
  colors,
  onStop,
  onToggleExpanded,
}: {
  state: FloatingBarState;
  isExpanded: boolean;
  colors: BarColors;
  onStop: () => void;
  onToggleExpanded: (expanded: boolean) => void;
}) {
  return (
    <div
      className="flex items-center"
      style={{ gap: FLOATING_BAR_COMPACT_GAP }}
    >
      <StopControl state={state} colors={colors} onStop={onStop} />
      {state.liveCaptionToggleVisible ? (
        <button
          type="button"
          data-tauri-drag-region="false"
          aria-label={
            isExpanded ? "Collapse live transcript" : "Expand live transcript"
          }
          onClick={() => onToggleExpanded(!isExpanded)}
          className="flex items-center justify-center"
          style={{
            width: FLOATING_BAR_COMPACT_ICON_SIZE,
            height: FLOATING_BAR_COMPACT_ICON_SIZE,
            borderRadius: FLOATING_BAR_CONTROL_RADIUS,
            color: colors.content,
          }}
        >
          {isExpanded ? (
            <ArrowsInSimple size={14} weight="bold" />
          ) : (
            <ArrowsOutSimple size={14} weight="bold" />
          )}
        </button>
      ) : null}
    </div>
  );
}

function StopControl({
  state,
  colors,
  onStop,
}: {
  state: FloatingBarState;
  colors: BarColors;
  onStop: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const width = state.liveCaptionToggleVisible
    ? FLOATING_BAR_COMPACT_STOP_WIDTH
    : FLOATING_BAR_COMPACT_SOLO_STOP_WIDTH;

  return (
    <button
      type="button"
      data-tauri-drag-region="false"
      aria-label={
        state.dictation
          ? "Finish dictation"
          : state.status === "error"
            ? `${state.transcriptNotice ?? "Recording needs attention"}; stop listening`
            : "Stop listening"
      }
      title={
        state.status === "error"
          ? `${state.transcriptNotice ?? "Recording needs attention"}. Open Syntheo to retry or change devices.`
          : undefined
      }
      disabled={state.dictation?.phase === "transcribing"}
      onClick={onStop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center justify-center"
      style={{
        width,
        height: FLOATING_BAR_COMPACT_ICON_SIZE,
        borderRadius: FLOATING_BAR_CONTROL_RADIUS,
        background: hovered ? colors.accentHover : colors.controlFill,
        color: colors.accent,
      }}
    >
      {state.dictation?.phase === "transcribing" ? (
        <span role="status" className="text-xs">
          Finishing…
        </span>
      ) : hovered ? (
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Square size={9} />
          {state.dictation ? "Done" : "Stop"}
        </span>
      ) : state.status === "error" ? (
        <WarningCircle size={20} aria-hidden="true" />
      ) : (
        <DancingSticks
          color={colors.accent}
          amplitude={state.amplitude}
          width={26}
          height={20}
          stickWidth={3}
          gap={2}
        />
      )}
    </button>
  );
}

function TranscriptList({
  bubbles,
  colorScheme,
  dictation,
  notice,
}: {
  dictation: FloatingBarState["dictation"];
  bubbles: FloatingTranscriptBubble[];
  colorScheme: FloatingBarState["colorScheme"];
  notice: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned) {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [bubbles, pinned, notice, dictation?.text, dictation?.partial]);

  return (
    <div className="relative h-full p-3">
      <div
        className="h-full overflow-y-auto"
        onScroll={(event) => {
          const target = event.currentTarget;
          const distance =
            target.scrollHeight - target.scrollTop - target.clientHeight;
          setPinned(distance < 20);
        }}
      >
        <div
          className={cn([
            "flex min-h-full flex-col gap-2",
            dictation ? "justify-start" : "justify-end",
          ])}
        >
          {dictation ? (
            <DictationTranscript
              dictation={dictation}
              colorScheme={colorScheme}
            />
          ) : (
            bubbles.map((bubble, index) => (
              <TranscriptBubble
                key={bubble.id}
                bubble={bubble}
                colorScheme={colorScheme}
                showsSpeakerLabel={
                  index === 0 ||
                  bubbles[index - 1]?.speakerLabel !== bubble.speakerLabel ||
                  bubbles[index - 1]?.isSelf !== bubble.isSelf
                }
              />
            ))
          )}
          {!dictation && notice ? (
            <p
              role="status"
              className="px-3 py-1.5 text-center text-[12px] leading-4"
              style={{ color: tokensFor(colorScheme).mutedForeground }}
            >
              {notice}
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      {!pinned &&
      (dictation
        ? !!(dictation.text || dictation.partial)
        : bubbles.length > 0) ? (
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={() => {
            setPinned(true);
            bottomRef.current?.scrollIntoView?.({
              block: "end",
              behavior: "smooth",
            });
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[11px] font-medium"
          style={{
            background: tokensFor(colorScheme).card,
            color: tokensFor(colorScheme).foreground,
          }}
        >
          <CaretDown size={10} weight="bold" />
          Go to bottom
        </button>
      ) : null}
    </div>
  );
}

function TranscriptBubble({
  bubble,
  showsSpeakerLabel,
  colorScheme,
}: {
  bubble: FloatingTranscriptBubble;
  showsSpeakerLabel: boolean;
  colorScheme: FloatingBarState["colorScheme"];
}) {
  const overlapping = bubble.overlapsPrevious || bubble.overlapsNext;
  const tokens = tokensFor(colorScheme);

  return (
    <div
      className={cn(["flex", bubble.isSelf ? "justify-end" : "justify-start"])}
    >
      <div className="max-w-[calc(100%-40px)] text-left">
        {(showsSpeakerLabel || overlapping) && (
          <p
            className="mb-1 text-[10px] font-semibold"
            style={{ color: tokens.foreground }}
          >
            {showsSpeakerLabel ? bubble.speakerLabel : ""}
          </p>
        )}
        <p
          className="rounded-[11px] px-2.5 py-2 text-[13px] leading-5"
          style={{
            color: tokens.foreground,
            background: bubble.isSelf ? tokens.accent : tokens.card,
            boxShadow: overlapping
              ? `inset 0 0 0 1px ${tokens.input}`
              : undefined,
          }}
        >
          {bubble.text}
        </p>
      </div>
    </div>
  );
}

function HoverHandle({ color }: { color: string }) {
  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-center"
      style={{
        height: FLOATING_BAR_HOVER_HANDLE_HEIGHT,
        width: "100%",
        paddingTop: FLOATING_BAR_HOVER_HANDLE_TOP_PADDING,
        boxSizing: "content-box",
      }}
    >
      <div
        data-tauri-drag-region
        className="h-full"
        style={{
          width: "calc(100% - 16px)",
          backgroundImage: `radial-gradient(circle, ${color} 0.8px, transparent 0.9px)`,
          backgroundSize: "5px 7px",
        }}
      />
    </div>
  );
}

type BarColors = {
  surface: string;
  envelopeSurface: string;
  content: string;
  handle: string;
  outerStroke: string;
  controlFill: string;
  accent: string;
  accentHover: string;
};

function barColors(state: FloatingBarState, palette: PaletteId): BarColors {
  const opacity = Math.min(Math.max(state.opacity, 0.35), 0.95);
  const tokens = tokensFor(state.colorScheme, palette);

  return {
    surface: withAlpha(tokens.floatingChrome, opacity * 82),
    envelopeSurface: withAlpha(
      tokens.floatingChrome,
      Math.min(opacity * 108, 95),
    ),
    content: tokens.foreground,
    handle: withAlpha(tokens.foreground, 40),
    outerStroke: withAlpha(tokens.foreground, 14),
    controlFill: withAlpha(tokens.foreground, 8),
    accent: tokens.recording,
    accentHover: withAlpha(tokens.recording, 18),
  };
}
