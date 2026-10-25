import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";

import { SETTING_CONTROL_CLASS, SettingRow } from "~/settings/setting-row";

// Ni rétention audio ni empreintes vocales : Syntheo ne conserve jamais l'audio.
export function AudioSettingsView({
  microphoneDevice,
}: {
  microphoneDevice: {
    value: string;
    devices: string[];
    onChange: (value: string) => void;
  };
}) {
  return (
    <div className="flex flex-col gap-4">
      <AudioDeviceRow
        title={<Trans>Microphone</Trans>}
        description={
          <Trans>Choose the microphone that captures your voice.</Trans>
        }
        value={microphoneDevice.value}
        devices={microphoneDevice.devices}
        onChange={microphoneDevice.onChange}
      />
    </div>
  );
}

const SYSTEM_DEFAULT_DEVICE = "__system_default_device__";

export function AudioDeviceRow({
  title,
  description,
  value,
  devices,
  onChange,
}: {
  title: ReactNode;
  description: ReactNode;
  value: string;
  devices: string[];
  onChange: (value: string) => void;
}) {
  const availableDevices = [...new Set(devices)].sort((a, b) =>
    a.localeCompare(b),
  );
  const selectedDeviceUnavailable =
    Boolean(value) && !availableDevices.includes(value);
  if (selectedDeviceUnavailable) {
    availableDevices.unshift(value);
  }

  return (
    <SettingRow title={title} description={description}>
      {(labelProps) => (
        <Select
          value={value || SYSTEM_DEFAULT_DEVICE}
          onValueChange={(device) =>
            onChange(device === SYSTEM_DEFAULT_DEVICE ? "" : device)
          }
        >
          <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value={SYSTEM_DEFAULT_DEVICE}>
              <Trans>Current default</Trans>
            </SelectItem>
            {availableDevices.map((device) => (
              <SelectItem key={device} value={device}>
                {device}
                {selectedDeviceUnavailable && device === value ? (
                  <>
                    {" "}
                    <Trans>(Unavailable — using current default)</Trans>
                  </>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  );
}
