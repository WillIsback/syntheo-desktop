import { createFileRoute } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";

import { dismissInstruction } from "@syntheo/plugin-windows";

import { InstructionScreen } from "~/instruction";

export const Route = createFileRoute("/app/instruction")({
  validateSearch: (search): { url?: string } => ({
    url: (search as { url?: string }).url,
  }),
  component: InstructionRoute,
});

function useHandleBack() {
  return useCallback(() => dismissInstruction(), []);
}

function InstructionRoute() {
  const { url } = Route.useSearch();
  const handleBack = useHandleBack();
  const onBack = useCallback(() => void handleBack(), [handleBack]);
  const onClose = useCallback(
    () => void handleBack().then(() => getCurrentWindow().close()),
    [handleBack],
  );

  return <InstructionScreen url={url} onBack={onBack} onClose={onClose} />;
}
