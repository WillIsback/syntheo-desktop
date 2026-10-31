import { Trans } from "@lingui/react/macro";

import { Waveform } from "@syntheo/ui/components/icons";
import { Spinner } from "@syntheo/ui/components/ui/spinner";

export function TranscriptListeningState({
  status,
}: {
  status: "listening" | "finalizing";
}) {
  const isFinalizing = status === "finalizing";

  return (
    <div
      role="status"
      className="flex h-full min-h-[400px] flex-col items-center justify-center px-6 text-center"
    >
      {isFinalizing ? (
        <div className="text-muted-foreground mb-5">
          <Spinner size={36} />
        </div>
      ) : (
        <Waveform
          aria-hidden
          className="text-muted-foreground mb-5 size-9 stroke-[1.5]"
        />
      )}
      <div className="flex max-w-md flex-col gap-2">
        <p className="text-base font-medium">
          {isFinalizing ? (
            <Trans>Finalizing transcription…</Trans>
          ) : (
            <Trans>Listening…</Trans>
          )}
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {isFinalizing ? (
            <Trans>The transcription is still being written.</Trans>
          ) : (
            <Trans>
              The transcription will appear here as soon as the first words
              arrive.
            </Trans>
          )}
        </p>
      </div>
    </div>
  );
}
