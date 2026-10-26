import type { defaultSettingsMiddleware } from "ai";

const REASONING_EFFORTS = ["default", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const normalizeReasoningEffort = (value: unknown): ReasoningEffort =>
  REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : "default";

// Le seul provider, OpenAI-compatible, transmet `reasoning_effort` ; un
// serveur qui ne le connaît pas l'ignore.
export const supportsReasoningEffort = (_providerId: string): boolean => true;

type ProviderOptions = NonNullable<
  Parameters<typeof defaultSettingsMiddleware>[0]["settings"]["providerOptions"]
>;

export const reasoningProviderOptions = (
  providerId: string,
  _modelId: string,
  effort: ReasoningEffort,
): ProviderOptions | null => {
  if (effort === "default" || !supportsReasoningEffort(providerId)) {
    return null;
  }

  // @ai-sdk/openai-compatible lit les options sous le nom du provider et
  // envoie `reasoning_effort`.
  return { [providerId]: { reasoningEffort: effort } };
};
