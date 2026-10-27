import { usesDeferredProviderAuthentication } from "@syntheo/provider-validation";
import { Spinner } from "@syntheo/ui/components/ui/spinner";

import { useConfigValues } from "~/shared/config";
import { useSTTConnection } from "~/stt/useSTTConnection";

export type HealthStatus = {
  status: "pending" | "error" | "success" | null;
  message?: string;
};

export function HealthStatusIndicator() {
  const health = useConnectionHealth();

  if (health.status === "pending") {
    return <Spinner size={14} className="text-muted-foreground shrink-0" />;
  }

  return null;
}

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
