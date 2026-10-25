import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { open as selectFiles } from "@tauri-apps/plugin-dialog";
import { type ReactNode, useEffect } from "react";

import { commands as importerCommands } from "@anlg/plugin-importer";
import {
  CaretDown,
  CircleNotch,
  DownloadSimple,
} from "@anlg/ui/components/icons";
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTriggerPrimitive,
  AccordionContent,
} from "@anlg/ui/components/ui/accordion";
import { Button } from "@anlg/ui/components/ui/button";
import { cn } from "@anlg/utils";

import { detectImportSources } from "./detection";
import { providerIconOpticalClass, providerIconSrc } from "./icons";
import type {
  DetectedMeetingImportProvider,
  MeetingImportProvider,
} from "./providers";
import {
  EMPTY_MEETING_IMPORT_HISTORY,
  importMeetingFiles,
  useMeetingImportHistory,
} from "./queries";

const IMPORT_EXTENSIONS = [
  "csv",
  "json",
  "md",
  "markdown",
  "srt",
  "txt",
  "vtt",
];

function ProviderIcon({
  provider,
}: {
  provider: DetectedMeetingImportProvider;
}) {
  const src = providerIconSrc(provider);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn([
          "size-8 object-contain object-center",
          providerIconOpticalClass(provider),
        ])}
      />
    );
  }

  return (
    <span
      className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg text-xs font-semibold"
      aria-hidden="true"
    >
      {provider.name.charAt(0)}
    </span>
  );
}

// Imports de fichiers locaux uniquement : les connexions directes aux services
// de réunion (OAuth, MCP) sont des intégrations cloud, retirées de Syntheo.
export function MeetingImportScreen({
  compact = false,
  onContinue,
  onNoSourcesDetected,
  secondaryAction,
}: {
  compact?: boolean;
  onContinue?: () => void;
  onNoSourcesDetected?: () => void;
  secondaryAction?: ReactNode;
}) {
  const { t } = useLingui();
  const detectionQuery = useQuery({
    queryKey: ["meeting-import-sources"],
    queryFn: detectImportSources,
    refetchOnMount: "always",
  });
  const historyQuery = useMeetingImportHistory();
  const history = historyQuery.data ?? EMPTY_MEETING_IMPORT_HISTORY;
  const fileProviders = (detectionQuery.data ?? [])
    .filter((provider) => !provider.directImport)
    .sort((left, right) => left.name.localeCompare(right.name));
  const detectionSettled = !detectionQuery.isLoading && !detectionQuery.error;

  useEffect(() => {
    if (
      detectionQuery.isFetching ||
      detectionQuery.error ||
      detectionQuery.data?.length !== 0
    ) {
      return;
    }

    onNoSourcesDetected?.();
  }, [
    detectionQuery.data,
    detectionQuery.error,
    detectionQuery.isFetching,
    onNoSourcesDetected,
  ]);

  const fileImportMutation = useMutation({
    mutationFn: async (provider: MeetingImportProvider) => {
      const selection = await selectFiles({
        title: t`Choose ${provider.name} export files`,
        multiple: true,
        directory: false,
        filters: [
          {
            name: t`Meeting exports`,
            extensions: IMPORT_EXTENSIONS,
          },
        ],
      });
      const paths = Array.isArray(selection)
        ? selection
        : selection
          ? [selection]
          : [];
      if (paths.length === 0) return null;

      const filesResult = await importerCommands.readTextFiles(paths);
      if (filesResult.status === "error") throw new Error(filesResult.error);
      const result = await importMeetingFiles(provider.id, filesResult.data);
      return { ...result, completedAt: Date.now() };
    },
  });

  const latestResult = fileImportMutation.data ?? null;

  return (
    <div className={cn(["flex flex-col gap-4", compact && "max-w-3xl"])}>
      {detectionQuery.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <CircleNotch className="size-3.5 animate-spin" />
          <Trans>Checking installed meeting assistants…</Trans>
        </p>
      ) : detectionQuery.error ? (
        <p className="text-destructive text-xs">
          {detectionQuery.error.message}
        </p>
      ) : null}

      {fileProviders.length > 0 || detectionSettled ? (
        <div className="border-border bg-card overflow-hidden rounded-2xl border">
          <Accordion
            type="multiple"
            className={cn([
              "divide-border divide-y",
              compact && "max-h-80 overflow-y-auto",
            ])}
          >
            {fileProviders.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                <Trans>No apps found.</Trans>
              </p>
            ) : (
              fileProviders.map((provider) => {
                const importing =
                  fileImportMutation.isPending &&
                  fileImportMutation.variables.id === provider.id;
                const lastRun = history.find(
                  (run) => run.providerId === provider.id,
                );
                const result =
                  fileImportMutation.variables?.id === provider.id
                    ? fileImportMutation.data
                    : null;
                const error =
                  fileImportMutation.variables?.id === provider.id
                    ? fileImportMutation.error
                    : null;

                return (
                  <AccordionItem
                    key={provider.id}
                    value={provider.id}
                    role="group"
                    aria-label={provider.name}
                    className="border-0"
                  >
                    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
                      <AccordionHeader className="min-w-0 flex-1">
                        <AccordionTriggerPrimitive className="group focus-visible:outline-ring flex w-full items-center gap-3 text-left">
                          <span className="flex size-8 shrink-0 items-center justify-center">
                            <ProviderIcon provider={provider} />
                          </span>
                          <span className="truncate text-sm font-medium">
                            {provider.name}
                          </span>
                          <CaretDown className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                        </AccordionTriggerPrimitive>
                      </AccordionHeader>
                      <Button
                        type="button"
                        size="sm"
                        className="w-40 shrink-0"
                        variant="outline"
                        disabled={fileImportMutation.isPending}
                        onClick={() => fileImportMutation.mutate(provider)}
                      >
                        {importing ? (
                          <CircleNotch className="size-3.5 animate-spin" />
                        ) : (
                          <DownloadSimple className="size-3.5" />
                        )}
                        <Trans>Choose files</Trans>
                      </Button>
                    </div>
                    <AccordionContent className="px-4 pb-4 pl-15">
                      {lastRun && !result ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          <Trans>
                            Last import: {lastRun.imported} added,{" "}
                            {lastRun.matched} unchanged
                          </Trans>
                        </p>
                      ) : null}
                      {!result && !lastRun && !error ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          <Trans>No imports yet.</Trans>
                        </p>
                      ) : null}
                      {result ? (
                        <p
                          className="text-muted-foreground mt-1 text-xs"
                          role="status"
                        >
                          {result.errors > 0 || result.conflicts > 0 ? (
                            <Trans>
                              Imported: {result.imported}. Unchanged:{" "}
                              {result.matched}. Needs review: {result.conflicts}
                              . Failed: {result.errors}.
                            </Trans>
                          ) : (
                            <Trans>
                              Last import: {result.imported} added,{" "}
                              {result.matched} unchanged
                            </Trans>
                          )}
                        </p>
                      ) : null}
                      {error ? (
                        <p
                          className="text-destructive mt-1 text-xs"
                          role="alert"
                        >
                          {error.message}
                        </p>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                );
              })
            )}
          </Accordion>
        </div>
      ) : null}

      {secondaryAction || (onContinue && latestResult) ? (
        <div className="flex items-center gap-3">
          {onContinue && latestResult ? (
            <Button
              type="button"
              className="w-fit rounded-full"
              onClick={onContinue}
            >
              <Trans>Continue</Trans>
            </Button>
          ) : null}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
