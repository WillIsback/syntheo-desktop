import { Trans } from "@lingui/react/macro";

import { TranscriptionLanguageWarningToast } from "./language-warning";
import { SttServerCard } from "./server-card";

import { SettingsPageTitle } from "~/settings/page-title";

export function STT() {
  return (
    <div className="flex flex-col gap-[26px]">
      <SettingsPageTitle
        title={<Trans>Transcription</Trans>}
        lede={
          <Trans>
            The server that turns speech into text during your meetings. Audio
            is never written to disk.
          </Trans>
        }
      />
      <TranscriptionLanguageWarningToast />
      <SttServerCard />
    </div>
  );
}
