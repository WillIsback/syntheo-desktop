import { beforeEach, describe, expect, it, vi } from "vitest";

import { TITLE_GENERATION_TIMEOUT_MS, titleWorkflow } from "./title-workflow";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  render: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: mocks.streamText,
}));

vi.mock("@syntheo/plugin-template", () => ({
  commands: { render: mocks.render },
}));

async function collect(stream: AsyncIterable<unknown>) {
  const chunks: unknown[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("titleWorkflow", () => {
  beforeEach(() => {
    mocks.streamText.mockReset();
    mocks.render.mockReset().mockResolvedValue({ status: "ok", data: "" });
    mocks.streamText.mockReturnValue({
      textStream: (async function* () {
        yield "Rachat de Dreamer par Meta";
      })(),
    });
  });

  it("leaves a reasoning model enough output budget to reach the title", async () => {
    await collect(
      titleWorkflow.executeWorkflow({
        model: {} as any,
        args: {
          language: "fr",
          enhancedNote: "# Podcast Tech\n\n- **Titre :** Mythes tech",
          dictionaryTerms: [],
        },
        onProgress: () => {},
        signal: new AbortController().signal,
      }),
    );

    // Le budget compte aussi le raisonnement (`<think>`, extrait par le
    // middleware) : à 128 jetons, un modèle à raisonnement l'épuise avant
    // d'écrire le titre, qui revient vide.
    const [{ maxOutputTokens }] = mocks.streamText.mock.calls[0]!;
    expect(maxOutputTokens).toBeGreaterThanOrEqual(1024);
  });

  it("bounds the whole title task", () => {
    expect(titleWorkflow.maxDurationMs).toBe(TITLE_GENERATION_TIMEOUT_MS);
    expect(TITLE_GENERATION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(TITLE_GENERATION_TIMEOUT_MS).toBeLessThanOrEqual(2 * 60_000);
  });
});
