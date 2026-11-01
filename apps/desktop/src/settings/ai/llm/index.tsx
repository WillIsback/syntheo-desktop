import { Trans } from "@lingui/react/macro";

import { LlmServerCard, ReasoningEffortRow } from "./server-card";

import { SettingsPageTitle } from "~/settings/page-title";
import { SettingRow, SettingRows } from "~/settings/setting-row";

export function LLM() {
  return (
    <div className="flex flex-col gap-[26px]">
      <SettingsPageTitle
        title={<Trans>Synthesis</Trans>}
        lede={
          <Trans>
            The language model that writes your meeting notes and answers when
            you ask a note a question.
          </Trans>
        }
      />
      <LlmServerCard />
      <SettingRows>
        <SettingRow
          controlWidth="content"
          title={<Trans>Reasoning effort</Trans>}
          description={
            <Trans>
              More effort gives finer summaries, but slower. Auto leaves it to
              the server.
            </Trans>
          }
        >
          {() => <ReasoningEffortRow />}
        </SettingRow>
      </SettingRows>
    </div>
  );
}
