import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { Sparkle } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";

import { type GeneratedTemplate, generateTemplate } from "./generator";

import { useLanguageModel, useLLMConnectionStatus } from "~/ai/hooks";

/**
 * « Proposer des sections » : demande un premier jet au serveur de synthèse
 * local configuré par l'utilisateur (aucun service distant).
 *
 * `context` (nom et description du modèle) sert de description quand le champ
 * est laissé vide.
 */
export function TemplateGeneratorBar({
  context = "",
  onGenerated,
}: {
  context?: string;
  onGenerated: (template: GeneratedTemplate) => void;
}) {
  const { t } = useLingui();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const model = useLanguageModel();
  const status = useLLMConnectionStatus();
  const connected = model !== null && status.status === "success";
  const description = input.trim() || context.trim();

  const run = async () => {
    if (!model || !description) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      onGenerated(await generateTemplate({ model, input: description }));
      setInput("");
    } catch (cause) {
      console.error("[templates] section proposal failed", cause);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-border bg-card focus-within:ring-ring/50 flex items-center gap-2 rounded-xl border py-1.5 pr-1.5 pl-3.5 focus-within:ring-2">
        <Sparkle aria-hidden="true" className="text-primary size-4 shrink-0" />
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void run();
            }
          }}
          aria-label={t`Describe the meeting`}
          placeholder={t`Describe the meeting, Syntheo suggests the sections…`}
          disabled={!connected || busy}
          className="placeholder:text-faint min-w-0 flex-1 border-0 bg-transparent text-sm outline-hidden"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 rounded-lg px-3 text-sm"
          disabled={!connected || busy || !description}
          aria-busy={busy}
          onClick={() => void run()}
        >
          {busy ? <Trans>Suggesting…</Trans> : <Trans>Suggest sections</Trans>}
        </Button>
      </div>
      {!connected ? (
        <p className="text-muted-foreground text-xs">
          <Trans>
            Configure your summary server in Settings to get section
            suggestions.
          </Trans>
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-destructive text-xs">
          <Trans>
            The summary server did not respond. Check that it is running, then
            try again.
          </Trans>
        </p>
      ) : null}
    </div>
  );
}
