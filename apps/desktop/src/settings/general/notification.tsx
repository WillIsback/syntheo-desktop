import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { useState } from "react";

import {
  commands as detectCommands,
  type InstalledApp,
  type Result,
} from "@syntheo/plugin-detect";
import { commands as notificationCommands } from "@syntheo/plugin-notification";
import { X } from "@syntheo/ui/components/icons";
import { Badge } from "@syntheo/ui/components/ui/badge";
import { Button } from "@syntheo/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@syntheo/ui/components/ui/command";
import {
  AppFloatingPanel,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@syntheo/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@syntheo/ui/components/ui/select";
import { useMountEffect } from "@syntheo/ui/hooks/use-mount-effect";
import { cn } from "@syntheo/utils";

import {
  getIgnoredBundleIds,
  getIgnorableApps,
  toggleIgnoredApp,
} from "./notification-app-options";

import { useSetSettingValues } from "~/settings/queries";
import { SettingRow, SettingSwitchRow } from "~/settings/setting-row";
import {
  type CompletionSoundName,
  normalizeCompletionSoundName,
  previewCompletionSound,
} from "~/shared/completion-sound";
import { useConfigValues } from "~/shared/config";

type CompletionSoundRowProps = {
  sound: CompletionSoundName;
  disabled: boolean;
  onSoundChange: (sound: CompletionSoundName) => void;
  onPreview: () => void;
};

function CompletionSoundRow({
  sound,
  disabled,
  onSoundChange,
  onPreview,
}: CompletionSoundRowProps) {
  return (
    <SettingRow
      title={<Trans>Sound</Trans>}
      description={<Trans>Choose from five completion sounds.</Trans>}
    >
      {(labelProps) => (
        <div className="flex w-full items-center gap-2">
          <Select
            value={sound}
            onValueChange={(value) =>
              onSoundChange(normalizeCompletionSoundName(value))
            }
            disabled={disabled}
          >
            <SelectTrigger {...labelProps} className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="ready">
                <Trans>Ready</Trans>
              </SelectItem>
              <SelectItem value="success">
                <Trans>Success</Trans>
              </SelectItem>
              <SelectItem value="chime">
                <Trans>Chime</Trans>
              </SelectItem>
              <SelectItem value="sparkle">
                <Trans>Sparkle</Trans>
              </SelectItem>
              <SelectItem value="bloom">
                <Trans>Bloom</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onPreview}
          >
            <Trans>Preview</Trans>
          </Button>
        </div>
      )}
    </SettingRow>
  );
}

type IgnoredAppsSelectorProps = {
  installedApps: InstalledApp[];
  defaultIgnoredBundleIds: string[];
  ignoredPlatforms: string[];
  includedPlatforms: string[];
  searchOpen: boolean;
  searchQuery: string;
  onSearchOpenChange: (open: boolean) => void;
  onSearchQueryChange: (query: string) => void;
  onToggleApp: (
    bundleId: string,
    ignoredPlatforms: string[],
    includedPlatforms: string[],
  ) => void;
};

function IgnoredAppsSelector({
  installedApps,
  defaultIgnoredBundleIds,
  ignoredPlatforms,
  includedPlatforms,
  searchOpen,
  searchQuery,
  onSearchOpenChange,
  onSearchQueryChange,
  onToggleApp,
}: IgnoredAppsSelectorProps) {
  const { t } = useLingui();

  const ignorableApps = getIgnorableApps({
    installedApps,
    ignoredPlatforms,
    includedPlatforms,
    inputValue: searchQuery,
    defaultIgnoredBundleIds,
  });
  const ignoredBundleIds = getIgnoredBundleIds({
    installedApps,
    ignoredPlatforms,
    includedPlatforms,
    defaultIgnoredBundleIds,
  });

  const bundleIdToName = (bundleId: string) => {
    return installedApps.find((app) => app.id === bundleId)?.name ?? bundleId;
  };

  const isDefaultIgnored = (bundleId: string) => {
    return defaultIgnoredBundleIds.includes(bundleId);
  };

  return (
    <div className="flex flex-col gap-3">
      <Popover open={searchOpen} onOpenChange={onSearchOpenChange}>
        <PopoverAnchor asChild>
          <div
            className={cn([
              "flex min-h-[38px] w-full cursor-text flex-wrap items-center gap-2 rounded-2xl border p-2",
              "focus-within:ring-ring focus-within:ring-1 focus-within:outline-hidden",
            ])}
          >
            {ignoredBundleIds.map((bundleId: string) => {
              const isDefault = isDefaultIgnored(bundleId);
              return (
                <Badge
                  key={bundleId}
                  variant="secondary"
                  className={cn([
                    "flex items-center gap-1 px-2 py-0.5 text-xs",
                    isDefault
                      ? ["bg-accent text-muted-foreground"]
                      : ["bg-muted"],
                  ])}
                  title={isDefault ? "default" : undefined}
                >
                  {bundleIdToName(bundleId)}
                  {isDefault && (
                    <span className="text-[10px] opacity-70">
                      <Trans>(default)</Trans>
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-0.5 h-3 w-3 p-0 hover:bg-transparent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleApp(
                        bundleId,
                        ignoredPlatforms,
                        includedPlatforms,
                      );
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              );
            })}
            <PopoverTrigger
              type="button"
              className="flex min-h-[22px] flex-1 cursor-text items-center gap-2 rounded-lg text-left focus-visible:outline-hidden"
            >
              <span className="text-muted-foreground text-sm">
                <Trans>Search installed apps...</Trans>
              </span>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          variant="app"
          align="start"
          style={{
            width: "var(--radix-popover-trigger-width)",
          }}
        >
          <AppFloatingPanel className="overflow-hidden">
            <Command className="rounded-[inherit] border-0 bg-transparent">
              <CommandInput
                placeholder={t`Search installed apps...`}
                value={searchQuery}
                onValueChange={onSearchQueryChange}
              />
              <CommandEmpty>
                <div className="text-muted-foreground px-2 py-1.5 text-sm">
                  <Trans>No apps found.</Trans>
                </div>
              </CommandEmpty>
              <CommandList>
                <CommandGroup className="max-h-[250px] overflow-y-auto">
                  {ignorableApps.map((app) => (
                    <CommandItem
                      key={app.id}
                      value={`${app.name} ${app.id}`}
                      onSelect={() =>
                        onToggleApp(app.id, ignoredPlatforms, includedPlatforms)
                      }
                      className={cn([
                        "cursor-pointer",
                        "hover:bg-accent! focus:bg-accent! aria-selected:bg-transparent",
                      ])}
                    >
                      <span className="flex-1 truncate">{app.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </AppFloatingPanel>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function NotificationSettingsView() {
  const currentPlatform = platform();
  const supportsMicDetection = currentPlatform !== "windows";
  const supportsDoNotDisturb = currentPlatform === "macos";
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const configs = useConfigValues([
    "notification_disabled",
    "notification_event",
    "notification_detect",
    "notification_summary_complete",
    "notification_cloudsync_complete",
    "notification_recording",
    "notification_completion_sound",
    "notification_completion_sound_name",
    "notification_bounce",
    "show_app_in_dock",
    "respect_dnd",
    "ignored_platforms",
    "included_platforms",
    "mic_active_threshold",
  ] as const);

  useMountEffect(() => {
    void notificationCommands.clearNotifications();
    return () => {
      void notificationCommands.clearNotifications();
    };
  });

  const { data: installedApps = [] } = useQuery({
    queryKey: ["settings", "all-installed-applications"],
    queryFn: detectCommands.listInstalledApplications,
    enabled: supportsMicDetection,
    select: (result: Result<InstalledApp[], string>) => {
      if (result.status === "error") {
        throw new Error(result.error);
      }
      return result.data;
    },
  });

  const { data: defaultIgnoredBundleIds = [] } = useQuery({
    queryKey: ["settings", "default-ignored-bundle-ids"],
    queryFn: detectCommands.listDefaultIgnoredBundleIds,
    enabled: supportsMicDetection,
    select: (result: Result<string[], string>) => {
      if (result.status === "error") {
        throw new Error(result.error);
      }
      return result.data;
    },
  });

  const setSettingValues = useSetSettingValues();

  const form = useForm({
    defaultValues: {
      notification_disabled: configs.notification_disabled,
      notification_event: configs.notification_event,
      notification_detect: configs.notification_detect,
      notification_summary_complete: configs.notification_summary_complete,
      notification_cloudsync_complete: configs.notification_cloudsync_complete,
      notification_recording: configs.notification_recording,
      notification_completion_sound: configs.notification_completion_sound,
      notification_completion_sound_name: normalizeCompletionSoundName(
        configs.notification_completion_sound_name,
      ),
      notification_bounce: configs.notification_bounce,
      respect_dnd: configs.respect_dnd,
      ignored_platforms: configs.ignored_platforms,
      included_platforms: configs.included_platforms,
      mic_active_threshold: configs.mic_active_threshold,
    },
    listeners: {
      onChange: ({ formApi }) => {
        void formApi.handleSubmit();
      },
    },
    onSubmit: ({ value }) => {
      setSettingValues({
        notification_disabled: value.notification_disabled,
        notification_event: value.notification_event,
        notification_detect: value.notification_detect,
        notification_summary_complete: value.notification_summary_complete,
        notification_cloudsync_complete: value.notification_cloudsync_complete,
        notification_recording: value.notification_recording,
        notification_completion_sound: value.notification_completion_sound,
        notification_completion_sound_name:
          value.notification_completion_sound_name,
        notification_bounce: value.notification_bounce,
        respect_dnd: value.respect_dnd,
        ignored_platforms: JSON.stringify(value.ignored_platforms),
        included_platforms: JSON.stringify(value.included_platforms),
        mic_active_threshold: value.mic_active_threshold,
      });
    },
  });

  const handleToggleIgnoredApp = (
    bundleId: string,
    ignoredPlatforms: string[],
    includedPlatforms: string[],
  ) => {
    if (!bundleId) {
      return;
    }

    const {
      ignoredPlatforms: newIgnoredPlatforms,
      includedPlatforms: newIncludedPlatforms,
    } = toggleIgnoredApp({
      bundleId,
      ignoredPlatforms,
      includedPlatforms,
      defaultIgnoredBundleIds,
    });

    form.setFieldValue("ignored_platforms", newIgnoredPlatforms);
    form.setFieldValue("included_platforms", newIncludedPlatforms);
    void form.handleSubmit();
    setSearchOpen(false);
    setSearchQuery("");
  };

  return (
    <div className="flex flex-col gap-6">
      <form.Field name="notification_disabled">
        {(field) => (
          <SettingSwitchRow
            title={<Trans>Disable all notifications</Trans>}
            description={
              <Trans>
                Hide all notification panels, Dock alerts, and completion
                sounds.
              </Trans>
            }
            checked={field.state.value}
            onChange={(disabled) => {
              field.handleChange(disabled);
              if (disabled) {
                void notificationCommands.clearNotifications();
              }
            }}
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.notification_disabled}>
        {(notificationsDisabled) => (
          <>
            <form.Field name="notification_summary_complete">
              {(field) => (
                <SettingSwitchRow
                  title={<Trans>Summary complete</Trans>}
                  description={<Trans>Show when a summary is ready.</Trans>}
                  checked={field.state.value}
                  onChange={field.handleChange}
                  disabled={notificationsDisabled}
                />
              )}
            </form.Field>

            <form.Field name="notification_cloudsync_complete">
              {(field) => (
                <SettingSwitchRow
                  title={<Trans>Cloud sync complete</Trans>}
                  description={
                    <Trans>Show when initial cloud sync finishes.</Trans>
                  }
                  checked={field.state.value}
                  onChange={field.handleChange}
                  disabled={notificationsDisabled}
                />
              )}
            </form.Field>

            <form.Field name="notification_event">
              {(field) => (
                <SettingSwitchRow
                  title={<Trans>Event notifications</Trans>}
                  description={
                    <Trans>Prepare for events with a 5-minute reminder.</Trans>
                  }
                  checked={field.state.value}
                  onChange={field.handleChange}
                  disabled={notificationsDisabled}
                />
              )}
            </form.Field>

            <form.Field name="notification_recording">
              {(field) => (
                <SettingSwitchRow
                  title={<Trans>Recording status prompts</Trans>}
                  description={
                    <Trans>
                      Ask before stopping when a meeting may have ended. When
                      alerts are off, Syntheo keeps listening.
                    </Trans>
                  }
                  checked={field.state.value}
                  onChange={field.handleChange}
                  disabled={notificationsDisabled}
                />
              )}
            </form.Field>

            <form.Field name="notification_completion_sound">
              {(field) => (
                <div className="flex flex-col gap-4">
                  <SettingSwitchRow
                    title={<Trans>Completion sound</Trans>}
                    description={
                      <Trans>
                        Play a sound when transcription, summaries, or cloud
                        sync finish.
                      </Trans>
                    }
                    checked={field.state.value}
                    onChange={field.handleChange}
                    disabled={notificationsDisabled}
                  />

                  {field.state.value && (
                    <div className={cn(["border-muted ml-3 border-l-2 pl-4"])}>
                      <form.Field name="notification_completion_sound_name">
                        {(soundField) => (
                          <CompletionSoundRow
                            sound={soundField.state.value}
                            disabled={notificationsDisabled}
                            onSoundChange={(sound) => {
                              soundField.handleChange(sound);
                              previewCompletionSound(sound);
                            }}
                            onPreview={() =>
                              previewCompletionSound(soundField.state.value)
                            }
                          />
                        )}
                      </form.Field>
                    </div>
                  )}
                </div>
              )}
            </form.Field>

            {(currentPlatform !== "macos" || configs.show_app_in_dock) && (
              <form.Field name="notification_bounce">
                {(field) => (
                  <SettingSwitchRow
                    title={<Trans>Bounce app icon</Trans>}
                    description={
                      <Trans>
                        Get your attention when a summary is ready in the
                        background.
                      </Trans>
                    }
                    checked={field.state.value}
                    onChange={field.handleChange}
                    disabled={notificationsDisabled}
                  />
                )}
              </form.Field>
            )}

            {supportsMicDetection && (
              <form.Field name="notification_detect">
                {(field) => (
                  <div className="flex flex-col gap-4">
                    <SettingSwitchRow
                      title={<Trans>Microphone detection</Trans>}
                      description={
                        <Trans>Detect meetings from microphone activity.</Trans>
                      }
                      checked={field.state.value}
                      onChange={field.handleChange}
                      disabled={notificationsDisabled}
                    />

                    {field.state.value && !notificationsDisabled && (
                      <div
                        className={cn([
                          "border-muted ml-3 border-l-2 pt-2 pl-4",
                        ])}
                      >
                        <form.Field name="mic_active_threshold">
                          {(thresholdField) => (
                            <div className="mb-4 flex items-center justify-between gap-4">
                              <div className="flex-1">
                                <h4 className="text-sm font-medium">
                                  <Trans>Detection delay</Trans>
                                </h4>
                                <p className="text-muted-foreground text-xs">
                                  <Trans>
                                    Wait before treating microphone activity as
                                    a meeting.
                                  </Trans>
                                </p>
                              </div>
                              <Select
                                value={String(thresholdField.state.value)}
                                onValueChange={(v) =>
                                  thresholdField.handleChange(Number(v))
                                }
                              >
                                <SelectTrigger className="w-[100px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="end">
                                  <SelectItem value="5">5 sec</SelectItem>
                                  <SelectItem value="10">10 sec</SelectItem>
                                  <SelectItem value="15">15 sec</SelectItem>
                                  <SelectItem value="30">30 sec</SelectItem>
                                  <SelectItem value="60">1 min</SelectItem>
                                  <SelectItem value="120">2 min</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </form.Field>

                        <div className="mb-3 flex flex-col gap-1">
                          <h4 className="text-sm font-medium">
                            <Trans>Exclude apps from detection</Trans>
                          </h4>
                          <p className="text-muted-foreground text-xs">
                            <Trans>
                              Prevent selected apps from triggering meeting
                              detection.
                            </Trans>
                          </p>
                        </div>
                        <form.Subscribe selector={(state) => state.values}>
                          {(values) => (
                            <IgnoredAppsSelector
                              installedApps={installedApps}
                              defaultIgnoredBundleIds={defaultIgnoredBundleIds}
                              ignoredPlatforms={values.ignored_platforms}
                              includedPlatforms={values.included_platforms}
                              searchOpen={searchOpen}
                              searchQuery={searchQuery}
                              onSearchOpenChange={setSearchOpen}
                              onSearchQueryChange={setSearchQuery}
                              onToggleApp={handleToggleIgnoredApp}
                            />
                          )}
                        </form.Subscribe>
                      </div>
                    )}
                  </div>
                )}
              </form.Field>
            )}

            {supportsDoNotDisturb && (
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-4 pt-4 pb-2">
                  <div className="border-muted min-w-0 flex-1 border-t" />
                  <span className="text-muted-foreground shrink-0 text-xs font-medium">
                    <Trans>For enabled notifications</Trans>
                  </span>
                  <div className="border-muted min-w-0 flex-1 border-t" />
                </div>

                <form.Subscribe
                  selector={(state) =>
                    !state.values.notification_disabled &&
                    (state.values.notification_event ||
                      state.values.notification_detect)
                  }
                >
                  {(anyNotificationEnabled) => (
                    <form.Field name="respect_dnd">
                      {(field) => (
                        <SettingSwitchRow
                          title={<Trans>Respect Do-Not-Disturb mode</Trans>}
                          description={
                            <Trans>
                              Pause alerts while Do Not Disturb is on.
                            </Trans>
                          }
                          checked={field.state.value}
                          onChange={field.handleChange}
                          disabled={!anyNotificationEnabled}
                        />
                      )}
                    </form.Field>
                  )}
                </form.Subscribe>
              </div>
            )}
          </>
        )}
      </form.Subscribe>
    </div>
  );
}
