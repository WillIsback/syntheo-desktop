// Coupures de transcription d'une capture, en millisecondes epoch. Sans audio
// conservé, elles ne peuvent pas être comblées : elles sont affichées datées.
export type CaptureInterruption = { startedAt: number; endedAt: number };

export function formatInterruption(
  interruption: CaptureInterruption,
  timeZone?: string,
): string {
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  return `${time.format(interruption.startedAt)}–${time.format(interruption.endedAt)}`;
}

export function formatInterruptions(
  interruptions: CaptureInterruption[],
  timeZone?: string,
): string {
  return `Transcription interrompue ${interruptions
    .map((interruption) => formatInterruption(interruption, timeZone))
    .join(", ")}`;
}
