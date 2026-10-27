import type { InstalledApp } from "@syntheo/plugin-detect";

// Syntheo n'importe que des fichiers locaux ou via une CLI locale : les imports
// « connectés » cloud (MCP hébergés, OAuth Nango) ont été retirés.
export type MeetingImportProvider = {
  id: string;
  name: string;
  access: "CLI" | "Export";
  helpUrl: string;
  directImport?: "cli";
  nativeNames?: string[];
  bundleIds?: string[];
  alwaysAvailable?: boolean;
};

export type DetectedMeetingImportProvider = MeetingImportProvider & {
  installedAppId: string;
  iconUrl?: string;
};

export const MEETING_IMPORT_PROVIDERS: MeetingImportProvider[] = [
  {
    id: "plaud",
    name: "Plaud",
    access: "CLI",
    helpUrl:
      "https://support.plaud.ai/hc/en-us/articles/57751026815257-Plaud-CLI",
    directImport: "cli",
    nativeNames: ["Plaud", "Plaud Desktop"],
    bundleIds: ["ai.plaud.desktop.plaud"],
  },
  {
    id: "notta",
    name: "Notta",
    access: "Export",
    helpUrl:
      "https://support.notta.ai/hc/en-us/articles/18646448413083-Download-and-Share-transcripts",
    nativeNames: ["Notta"],
  },
  {
    id: "bluedot",
    name: "Bluedot",
    access: "Export",
    helpUrl:
      "https://help.bluedothq.com/en/articles/12497819-export-transcript-as-pdf-or-txt",
  },
  {
    id: "jamie",
    name: "Jamie",
    access: "Export",
    helpUrl: "https://www.meetjamie.ai/",
    nativeNames: ["Jamie"],
    bundleIds: ["com.jamie.app"],
  },
  {
    id: "chatgpt-record",
    name: "ChatGPT Record",
    access: "Export",
    helpUrl:
      "https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data.csv",
    nativeNames: ["ChatGPT"],
    bundleIds: ["com.openai.chat", "com.openai.chatgpt"],
  },
  {
    id: "slack-huddles",
    name: "Slack Huddles",
    access: "Export",
    helpUrl:
      "https://slack.com/help/articles/31377193680019-Use-AI-to-take-huddle-notes-in-Slack",
    nativeNames: ["Slack"],
    bundleIds: ["com.tinyspeck.slackmacgap"],
  },
  {
    id: "limitless",
    name: "Limitless / Rewind",
    access: "Export",
    helpUrl: "https://developers.limitless.ai/",
    nativeNames: ["Limitless", "Rewind"],
    bundleIds: ["ai.limitless.desktop", "com.memoryvault.MemoryVault"],
  },
];

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\.app$/u, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

export function detectMeetingImportProviders(
  installedApps: InstalledApp[],
): DetectedMeetingImportProvider[] {
  const installed = installedApps.map((app) => ({
    id: app.id,
    normalizedId: app.id.toLowerCase(),
    name: normalize(app.name),
  }));

  return MEETING_IMPORT_PROVIDERS.flatMap((provider) => {
    const installedApp = installed.find(
      (app) =>
        provider.nativeNames?.some((name) => app.name === normalize(name)) ||
        provider.bundleIds?.some(
          (bundleId) => app.normalizedId === bundleId.toLowerCase(),
        ),
    );

    return installedApp
      ? [{ ...provider, installedAppId: installedApp.id }]
      : provider.alwaysAvailable
        ? [{ ...provider, installedAppId: provider.id }]
        : [];
  });
}
