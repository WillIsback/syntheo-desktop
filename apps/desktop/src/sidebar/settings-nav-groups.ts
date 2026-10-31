import { useLingui } from "@lingui/react/macro";

import {
  Bell,
  BookOpen,
  CalendarDots,
  Code,
  DownloadSimple,
  FileText,
  FolderSimple,
  Lightning,
  type Icon,
  Lock,
  Microphone,
  ShieldCheck,
  Sparkle,
  Sun,
  User,
  Users,
  VideoCamera,
  Waveform,
} from "@syntheo/ui/components/icons";

import { privacyMessages } from "~/settings/general/app-settings";
import { type SettingsTab, type TabInput } from "~/store/zustand/tabs";

type SettingsNavItem =
  | {
      id: SettingsTab;
      label: string;
      icon: Icon;
      requiresPro?: boolean;
      // Serveur dont l'état s'affiche en pastille à droite de l'entrée.
      server?: "stt" | "llm";
    }
  | {
      id: "automations" | "calendar" | "contacts" | "folders" | "templates";
      label: string;
      icon: Icon;
      destination: TabInput;
      requiresPro?: boolean;
      server?: undefined;
    };

export type SettingsNavGroup = {
  label: string;
  items: SettingsNavItem[];
  // Replié par défaut : réglages rares, gardés accessibles hors des quatre
  // groupes de la maquette.
  collapsed?: boolean;
};

export function useSettingsNavGroups(): SettingsNavGroup[] {
  const { i18n, t } = useLingui();

  return [
    {
      label: t`Me`,
      items: [
        { id: "app", label: t`Profile`, icon: User },
        { id: "appearance", label: t`Appearance`, icon: Sun },
        { id: "notifications", label: t`Notifications`, icon: Bell },
      ],
    },
    {
      label: t`My servers`,
      items: [
        {
          id: "transcription",
          label: t`Transcription`,
          icon: Waveform,
          server: "stt",
        },
        {
          id: "intelligence",
          label: t`Synthesis`,
          icon: Sparkle,
          server: "llm",
        },
      ],
    },
    {
      label: t`Writing`,
      items: [
        {
          id: "dictation",
          label: t`Dictation`,
          icon: Microphone,
          requiresPro: true,
        },
        {
          id: "dictionary",
          label: t`Dictionary`,
          icon: BookOpen,
          requiresPro: true,
        },
      ],
    },
    {
      label: t`My meetings`,
      items: [
        {
          id: "templates",
          label: t`Templates`,
          icon: FileText,
          destination: { type: "templates" },
        },
        { id: "meetings", label: t`Meetings`, icon: VideoCamera },
        {
          id: "calendar",
          label: t`Calendar`,
          icon: CalendarDots,
          destination: { type: "calendar" },
        },
        {
          id: "folders",
          label: t`Folders`,
          icon: FolderSimple,
          destination: { type: "folders" },
        },
        {
          id: "contacts",
          label: t`Contacts`,
          icon: Users,
          destination: { type: "contacts" },
        },
      ],
    },
    {
      label: t`Advanced`,
      collapsed: true,
      items: [
        {
          id: "privacy",
          label: i18n._(privacyMessages.title),
          icon: ShieldCheck,
        },
        { id: "permissions", label: t`Permissions`, icon: Lock },
        { id: "imports", label: t`Imports`, icon: DownloadSimple },
        {
          id: "automations",
          label: t`Automations`,
          icon: Lightning,
          destination: { type: "automations" },
          requiresPro: true,
        },
        { id: "developers", label: t`Developers`, icon: Code },
      ],
    },
  ];
}
