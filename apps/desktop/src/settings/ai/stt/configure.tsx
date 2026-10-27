import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { Accordion } from "@syntheo/ui/components/ui/accordion";

import { useSttSettings } from "./context";
import { ProviderId, PROVIDERS } from "./shared";

import {
  filterProviders,
  NonSyntheoProviderCard,
  ProviderSearch,
  StyledStreamdown,
} from "~/settings/ai/shared";
import { useConfigValue } from "~/shared/config";

export function ConfigureProviders() {
  const { accordionValue, setAccordionValue } = useSttSettings();
  const currentProvider = useConfigValue("current_stt_provider");
  const [search, setSearch] = useState("");
  const providers = filterProviders(
    PROVIDERS.filter((provider) => !("builtIn" in provider)),
    search,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h3 className="text-md font-sans font-semibold">
          <Trans>Configure Providers</Trans>
        </h3>
        <ProviderSearch value={search} onChange={setSearch} />
      </div>
      <Accordion
        type="single"
        collapsible
        className="flex flex-col gap-3"
        value={accordionValue}
        onValueChange={setAccordionValue}
      >
        {providers.map((provider) => (
          <NonSyntheoProviderCard
            key={provider.id}
            config={provider}
            providerType="stt"
            providers={PROVIDERS}
            providerContext={<ProviderContext providerId={provider.id} />}
            currentProvider={currentProvider}
          />
        ))}
      </Accordion>
      {providers.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          <Trans>No providers found.</Trans>
        </p>
      ) : null}
    </div>
  );
}

function ProviderContext({ providerId }: { providerId: ProviderId }) {
  const content =
    providerId === "nvidia"
      ? "Connect to your [NVIDIA Speech NIM](https://docs.nvidia.com/nim/speech/latest/get-started/tutorials/asr.html) WebSocket server, for example `http://localhost:9000`. NIM does not list its models, so enter the model served by your deployment — usually `nemotron-asr-streaming` (Nemotron ASR Streaming, English), `parakeet-tdt-0.6b-v3` (multilingual) or `parakeet-tdt-0.6b-v2` (English). The API key is optional for servers without authentication. This requires a deployed NIM server; NVIDIA's hosted gRPC endpoint is not supported here."
      : providerId === "openai"
        ? "Connect to a server that speaks the OpenAI speech protocol, such as [vLLM](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html), speaches or faster-whisper-server, for example `http://localhost:8000/v1`. Live transcription uses `/v1/realtime`; imported files use `/v1/audio/transcriptions`. Enter the model name served by your deployment. The API key is optional for servers without authentication."
        : "";

  if (!content.trim()) {
    return null;
  }

  return <StyledStreamdown className="mb-2">{content.trim()}</StyledStreamdown>;
}
