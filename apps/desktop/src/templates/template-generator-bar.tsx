import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { Sparkle } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";
import { Input } from "@syntheo/ui/components/ui/input";

import { type GeneratedTemplate, generateTemplate } from "./generator";

import { useLanguageModel, useLLMConnectionStatus } from "~/ai/hooks";

export function TemplateGeneratorBar({
  onGenerated,
}: {
  onGenerated: (template: GeneratedTemplate) => void;
}) {
  const { t } = useLingui();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = useLanguageModel();
  const status = useLLMConnectionStatus();
  const connected = model !== null && status.status === "success";

  const run = async () => {
    if (!model || !input.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onGenerated(await generateTemplate({ model, input }));
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t`Describe the meeting type…`}
          disabled={!connected || busy}
          className="text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          disabled={!connected || busy || !input.trim()}
          onClick={run}
        >
          <Sparkle className="size-3.5" />
          <Trans>Generate with AI</Trans>
        </Button>
      </div>
      {!connected ? (
        <p className="text-muted-foreground text-xs">
          <Trans>Connect a language model to generate a template.</Trans>
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
