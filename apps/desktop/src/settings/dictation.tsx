import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { platform } from "@tauri-apps/plugin-os";
import { useShallow } from "zustand/react/shallow";

import { commands as transcription } from "@syntheo/plugin-transcription";
import { Microphone } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";
import { Textarea } from "@syntheo/ui/components/ui/textarea";

import { DictationShortcut } from "./dictation-shortcut";

import { useBillingAccess } from "~/billing/billing-context";
import { useDictationStatus } from "~/dictation/state";
import { AudioDeviceRow } from "~/settings/general/audio-settings";
import { SettingsPageTitle } from "~/settings/page-title";
import { PlanGate } from "~/settings/plan-gate";
import { useSetSettingValue } from "~/settings/queries";
import {
  SettingRow,
  SettingRows,
  SettingSwitchRow,
} from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";
import { type SettingsTab, useTabs } from "~/store/zustand/tabs";

const LINK_CLASS = "text-primary underline underline-offset-[3px]";

export function SettingsDictation() {
  const { t } = useLingui();
  const { isPro } = useBillingAccess();
  const enabled = useConfigValue("dictation_enabled");
  const shortcut = useConfigValue("dictation_shortcut");
  const handsFree = useConfigValue("dictation_hands_free");
  const livePreview = useConfigValue("dictation_live_preview");
  const setLivePreview = useSetSettingValue("dictation_live_preview");
  const setEnabled = useSetSettingValue("dictation_enabled");
  const setHandsFree = useSetSettingValue("dictation_hands_free");
  const microphone = useConfigValue("microphone_device");
  const setMicrophone = useSetSettingValue("microphone_device");
  const microphones = useQuery({
    queryKey: ["microphone-devices"],
    queryFn: async () => {
      const result = await transcription.listMicrophoneDevices();
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
    enabled: isPro,
    refetchInterval: 3_000,
  });
  const status = useDictationStatus(
    useShallow((state) => ({
      phase: state.phase,
      error: state.error,
      ready: state.ready,
      retry: state.retry,
      cancel: state.cancel,
      lastTranscript: state.lastTranscript,
    })),
  );
  const openNew = useTabs((state) => state.openNew);
  const open = (tab: SettingsTab) =>
    openNew({ type: "settings", state: { tab } });
  const copy = useMutation({
    mutationFn: (transcript: string) => writeText(transcript),
  });
  const linux = platform() === "linux";

  return (
    <div className="flex flex-col gap-[26px]">
      <SettingsPageTitle
        title={<Trans>Dictation</Trans>}
        lede={
          <Trans>
            Speak into any text field, in any app. The text is inserted when you
            finish.
          </Trans>
        }
      />
      <PlanGate plan="pro" allowed={isPro}>
        <div className="flex flex-col gap-[26px]">
          <SettingRows>
            <SettingSwitchRow
              title={<Trans>Enable dictation</Trans>}
              description={
                <Trans>
                  Keep Syntheo running to use your shortcut in other apps.
                </Trans>
              }
              checked={enabled}
              onChange={setEnabled}
            />
            <DictationShortcut shortcut={shortcut} />
            <SettingSwitchRow
              title={<Trans>Hands-free dictation</Trans>}
              description={
                handsFree ? (
                  <Trans>
                    Press your shortcut to start, then press it again to finish.
                  </Trans>
                ) : (
                  <Trans>
                    Hold your shortcut while speaking, then release it to
                    finish.
                  </Trans>
                )
              }
              checked={handsFree}
              onChange={setHandsFree}
            />
            <AudioDeviceRow
              title={<Trans>Microphone</Trans>}
              description={
                <>
                  <Trans>The one that captures your voice.</Trans>{" "}
                  <button
                    type="button"
                    className={LINK_CLASS}
                    onClick={() => open("permissions")}
                  >
                    <Trans>System permissions</Trans>
                  </button>
                </>
              }
              value={microphone}
              devices={microphones.data ?? []}
              onChange={setMicrophone}
            />
            <SettingSwitchRow
              title={<Trans>Live transcript preview</Trans>}
              description={
                <Trans>
                  Words appear in a small bubble while you speak. Text is
                  inserted when you finish.
                </Trans>
              }
              checked={livePreview}
              onChange={setLivePreview}
            />
            <SettingRow
              controlWidth="content"
              title={<Trans>Language and vocabulary</Trans>}
              description={
                <>
                  <Trans>Words specific to you go in your</Trans>{" "}
                  <button
                    type="button"
                    className={LINK_CLASS}
                    onClick={() => open("dictionary")}
                  >
                    <Trans>dictionary</Trans>
                  </button>
                </>
              }
            >
              {() => (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => open("transcription")}
                >
                  <Trans>Transcription server ›</Trans>
                </Button>
              )}
            </SettingRow>
          </SettingRows>

          {linux ? (
            <details data-testid="dictation-linux-help">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
                <Trans>On Linux (Wayland or X11)</Trans>
              </summary>
              <p className="text-muted-foreground mt-2.5 text-sm">
                <Trans>
                  On Wayland, approve the shortcuts in your desktop's prompt.
                  Use Control + Alt + Escape to cancel. On X11, press Escape to
                  cancel. The target app must expose an editable accessibility
                  field.
                </Trans>
              </p>
            </details>
          ) : (
            <p className="text-muted-foreground text-[13px]">
              <Trans>
                Press Escape to cancel. Dictation stops after five minutes and
                pauses while Syntheo records a meeting.
              </Trans>
            </p>
          )}

          {enabled && (
            <div
              className="border-border rounded-[10px] border p-4"
              role="status"
            >
              <p className="text-sm">
                {status.phase === "recording"
                  ? t`Listening…`
                  : status.phase === "transcribing"
                    ? t`Transcribing…`
                    : status.phase === "starting"
                      ? t`Starting microphone…`
                      : status.ready
                        ? t`Ready to dictate`
                        : t`Setting up dictation…`}
              </p>
              {status.error && (
                <p className="text-destructive mt-2 text-sm" role="alert">
                  {status.error}
                </p>
              )}
              {status.error && (
                <Button
                  className="mt-2"
                  variant="outline"
                  onClick={() =>
                    useDictationStatus.setState({ retry: status.retry + 1 })
                  }
                >
                  <Trans>Retry setup</Trans>
                </Button>
              )}
              {status.phase !== "idle" && (
                <Button
                  className="mt-2"
                  variant="outline"
                  onClick={() => status.cancel?.()}
                >
                  <Trans>Cancel dictation</Trans>
                </Button>
              )}
            </div>
          )}

          <section className="flex flex-col gap-3">
            <h3 className="text-faint text-[11px] font-semibold tracking-[0.08em] uppercase">
              <Trans>Try it</Trans>
            </h3>
            <label className="border-input text-muted-foreground flex items-start gap-2.5 rounded-[10px] border border-dashed p-3.5 text-sm">
              <Microphone aria-hidden className="mt-1 size-[18px] shrink-0" />
              <Textarea
                aria-label={t`Try dictation`}
                placeholder={t`Click here, then use your dictation shortcut.`}
                className="text-foreground min-h-16 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </label>
            <p className="text-muted-foreground text-[13px]">
              <Trans>
                Dictation uses your microphone, transcription provider,
                languages, and dictionary. Audio is never written to disk; it
                only passes through memory. Your last transcript stays in memory
                until dictation is disabled or Syntheo closes.
              </Trans>
            </p>
          </section>

          {status.lastTranscript && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                <Trans>Last dictation</Trans>
              </h3>
              <p className="border-border rounded-[10px] border p-4 text-sm whitespace-pre-wrap">
                {status.lastTranscript}
              </p>
              <Button
                className="self-start"
                variant="outline"
                disabled={copy.isPending}
                onClick={() => copy.mutate(status.lastTranscript)}
              >
                {copy.isSuccess && copy.variables === status.lastTranscript ? (
                  <Trans>Copied</Trans>
                ) : (
                  <Trans>Copy last dictation</Trans>
                )}
              </Button>
              {copy.isError && (
                <p role="alert" className="text-destructive text-sm">
                  <Trans>
                    Could not copy the transcript. Select the text above to copy
                    it.
                  </Trans>
                </p>
              )}
            </div>
          )}
        </div>
      </PlanGate>
    </div>
  );
}
