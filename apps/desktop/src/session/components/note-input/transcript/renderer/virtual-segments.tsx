import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";

import {
  createTranscriptSearchIndex,
  getTranscriptSearchIndexMatches,
  registerTranscriptSearchSource,
  type TranscriptSearchSource,
} from "../../search/matching";
import { observeScrollContent, scrollBehavior } from "./viewport-hooks";

import type { Segment } from "~/stt/live-segment";

const ESTIMATED_LINE_HEIGHT = 22;
const ESTIMATED_ROW_CHARS = 90;
const ESTIMATED_ROW_CHROME = 36;
const SEGMENT_GAP = 16;
// Paragraphe suivant d'une même prise de parole (issue 281) : ni en-tête, ni
// marge sous l'en-tête, et un espacement de paragraphe plus serré.
const ESTIMATED_CONTINUATION_CHROME = 0;
const PARAGRAPH_GAP = 8;
const OVERSCAN_PX = 800;
const FALLBACK_VIEWPORT_HEIGHT = 800;

// Largeur moyenne d'un caractère du texte de transcription : 90 caractères
// tiennent dans la colonne pleine largeur (~680px).
const ESTIMATED_CHAR_WIDTH_PX = 7.5;

function estimatedCharsPerRow(rowWidthPx?: number) {
  if (!rowWidthPx || !Number.isFinite(rowWidthPx) || rowWidthPx <= 0) {
    return ESTIMATED_ROW_CHARS;
  }
  return Math.max(12, Math.floor(rowWidthPx / ESTIMATED_CHAR_WIDTH_PX));
}

// La marge d'écoute ne fait que 280px : estimer avec la largeur réelle évite
// que les hauteurs mesurées, bien plus grandes que l'estimation, ne décalent
// brutalement les blocs à chaque mesure.
// Les hauteurs estimées sont recalculées à chaque battement pour toutes les
// lignes : le compte de caractères d'une ligne inchangée n'est pas relu
// (issue 287).
const characterCounts = new WeakMap<Segment, number>();

function getCharacterCount(segment: Segment): number {
  let count = characterCounts.get(segment);
  if (count === undefined) {
    count = segment.words.reduce(
      (total, word) => total + word.text.length + 1,
      0,
    );
    characterCounts.set(segment, count);
  }
  return count;
}

export function estimateTranscriptRowHeight(
  segment: Segment,
  index: number,
  rowWidthPx?: number,
  continuation = false,
) {
  const characterCount = getCharacterCount(segment);
  const lineCount =
    characterCount === 0
      ? 0
      : Math.max(
          1,
          Math.ceil(characterCount / estimatedCharsPerRow(rowWidthPx)),
        );
  if (continuation) {
    return (
      ESTIMATED_CONTINUATION_CHROME +
      lineCount * ESTIMATED_LINE_HEIGHT +
      (index > 0 ? PARAGRAPH_GAP : 0)
    );
  }
  return (
    ESTIMATED_ROW_CHROME +
    lineCount * ESTIMATED_LINE_HEIGHT +
    (index > 0 ? SEGMENT_GAP : 0)
  );
}

export function useVirtualSegments({
  segments,
  segmentKeys,
  continuations,
  scrollElement,
  activeMatchId,
  searchEnabled,
  currentMs,
  offsetMs,
}: {
  segments: Segment[];
  segmentKeys: string[];
  // Lignes qui poursuivent la prise de parole précédente (sans en-tête).
  continuations?: readonly boolean[];
  scrollElement: HTMLDivElement | null;
  activeMatchId: string | null;
  searchEnabled: boolean;
  currentMs: number;
  offsetMs: number;
}) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const unregisterSearchRef = useRef<(() => void) | null>(null);
  const searchSourceRef = useRef<TranscriptSearchSource>(() => []);
  const scrollToIndexRef = useRef<
    (index: number, behavior: ScrollBehavior) => void
  >(() => {});
  const keySet = useMemo(() => new Set(segmentKeys), [segmentKeys]);
  const latestKeysRef = useRef(keySet);
  latestKeysRef.current = keySet;
  const pendingHeightsRef = useRef(new Map<string, number>());
  const measurementFrameRef = useRef<number | null>(null);

  useMountEffect(() => {
    return () => {
      if (measurementFrameRef.current !== null) {
        cancelAnimationFrame(measurementFrameRef.current);
        measurementFrameRef.current = null;
      }
      pendingHeightsRef.current.clear();
    };
  });

  const listWidth = useElementWidth(listElement);
  const estimatedHeights = useMemo(
    () =>
      segments.map((segment, index) =>
        estimateTranscriptRowHeight(
          segment,
          index,
          listWidth,
          continuations?.[index] ?? false,
        ),
      ),
    [continuations, listWidth, segments],
  );
  const offsets = useMemo(() => {
    const values = [0];
    for (const [index, key] of segmentKeys.entries()) {
      values.push(
        values[index] +
          (measuredHeights.get(key) ??
            estimatedHeights[index] ??
            ESTIMATED_ROW_CHROME),
      );
    }
    return values;
  }, [estimatedHeights, measuredHeights, segmentKeys]);
  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const viewport = useVirtualViewport(scrollElement, listElement);
  // Index construits seulement quand ils servent (recherche, lecture) : à
  // chaque battement de l'écoute, ils reliraient tous les mots (issue 287).
  const activeMatchIndex = useMemo(
    () =>
      activeMatchId ? findWordSegmentIndex(segments, activeMatchId) : null,
    [activeMatchId, segments],
  );
  const playing = currentMs > 0;
  const segmentIndex = useMemo(
    () => (playing ? createSegmentIndex(segments) : null),
    [playing, segments],
  );
  const playbackIndex = useMemo(
    () =>
      segmentIndex
        ? findPlaybackSegmentIndex(segmentIndex, currentMs, offsetMs)
        : null,
    [currentMs, offsetMs, segmentIndex],
  );
  const selectedIndexes = useSelectedSegmentIndexes(listElement);
  const virtualItems = useMemo(() => {
    const visibleTop = viewport.scrollTop - viewport.listTop;
    const visibleBottom = visibleTop + viewport.height;
    const indexes = new Set<number>();

    if (visibleBottom > 0 && visibleTop < totalHeight) {
      const start = findRowIndex(
        offsets,
        Math.max(0, visibleTop - OVERSCAN_PX),
      );
      const end = findRowIndex(
        offsets,
        Math.min(totalHeight, visibleBottom + OVERSCAN_PX),
      );
      for (
        let index = start;
        index <= end && index < segments.length;
        index++
      ) {
        indexes.add(index);
      }
    } else if (!scrollElement && segments.length > 0) {
      const end = findRowIndex(offsets, FALLBACK_VIEWPORT_HEIGHT + OVERSCAN_PX);
      for (let index = 0; index <= end && index < segments.length; index++) {
        indexes.add(index);
      }
    }

    if (activeMatchIndex !== null) indexes.add(activeMatchIndex);
    if (playbackIndex !== null) indexes.add(playbackIndex);
    if (focusedIndex !== null) indexes.add(focusedIndex);
    for (const index of selectedIndexes) indexes.add(index);

    return Array.from(indexes)
      .sort((left, right) => left - right)
      .map((index) => {
        const key = segmentKeys[index]!;
        return {
          index,
          key,
          top: offsets[index]!,
          measuredHeight: measuredHeights.get(key),
        };
      });
  }, [
    activeMatchIndex,
    focusedIndex,
    measuredHeights,
    offsets,
    playbackIndex,
    scrollElement,
    selectedIndexes,
    segmentKeys,
    segments.length,
    totalHeight,
    viewport.height,
    viewport.listTop,
    viewport.scrollTop,
  ]);

  const measureRow = useCallback((key: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    pendingHeightsRef.current.set(key, height);
    if (measurementFrameRef.current !== null) return;

    // Resizing reflows many rows together; copy the height cache only once.
    measurementFrameRef.current = requestAnimationFrame(() => {
      measurementFrameRef.current = null;
      const pending = pendingHeightsRef.current;
      pendingHeightsRef.current = new Map();
      setMeasuredHeights((current) => {
        const keys = latestKeysRef.current;
        const changed = Array.from(pending).some(([key, height]) => {
          const previous = current.get(key);
          return (
            keys.has(key) &&
            (previous === undefined || Math.abs(previous - height) >= 1)
          );
        });
        const pruneNeeded = Array.from(current.keys()).some(
          (key) => !keys.has(key),
        );
        if (!changed && !pruneNeeded) return current;

        const next = new Map<string, number>();
        for (const [key, height] of current) {
          if (keys.has(key)) next.set(key, height);
        }
        for (const [key, height] of pending) {
          if (keys.has(key)) next.set(key, height);
        }
        return next;
      });
    });
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "auto") => {
      if (
        !scrollElement ||
        !listElement ||
        index < 0 ||
        index >= segments.length
      ) {
        return;
      }
      const scrollRect = scrollElement.getBoundingClientRect();
      const listRect = listElement.getBoundingClientRect();
      const listTop = scrollElement.scrollTop + listRect.top - scrollRect.top;
      const rowHeight = offsets[index + 1]! - offsets[index]!;
      const top =
        listTop +
        offsets[index]! -
        Math.max(0, (scrollElement.clientHeight - rowHeight) / 2);
      scrollElement.scrollTo({ top: Math.max(0, top), behavior });
    },
    [listElement, offsets, scrollElement, segments.length],
  );
  scrollToIndexRef.current = scrollToIndex;

  const previousActiveMatchRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (
      activeMatchId &&
      activeMatchId !== previousActiveMatchRef.current &&
      activeMatchIndex !== null &&
      listElement &&
      scrollElement
    ) {
      scrollToIndex(activeMatchIndex, scrollBehavior());
      previousActiveMatchRef.current = activeMatchId;
    } else if (!activeMatchId) {
      previousActiveMatchRef.current = null;
    }
  }, [
    activeMatchId,
    activeMatchIndex,
    listElement,
    scrollElement,
    scrollToIndex,
  ]);

  const searchIndex = useMemo(
    () =>
      searchEnabled
        ? createTranscriptSearchIndex(
            segments.flatMap((segment, index) =>
              segment.words.map((word) => ({
                id: word.id ?? null,
                text: word.text.trim(),
                scrollIntoView: () =>
                  scrollToIndexRef.current(index, scrollBehavior()),
              })),
            ),
          )
        : null,
    [searchEnabled, segments],
  );
  searchSourceRef.current = (preparedQuery, options) =>
    searchIndex
      ? getTranscriptSearchIndexMatches(searchIndex, preparedQuery, options)
      : [];

  const listRef = useCallback(
    (node: HTMLDivElement | null) => {
      unregisterSearchRef.current?.();
      unregisterSearchRef.current = null;
      setListElement(node);
      if (node && scrollElement) {
        unregisterSearchRef.current = registerTranscriptSearchSource(
          scrollElement,
          (preparedQuery, options) =>
            searchSourceRef.current(preparedQuery, options),
        );
      }
    },
    [scrollElement],
  );

  const handleRowFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);
  const handleRowBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocusedIndex(null);
    }
  }, []);

  return {
    handleRowBlur,
    handleRowFocus,
    listRef,
    measureRow,
    totalHeight,
    virtualItems,
  };
}

function useSelectedSegmentIndexes(listElement: HTMLDivElement | null) {
  const subscribe = useCallback((notify: () => void) => {
    document.addEventListener("selectionchange", notify);
    return () => document.removeEventListener("selectionchange", notify);
  }, []);
  const getSnapshot = useCallback(() => {
    if (!listElement) return "";
    const selection = window.getSelection();
    const indexes = [selection?.anchorNode, selection?.focusNode]
      .flatMap((node) => {
        const element =
          node instanceof Element ? node : (node?.parentElement ?? null);
        const row = element?.closest<HTMLElement>(
          "[data-transcript-virtual-index]",
        );
        if (!row || !listElement.contains(row)) return [];
        const index = Number(row.dataset.transcriptVirtualIndex);
        return Number.isInteger(index) ? [index] : [];
      })
      .sort((left, right) => left - right);
    return Array.from(new Set(indexes)).join(",");
  }, [listElement]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () =>
      snapshot ? snapshot.split(",").map(Number).filter(Number.isInteger) : [],
    [snapshot],
  );
}

export function VirtualSegmentRow({
  rowKey,
  top,
  index,
  measuredHeight,
  onMeasure,
  onFocus,
  onBlur,
  children,
}: {
  rowKey: string;
  top: number;
  index: number;
  measuredHeight?: number;
  onMeasure: (key: string, height: number) => void;
  onFocus: (index: number) => void;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const observerRef = useRef<ResizeObserver | null>(null);
  const rowRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;

      const measure = () => onMeasure(rowKey, node.offsetHeight);
      measure();
      if (typeof ResizeObserver !== "undefined") {
        observerRef.current = new ResizeObserver((entries) => {
          const height = entries[0]?.borderBoxSize?.[0]?.blockSize;
          if (height === undefined) measure();
          else onMeasure(rowKey, height);
        });
        observerRef.current.observe(node, { box: "border-box" });
      }
    },
    [onMeasure, rowKey],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      left: 0,
      position: "absolute",
      top,
      width: "100%",
      // Chaque ligne est isolée : un partiel qui fait grandir la dernière ne
      // remet en page ni ne repeint les autres (issue 281).
      contain: "content",
      // Les blocs du débord (overscan), hors de l'écran, ne sont ni mis en
      // page ni peints. Seulement une fois mesurés : la taille réservée est
      // alors exactement la hauteur mesurée, donc ni la position des blocs,
      // ni le défilement vers la fin, ni le centrage d'un résultat de
      // recherche ne bougent. Un bloc jamais mesuré est rendu normalement,
      // sinon sa première mesure renverrait la taille réservée au lieu de
      // sa vraie hauteur.
      ...(measuredHeight === undefined
        ? null
        : {
            contentVisibility: "auto",
            containIntrinsicSize: `auto ${measuredHeight}px`,
          }),
    }),
    [measuredHeight, top],
  );

  return (
    <div
      ref={rowRef}
      data-transcript-virtual-index={index}
      style={style}
      onFocusCapture={() => onFocus(index)}
      onBlurCapture={onBlur}
    >
      {children}
    </div>
  );
}

function useElementWidth(element: HTMLElement | null): number | undefined {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!element || typeof ResizeObserver === "undefined") {
        return () => {};
      }
      const observer = new ResizeObserver(notify);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [element],
  );
  // Arrondie à 10px près pour ne pas tout réestimer au moindre pixel.
  const getSnapshot = useCallback(
    () =>
      element && element.clientWidth > 0
        ? Math.round(element.clientWidth / 10) * 10
        : undefined,
    [element],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useVirtualViewport(
  scrollElement: HTMLDivElement | null,
  listElement: HTMLDivElement | null,
) {
  const store = useMemo(
    () => createVirtualViewportStore(scrollElement, listElement),
    [listElement, scrollElement],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [scrollTop, height, listTop] = snapshot.split("|").map(Number);
  return { scrollTop, height, listTop };
}

function createVirtualViewportStore(
  scrollElement: HTMLDivElement | null,
  listElement: HTMLDivElement | null,
) {
  let listTop: number | null = null;
  let snapshot = "0|800|0";
  let animationFrame: number | null = null;
  let shouldMeasureList = true;
  const listeners = new Set<() => void>();

  const refresh = (measureList: boolean) => {
    if (!scrollElement) {
      snapshot = `0|${FALLBACK_VIEWPORT_HEIGHT}|0`;
      return;
    }

    if (measureList || listTop === null) {
      const scrollRect = scrollElement.getBoundingClientRect();
      const listRect = listElement?.getBoundingClientRect();
      listTop = listRect
        ? scrollElement.scrollTop + listRect.top - scrollRect.top
        : scrollElement.scrollTop;
    }
    const next = `${scrollElement.scrollTop}|${scrollElement.clientHeight || FALLBACK_VIEWPORT_HEIGHT}|${listTop}`;
    if (next !== snapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    }
  };

  const scheduleRefresh = (measureList = false) => {
    shouldMeasureList ||= measureList;
    if (animationFrame !== null) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      const measure = shouldMeasureList;
      shouldMeasureList = false;
      refresh(measure);
    });
  };

  refresh(true);
  const subscribe = (listener: () => void) => {
    if (!scrollElement) return () => {};
    listeners.add(listener);
    const handleScroll = () => scheduleRefresh();
    const handleLayout = () => scheduleRefresh(true);
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleLayout);
    // La position de la liste ne change que si un bloc au-dessus d'elle
    // change de hauteur : pas à chaque partiel (issue 281).
    const stopObservingContent = observeScrollContent(
      scrollElement,
      handleLayout,
    );
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(handleLayout);
    if (listElement) resizeObserver?.observe(listElement);
    scheduleRefresh(true);

    return () => {
      listeners.delete(listener);
      scrollElement.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleLayout);
      resizeObserver?.disconnect();
      stopObservingContent();
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };
  };

  return { getSnapshot: () => snapshot, subscribe };
}

function findRowIndex(offsets: number[], target: number): number {
  if (offsets.length <= 1) return 0;
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1]! <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

// Première ligne qui contient le mot `wordId`.
function findWordSegmentIndex(
  segments: Segment[],
  wordId: string,
): number | null {
  const index = segments.findIndex((segment) =>
    segment.words.some((word) => word.id === wordId),
  );
  return index === -1 ? null : index;
}

function createSegmentIndex(segments: Segment[]) {
  const playbackStarts: number[] = [];
  const playbackEnds: number[] = [];
  const playbackSegmentIndexes: number[] = [];
  const playbackPrefixMaxEnds: number[] = [];

  segments.forEach((segment, segmentIndex) => {
    const first = segment.words[0];
    const last = segment.words[segment.words.length - 1];
    if (!first || !last) return;
    const start = first.start_ms ?? 0;
    const end = last.end_ms ?? 0;
    playbackStarts.push(start);
    playbackEnds.push(end);
    playbackSegmentIndexes.push(segmentIndex);
    playbackPrefixMaxEnds.push(
      Math.max(
        playbackPrefixMaxEnds[playbackPrefixMaxEnds.length - 1] ??
          Number.NEGATIVE_INFINITY,
        end,
      ),
    );
  });

  return {
    playbackStarts,
    playbackEnds,
    playbackSegmentIndexes,
    playbackPrefixMaxEnds,
  };
}

function findPlaybackSegmentIndex(
  index: ReturnType<typeof createSegmentIndex>,
  currentMs: number,
  offsetMs: number,
): number | null {
  if (currentMs <= 0) return null;
  const target = currentMs - offsetMs;
  let low = 0;
  let high = index.playbackStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.playbackStarts[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  const lastStarted = low - 1;
  if (lastStarted < 0) return null;

  low = 0;
  high = lastStarted;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.playbackPrefixMaxEnds[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return index.playbackEnds[low]! >= target
    ? index.playbackSegmentIndexes[low]!
    : null;
}
