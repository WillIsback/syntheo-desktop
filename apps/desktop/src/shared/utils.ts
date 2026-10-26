import { getIdentifier } from "@tauri-apps/api/app";

// export * from "../shared/config/configure-pro-settings";
// export * from "~/sidebar/timeline/utils";
// export * from "~/stt/segment";

export const id = () => crypto.randomUUID() as string;

export type DesktopScheme = "syntheo" | "syntheo-dev";

export const getScheme = async (): Promise<DesktopScheme> => {
  const id = await getIdentifier();
  return id === "fr.willisback.syntheo.dev" ? "syntheo-dev" : "syntheo";
};

// https://www.rfc-editor.org/rfc/rfc4122#section-4.1.7
export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";
