import { t } from "@lingui/core/macro";

import { commands as openerCommands } from "@syntheo/plugin-opener2";
import { ArrowSquareOut } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";

import { CliSettingsSections } from "./cli";
import { WebhooksSection } from "./webhooks";

import { SettingsPageTitle } from "~/settings/page-title";

export { buildMcpConfiguration, getCliInstallNotification } from "./cli";

const DEVELOPERS_GUIDE_URL =
  "https://github.com/WillIsback/syntheo-desktop#readme";

export function SettingsDevelopers() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <SettingsPageTitle title={t`Developers`} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            void openerCommands.openUrl(DEVELOPERS_GUIDE_URL, null)
          }
        >
          {t`Guide`}
          <ArrowSquareOut className="size-3.5" />
        </Button>
      </div>
      <CliSettingsSections />
      <WebhooksSection />
    </div>
  );
}
