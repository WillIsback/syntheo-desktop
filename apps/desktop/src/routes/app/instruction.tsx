import { createFileRoute } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";

import { dismissInstruction } from "@anlg/plugin-windows";

import { InstructionScreen } from "~/instruction";

export const Route = createFileRoute("/app/instruction")({
  validateSearch: (search): { url?: string; integrationId?: string } => ({
    url: (search as { url?: string }).url,
    integrationId: (search as { integrationId?: string }).integrationId,
  }),
  component: InstructionRoute,
});

function useHandleBack() {
  return useCallback(() => dismissInstruction(), []);
}

function InstructionRoute() {
  const { url, integrationId } = Route.useSearch();
  const handleBack = useHandleBack();
  const onBack = useCallback(() => void handleBack(), [handleBack]);
  const onClose = useCallback(
    () => void handleBack().then(() => getCurrentWindow().close()),
    [handleBack],
  );

  return (
    <InstructionScreen
      url={url}
      integrationId={integrationId}
      onBack={onBack}
      onClose={onClose}
    />
  );
}
