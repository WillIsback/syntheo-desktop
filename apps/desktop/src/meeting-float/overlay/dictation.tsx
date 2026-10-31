import type { FloatingBarState } from "@syntheo/plugin-windows";

import { tokensFor } from "./palette";

export function DictationTranscript({
  dictation,
  colorScheme,
}: {
  dictation: NonNullable<FloatingBarState["dictation"]>;
  colorScheme: FloatingBarState["colorScheme"];
}) {
  const status =
    dictation.phase === "transcribing"
      ? "Finishing…"
      : dictation.phase === "starting"
        ? "Starting…"
        : "Listening…";
  const empty = dictation.previewUnavailable
    ? "Live preview is unavailable. Your text will appear when you finish."
    : !dictation.previewEnabled
      ? "Enable Live transcript preview in Settings → Dictation to see words as you speak."
      : status;

  return (
    <p
      className="px-1 text-[15px] leading-6 break-words whitespace-pre-wrap"
      style={{ color: tokensFor(colorScheme).foreground }}
      aria-live="polite"
      aria-atomic="false"
    >
      {dictation.text || dictation.partial ? (
        <>
          {dictation.text}
          {dictation.text && dictation.partial ? " " : ""}
          <span className="opacity-60">{dictation.partial}</span>
        </>
      ) : (
        <span className="opacity-60">{empty}</span>
      )}
    </p>
  );
}
