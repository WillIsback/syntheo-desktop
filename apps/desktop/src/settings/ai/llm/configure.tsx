import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { Accordion } from "@anlg/ui/components/ui/accordion";

import { useLlmSettings } from "./context";
import { ProviderId, PROVIDERS } from "./shared";

import {
  filterProviders,
  NonAnarlogProviderCard,
  ProviderSearch,
  StyledStreamdown,
} from "~/settings/ai/shared";
import { useConfigValue } from "~/shared/config";

export function ConfigureProviders() {
  const { accordionValue, setAccordionValue } = useLlmSettings();
  const currentProvider = useConfigValue("current_llm_provider");
  const [search, setSearch] = useState("");
  const providers = filterProviders(PROVIDERS, search);

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
        {providers.map((provider) => {
          return (
            <NonAnarlogProviderCard
              key={provider.id}
              config={provider}
              providerType="llm"
              providers={PROVIDERS}
              providerContext={
                <ProviderContext providerId={provider.id as ProviderId} />
              }
              currentProvider={currentProvider}
            />
          );
        })}
      </Accordion>
      {providers.length === 0 && search.trim() ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          <Trans>No providers found.</Trans>
        </p>
      ) : null}
    </div>
  );
}

function ProviderContext({ providerId }: { providerId: ProviderId }) {
  const content =
    providerId === "custom"
      ? "Seuls les serveurs **OpenAI-compatibles** on-premise sont pris en charge (vLLM, Ollama, llama.cpp server, LM Studio…)."
      : "";

  if (!content) {
    return null;
  }

  return <StyledStreamdown>{content}</StyledStreamdown>;
}
