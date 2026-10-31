import { Fragment, memo, useMemo } from "react";

import { cn } from "@syntheo/utils";

import type { HighlightSegment } from "./utils";

import type { SegmentWord } from "~/stt/live-segment";
import { isTranscriptWordSeekable } from "~/stt/timing";

interface WordSpanProps {
  word: SegmentWord;
  displayText: string;
  audioExists: boolean;
  onClickWord: (word: SegmentWord) => void;
  highlightSegments?: HighlightSegment[];
  isActiveMatch?: boolean;
}

export const WordSpan = memo(function WordSpan(props: WordSpanProps) {
  const content = useHighlightedContent(
    props.word,
    props.displayText,
    props.highlightSegments,
    props.isActiveMatch ?? false,
  );
  const canSeek = props.audioExists && isTranscriptWordSeekable(props.word);
  const className = useMemo(
    () =>
      cn([
        canSeek && "hover:bg-accent/60 cursor-pointer",
        !props.word.is_final && ["opacity-60", "italic"],
      ]),
    [canSeek, props.word.is_final],
  );

  return (
    <span
      role={canSeek ? "button" : undefined}
      tabIndex={canSeek ? 0 : undefined}
      onClick={() => canSeek && props.onClickWord(props.word)}
      onKeyDown={(event) => {
        if (canSeek && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          props.onClickWord(props.word);
        }
      }}
      className={className}
      data-transcript-word-id={props.word.id}
      data-transcript-word-start-ms={props.word.start_ms}
    >
      {content}
    </span>
  );
});

function useHighlightedContent(
  word: SegmentWord,
  displayText: string,
  segments: HighlightSegment[] | undefined,
  isActive: boolean,
) {
  return useMemo(() => {
    if (!segments) {
      return displayText;
    }

    const baseKey = word.id ?? word.text ?? "word";

    return segments.map((segment, index) =>
      segment.isMatch ? (
        <span
          key={`${baseKey}-match-${index}`}
          className={isActive ? "bg-chart-3/35" : "bg-chart-3/15"}
        >
          {segment.text}
        </span>
      ) : (
        <Fragment key={`${baseKey}-text-${index}`}>{segment.text}</Fragment>
      ),
    );
  }, [displayText, isActive, segments, word.id, word.text]);
}
