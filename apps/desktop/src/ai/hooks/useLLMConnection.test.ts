import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { renderHook } from "@testing-library/react";
import { generateText, streamText } from "ai";
import { afterEach, expect, it, vi } from "vitest";

import { useLanguageModel, useLLMConnection } from "./useLLMConnection";

const mocks = vi.hoisted(() => ({ provider: "custom" as string }));
const managed = vi.hoisted(() => ({ ready: true, disabled: false }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("~/settings/queries", () => ({
  useSettingsReady: () => managed.ready,
}));
vi.mock("~/billing/billing-context", () => ({
  useBillingAccess: () => ({ isPaid: false }),
}));
vi.mock("~/settings/providers", () => ({
  useAiProvider: () => ({
    type: "llm",
    base_url: "http://127.0.0.1:8000/v1",
    api_key: "local-key",
  }),
}));
vi.mock("~/shared/config", () => ({
  useConfigValues: () => ({
    intelligence_disabled: managed.disabled,
    current_llm_provider: mocks.provider,
    current_llm_model: "mtplx",
    current_llm_reasoning_effort: "default",
  }),
}));

afterEach(() => {
  mocks.provider = "custom";
});

it.each([false, true])(
  "generates through Custom with an origin-restricted local server (stream: %s)",
  async (stream) => {
    vi.mocked(tauriFetch).mockImplementation(async (input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("Origin") !== "")
        return new Response(null, { status: 403 });
      if (headers.get("Authorization") !== "Bearer local-key")
        return new Response(null, { status: 401 });
      expect(String(input)).toBe("http://127.0.0.1:8000/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("mtplx");
      if (body.stream) {
        const chunk = {
          id: "local-completion",
          model: "mtplx",
          created: 0,
          choices: [
            {
              index: 0,
              delta: { content: "Local summary" },
              finish_reason: "stop",
            },
          ],
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return Response.json({
        id: "local-completion",
        model: "mtplx",
        created: 0,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Local summary" },
            finish_reason: "stop",
          },
        ],
      });
    });

    const { result, unmount } = renderHook(() => useLanguageModel());
    expect(result.current).not.toBeNull();
    const options = {
      model: result.current!,
      prompt: "Summarize the meeting",
      maxRetries: 0,
    };
    const completion = stream
      ? streamText(options)
      : await generateText(options);
    expect(await completion.text).toBe("Local summary");
    unmount();
  },
);

it.each([
  { ready: true, disabled: true },
  { ready: false, disabled: false },
])(
  "constructs no model before settings load or while intelligence is managed off (%j)",
  (state) => {
    managed.ready = state.ready;
    managed.disabled = state.disabled;
    vi.mocked(tauriFetch).mockClear();
    try {
      const { result, unmount } = renderHook(() => useLanguageModel());
      expect(result.current).toBeNull();
      expect(tauriFetch).not.toHaveBeenCalled();
      unmount();
    } finally {
      managed.ready = true;
      managed.disabled = false;
    }
  },
);

it("llm_connection_without_session", () => {
  // Aucun module d'authentification simulé : le provider custom (endpoint
  // OpenAI-compatible on-premise) donne un modèle utilisable sans session.
  const { result, unmount } = renderHook(() => useLLMConnection());
  expect(result.current.conn).toMatchObject({
    providerId: "custom",
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "local-key",
  });
  expect(result.current.status).toMatchObject({
    status: "success",
    isHosted: false,
  });
  unmount();
});
