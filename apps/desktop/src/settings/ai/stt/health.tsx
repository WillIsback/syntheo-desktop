import { usesDeferredProviderAuthentication } from "@syntheo/provider-validation";

import { useConfigValues } from "~/shared/config";
import { useSTTConnection } from "~/stt/useSTTConnection";

export type HealthStatus = {
  status: "pending" | "error" | "success" | null;
  message?: string;
};

export function useConnectionHealth(): HealthStatus {
  const { conn } = useSTTConnection();
  const { current_stt_provider } = useConfigValues([
    "current_stt_provider",
  ] as const);

  if (!conn) {
    return { status: "error", message: "Provider not configured." };
  }

  if (usesDeferredProviderAuthentication("stt", current_stt_provider ?? "")) {
    return {
      status: null,
      message: "Credentials will be checked when transcription starts.",
    };
  }
  return { status: "success" };
}
