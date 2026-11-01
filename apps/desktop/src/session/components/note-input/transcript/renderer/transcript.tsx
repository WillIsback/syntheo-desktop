import {
  type FocusEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import type { RenderTranscriptRequest } from "@syntheo/plugin-transcription";
import { cn } from "@syntheo/utils";

import { useSearch } from "../../search/context";
import {
  useRenderedTranscriptData,
  useTranscriptTimelineMetadata,
} from "./data-hooks";
import { useTranscriptParagraphs } from "./paragraphs";
import {
  EMPTY_TRANSCRIPT_SEARCH,
  SegmentRenderer,
  type SegmentRendererProps,
  segmentRendererPropsEqual,
  type TranscriptSearchRenderState,
} from "./segment";
import {
  createSegmentKeys,
  segmentsShallowEqual,
  useStableSegments,
} from "./segment-hooks";
import {
  getTranscriptSectionKey,
  getTranscriptSelectionFromSegment,
  type TranscriptWordSelection,
} from "./selection";
import { useRegisterTranscriptSelectionSource } from "./selection-context";
import { useVirtualSegments, VirtualSegmentRow } from "./virtual-segments";

import { nameMemoComponent } from "~/devtools-bar/render-tracker";
import {
  applyRenderRequestIdentitiesToSegments,
  getMaxSpeakerNumberForParticipants,
  mergeAdjacentSpeakerSegments,
  mergeRenderedAndLiveSegments,
  SegmentKeyUtils,
  type RenderLabelContext,
  type Segment,
  type SegmentWord,
} from "~/stt/live-segment";
import { SpeakerLabelManager } from "~/stt/segment/shared";
import { isTranscriptWordSeekable } from "~/stt/timing";
import { useResolvedSpeakerSegments } from "~/stt/useResolvedSpeakerSegments";

export function RenderTranscript({
  scrollElement,
  isLastTranscript,
  shouldScrollToEnd,
  transcriptId,
  currentActive,
  captureGeneration = 0,
  liveSegments,
  currentMs,
  seek,
  startPlayback,
  audioExists,
  editMode = false,
}: {
  scrollElement: HTMLDivElement | null;
  isLastTranscript: boolean;
  shouldScrollToEnd: boolean;
  transcriptId: string;
  currentActive: boolean;
  captureGeneration?: number;
  liveSegments: Segment[];
  currentMs: number;
  seek: (sec: number) => void;
  startPlayback: () => void;
  audioExists: boolean;
  editMode?: boolean;
}) {
  return (
    <PersistedTranscript
      scrollElement={scrollElement}
      transcriptId={transcriptId}
      currentActive={currentActive}
      captureGeneration={captureGeneration}
      liveSegments={liveSegments}
      shouldScrollToEnd={isLastTranscript && shouldScrollToEnd}
      currentMs={currentMs}
      seek={seek}
      startPlayback={startPlayback}
      audioExists={audioExists}
      editMode={editMode}
    />
  );
}

function PersistedTranscript({
  scrollElement,
  transcriptId,
  currentActive,
  captureGeneration,
  liveSegments,
  shouldScrollToEnd,
  currentMs,
  seek,
  startPlayback,
  audioExists,
  editMode,
}: {
  scrollElement: HTMLDivElement | null;
  transcriptId: string;
  currentActive: boolean;
  captureGeneration: number;
  liveSegments: Segment[];
  shouldScrollToEnd: boolean;
  currentMs: number;
  seek: (sec: number) => void;
  startPlayback: () => void;
  audioExists: boolean;
  editMode: boolean;
}) {
  const {
    maxSpeakerNumber,
    request,
    segments: storedSegments,
  } = useRenderedTranscriptData(transcriptId, currentActive, captureGeneration);
  const mergedSegments = useMemo(() => {
    if (!currentActive) {
      // Settled transcripts are already merged and labeled by the native
      // render; merging again would join segments the speaker-context
      // labeler intentionally split across intervals.
      return mergeRenderedAndLiveSegments(storedSegments, liveSegments, null);
    }
    return mergeAdjacentSpeakerSegments(
      applyRenderRequestIdentitiesToSegments(
        mergeRenderedAndLiveSegments(storedSegments, liveSegments, request),
        request,
      ),
    );
  }, [currentActive, liveSegments, request, storedSegments]);

  return (
    <TranscriptSegments
      segments={mergedSegments}
      scrollElement={scrollElement}
      transcriptId={transcriptId}
      currentActive={currentActive}
      shouldScrollToEnd={shouldScrollToEnd}
      currentMs={currentMs}
      seek={seek}
      startPlayback={startPlayback}
      audioExists={audioExists}
      maxSpeakerNumber={maxSpeakerNumber}
      request={request}
      editMode={editMode}
    />
  );
}

function TranscriptSegments({
  segments: rawSegments,
  scrollElement,
  transcriptId,
  currentActive,
  shouldScrollToEnd,
  currentMs,
  seek,
  startPlayback,
  audioExists,
  maxSpeakerNumber,
  request,
  editMode,
}: {
  segments: Segment[];
  scrollElement: HTMLDivElement | null;
  transcriptId: string;
  currentActive: boolean;
  shouldScrollToEnd: boolean;
  currentMs: number;
  seek: (sec: number) => void;
  startPlayback: () => void;
  audioExists: boolean;
  maxSpeakerNumber?: number;
  request: RenderTranscriptRequest | null;
  editMode: boolean;
}) {
  const resolvedSegments = useResolvedSpeakerSegments(
    rawSegments,
    currentActive ? request : null,
  );
  const segments = useStableSegments(resolvedSegments);
  const { offsetMs, sessionId } = useTranscriptTimelineMetadata(
    transcriptId,
    !currentActive,
  );
  const labelContext = useMemo<RenderLabelContext | undefined>(() => {
    if (!request) return undefined;

    const names = new Map(
      request.humans.map((human) => [human.human_id, human.name]),
    );
    return {
      getSelfHumanId: () =>
        request.speaker_context
          ? undefined
          : (request.self_human_id ?? undefined),
      getHumanName: (humanId) => names.get(humanId),
      getParticipantHumanIds: () =>
        request.speaker_context ? [] : request.participant_human_ids,
    };
  }, [request]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <SegmentsList
      segments={segments}
      scrollElement={scrollElement}
      transcriptId={transcriptId}
      sessionId={sessionId}
      labelContext={labelContext}
      offsetMs={offsetMs}
      shouldScrollToEnd={shouldScrollToEnd}
      currentMs={currentMs}
      seek={seek}
      startPlayback={startPlayback}
      audioExists={audioExists}
      maxSpeakerNumber={request?.speaker_context ? undefined : maxSpeakerNumber}
      editMode={editMode}
    />
  );
}

const SegmentsList = memo(
  function SegmentsList({
    segments,
    scrollElement,
    transcriptId,
    sessionId,
    labelContext,
    offsetMs,
    shouldScrollToEnd,
    currentMs,
    seek,
    startPlayback,
    audioExists,
    maxSpeakerNumber,
    editMode,
  }: {
    segments: Segment[];
    scrollElement: HTMLDivElement | null;
    transcriptId: string;
    sessionId?: string;
    labelContext?: RenderLabelContext;
    offsetMs: number;
    shouldScrollToEnd: boolean;
    currentMs: number;
    seek: (sec: number) => void;
    startPlayback: () => void;
    audioExists: boolean;
    maxSpeakerNumber?: number;
    editMode: boolean;
  }) {
    const search = useSearch();
    const inferredMaxSpeakerNumber = labelContext
      ? getMaxSpeakerNumberForParticipants(
          labelContext.getParticipantHumanIds?.() ?? [],
          labelContext.getSelfHumanId(),
        )
      : undefined;
    const resolvedMaxSpeakerNumber =
      maxSpeakerNumber ?? inferredMaxSpeakerNumber;
    const speakerLabelManager = useMemo(() => {
      return labelContext
        ? SpeakerLabelManager.fromSegments(
            segments,
            labelContext,
            resolvedMaxSpeakerNumber,
          )
        : new SpeakerLabelManager(resolvedMaxSpeakerNumber);
    }, [labelContext, resolvedMaxSpeakerNumber, segments]);
    const speakerLabels = useMemo(() => {
      const labels = new Map<Segment, string>();
      for (const segment of segments) {
        labels.set(
          segment,
          segment.speaker_label ??
            SegmentKeyUtils.renderLabel(
              segment.key,
              labelContext,
              speakerLabelManager,
            ),
        );
      }
      return labels;
    }, [labelContext, segments, speakerLabelManager]);
    const transcriptSearch = useMemo<TranscriptSearchRenderState>(() => {
      const query = search?.query.trim() ?? "";
      if (!search?.isVisible || !query) {
        return EMPTY_TRANSCRIPT_SEARCH;
      }

      return {
        query,
        activeMatchId: search.activeMatchId,
        caseSensitive: search.caseSensitive,
        wholeWord: search.wholeWord,
      };
    }, [
      search?.activeMatchId,
      search?.caseSensitive,
      search?.isVisible,
      search?.query,
      search?.wholeWord,
    ]);
    // Identité de section de chaque segment (sélection, surlignage) : la clé
    // stable du segment, qui ne dépend que de son premier mot. L'identifiant
    // d'un segment vivant contient son dernier mot et change à chaque partiel.
    const segmentKeys = useMemo(
      () => createSegmentKeys(segments, transcriptId),
      [segments, transcriptId],
    );
    // Lignes virtuelles : un paragraphe par ligne (issue 281). En édition, le
    // texte d'un segment reste un seul bloc éditable (voir SegmentRenderer).
    const paragraphs = useTranscriptParagraphs(segments, !editMode);
    const rowSegments = useMemo(
      () => paragraphs.map((paragraph) => paragraph.segment),
      [paragraphs],
    );
    const continuations = useMemo(
      () => paragraphs.map((paragraph) => paragraph.continuation),
      [paragraphs],
    );
    const rowKeys = useMemo(
      () => createSegmentKeys(rowSegments, transcriptId),
      [rowSegments, transcriptId],
    );
    // L'en-tête du premier paragraphe réattribue le segment entier, tel qu'il
    // est au moment du choix, sans que ce paragraphe soit refait à chaque
    // partiel.
    const segmentOfRow = useMemo(
      () =>
        new Map(
          paragraphs.map((paragraph) => [
            paragraph.segment,
            segments[paragraph.segmentIndex]!,
          ]),
        ),
      [paragraphs, segments],
    );
    const segmentOfRowRef = useRef(segmentOfRow);
    useEffect(() => {
      segmentOfRowRef.current = segmentOfRow;
    }, [segmentOfRow]);
    const resolveSegment = useCallback(
      (row: Segment) => segmentOfRowRef.current.get(row) ?? row,
      [],
    );
    const virtual = useVirtualSegments({
      segments: rowSegments,
      segmentKeys: rowKeys,
      continuations,
      scrollElement,
      activeMatchId: transcriptSearch.activeMatchId,
      searchEnabled: transcriptSearch.query.length > 0,
      currentMs,
      offsetMs,
    });
    useRegisterTranscriptSegments(
      transcriptId,
      sessionId,
      offsetMs,
      segments,
      segmentKeys,
    );

    const seekAndPlay = useCallback(
      (word: SegmentWord) => {
        if (audioExists && isTranscriptWordSeekable(word)) {
          seek((offsetMs + word.start_ms) / 1000);
          startPlayback();
        }
      },
      [audioExists, offsetMs, seek, startPlayback],
    );

    // Nouveau tour de parole : recoller au bas. Ne dépend que du nombre de
    // segments, pas des paragraphes ni des partiels : pendant un monologue,
    // c'est `useAutoScroll` qui suit la croissance du texte.
    useLayoutEffect(() => {
      if (!scrollElement || !shouldScrollToEnd) {
        return;
      }
      const raf = requestAnimationFrame(() => {
        scrollElement.scrollTo({
          top: scrollElement.scrollHeight,
          behavior: "auto",
        });
      });
      return () => cancelAnimationFrame(raf);
    }, [scrollElement, segments.length, shouldScrollToEnd]);

    return (
      <div
        ref={virtual.listRef}
        data-transcript-virtual-total={segments.length}
        className="relative w-full min-w-0 overflow-x-clip"
        style={{ height: virtual.totalHeight }}
      >
        {virtual.virtualItems.map(({ index, key, top, measuredHeight }) => {
          const { segment, segmentIndex, continuation } = paragraphs[index]!;
          const parent = segments[segmentIndex]!;
          return (
            <SegmentRow
              key={key}
              rowKey={key}
              index={index}
              top={top}
              measuredHeight={measuredHeight}
              onMeasure={virtual.measureRow}
              onFocus={virtual.handleRowFocus}
              onBlur={virtual.handleRowBlur}
              segment={segment}
              offsetMs={offsetMs}
              transcriptId={transcriptId}
              sessionId={sessionId}
              speakerLabel={
                continuation
                  ? ""
                  : (speakerLabels.get(parent) ??
                    SegmentKeyUtils.renderLabel(parent.key))
              }
              sectionId={segmentKeys[segmentIndex]}
              showHeader={!continuation}
              continuation={continuation}
              resolveSegment={resolveSegment}
              currentMs={currentMs}
              seekAndPlay={seekAndPlay}
              audioExists={audioExists}
              search={transcriptSearch}
              editMode={editMode}
            />
          );
        })}
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.transcriptId === nextProps.transcriptId &&
      prevProps.sessionId === nextProps.sessionId &&
      prevProps.labelContext === nextProps.labelContext &&
      prevProps.scrollElement === nextProps.scrollElement &&
      prevProps.offsetMs === nextProps.offsetMs &&
      prevProps.shouldScrollToEnd === nextProps.shouldScrollToEnd &&
      prevProps.currentMs === nextProps.currentMs &&
      prevProps.audioExists === nextProps.audioExists &&
      prevProps.maxSpeakerNumber === nextProps.maxSpeakerNumber &&
      prevProps.editMode === nextProps.editMode &&
      prevProps.seek === nextProps.seek &&
      prevProps.startPlayback === nextProps.startPlayback &&
      segmentsShallowEqual(prevProps.segments, nextProps.segments)
    );
  },
);
nameMemoComponent(SegmentsList, "SegmentsList");

type SegmentRowProps = SegmentRendererProps & {
  rowKey: string;
  continuation: boolean;
  index: number;
  top: number;
  measuredHeight?: number;
  onMeasure: (key: string, height: number) => void;
  onFocus: (index: number) => void;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
};

// Un bloc de la liste virtuelle. Mémoïsé avec le comparateur du bloc : à
// chaque partiel, les blocs finaux ne sont pas refaits, seul le bloc vivant
// l'est.
const SegmentRow = memo(function SegmentRow({
  rowKey,
  index,
  top,
  measuredHeight,
  onMeasure,
  onFocus,
  onBlur,
  continuation,
  ...segmentProps
}: SegmentRowProps) {
  return (
    <VirtualSegmentRow
      rowKey={rowKey}
      index={index}
      top={top}
      measuredHeight={measuredHeight}
      onMeasure={onMeasure}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className={cn([index > 0 && (continuation ? "pt-2" : "pt-4")])}>
        <SegmentRenderer {...segmentProps} />
      </div>
    </VirtualSegmentRow>
  );
}, segmentRowPropsEqual);
nameMemoComponent(SegmentRow, "SegmentRow");

function segmentRowPropsEqual(prev: SegmentRowProps, next: SegmentRowProps) {
  return (
    prev.rowKey === next.rowKey &&
    prev.index === next.index &&
    prev.top === next.top &&
    prev.measuredHeight === next.measuredHeight &&
    prev.onMeasure === next.onMeasure &&
    prev.onFocus === next.onFocus &&
    prev.onBlur === next.onBlur &&
    prev.continuation === next.continuation &&
    segmentRendererPropsEqual(prev, next)
  );
}

function useRegisterTranscriptSegments(
  transcriptId: string,
  sessionId: string | undefined,
  offsetMs: number,
  segments: Segment[],
  segmentKeys: string[],
) {
  const registerSource = useRegisterTranscriptSelectionSource();
  const getEntriesRef = useRef<() => Array<[string, TranscriptWordSelection]>>(
    () => [],
  );
  getEntriesRef.current = () =>
    segments.flatMap((segment, index) => {
      const selection = getTranscriptSelectionFromSegment({
        transcriptId,
        sessionId,
        offsetMs,
        segment,
      });
      if (!selection) {
        return [];
      }
      return [
        [
          getTranscriptSectionKey(transcriptId, segmentKeys[index]!),
          selection,
        ] as const,
      ];
    });

  useEffect(() => {
    return registerSource(transcriptId, () => getEntriesRef.current());
  }, [registerSource, transcriptId]);
}
