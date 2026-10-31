import { describe, expect, test, vi } from "vitest";

import { probeServer } from "./connection-test";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const clock = () => {
  let current = 0;
  return () => (current += 42);
};

const routes =
  (table: Record<string, () => Response | Promise<Response>>) =>
  async (url: string, _init?: RequestInit) => {
    const handler = table[url];
    if (!handler) return new Response(null, { status: 404 });
    return handler();
  };

describe("probeServer", () => {
  test("refuse une adresse invalide sans requête", async () => {
    const fetcher = vi.fn();
    const result = await probeServer(
      { type: "llm", baseUrl: "http://8.8.8.8/v1", apiKey: "" },
      { fetcher, now: clock() },
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("mesure la latence et liste les modèles d'un serveur OpenAI", async () => {
    const fetcher = vi.fn(
      routes({
        "http://localhost:8000/v1/models": () =>
          Response.json({ data: [{ id: "qwen3" }, { id: "mistral-small" }] }),
      }),
    );

    const result = await probeServer(
      { type: "llm", baseUrl: "http://localhost:8000/v1/", apiKey: "secret" },
      { fetcher, now: clock() },
    );

    expect(result).toEqual({
      ok: true,
      latencyMs: 42,
      protocol: "openai",
      models: ["qwen3", "mistral-small"],
    });
    const init = fetcher.mock.calls[0]?.[1] ?? {};
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer secret",
    );
  });

  test("détecte le protocole OpenAI derrière une adresse /realtime", async () => {
    const fetcher = vi.fn(
      routes({
        "https://asr.example.com/v1/models": () =>
          Response.json({ data: [{ id: "voxtral-mini" }] }),
      }),
    );

    const result = await probeServer(
      {
        type: "stt",
        baseUrl: "https://asr.example.com/v1/realtime",
        apiKey: "",
      },
      { fetcher, now: clock() },
    );

    expect(result).toMatchObject({
      ok: true,
      protocol: "openai",
      models: ["voxtral-mini"],
    });
  });

  test("détecte un NIM par sa sonde de disponibilité", async () => {
    const fetcher = vi.fn(
      routes({
        "http://192.168.1.20:9000/v1/health/ready": () =>
          Response.json({ status: "ready" }),
      }),
    );

    const result = await probeServer(
      {
        type: "stt",
        baseUrl: "http://192.168.1.20:9000/v1/realtime",
        apiKey: "",
      },
      { fetcher, now: clock() },
    );

    expect(result).toMatchObject({ ok: true, protocol: "nvidia", models: [] });
  });

  test("signale un serveur injoignable", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("connection refused");
    });

    const result = await probeServer(
      { type: "stt", baseUrl: "http://localhost:9000", apiKey: "" },
      { fetcher, now: clock() },
    );

    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  test("signale une clé refusée", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));

    const result = await probeServer(
      { type: "llm", baseUrl: "http://localhost:8000/v1", apiKey: "bad" },
      { fetcher, now: clock() },
    );

    expect(result).toEqual({ ok: false, reason: "unauthorized", status: 401 });
  });

  test("distingue une erreur du serveur d'une mauvaise adresse", async () => {
    const failing = vi.fn(async () => new Response(null, { status: 503 }));
    const missing = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      probeServer(
        { type: "llm", baseUrl: "http://localhost:8000/v1", apiKey: "" },
        { fetcher: failing, now: clock() },
      ),
    ).resolves.toEqual({ ok: false, reason: "server_error", status: 503 });
    await expect(
      probeServer(
        { type: "llm", baseUrl: "http://localhost:8000", apiKey: "" },
        { fetcher: missing, now: clock() },
      ),
    ).resolves.toEqual({ ok: false, reason: "not_found", status: 404 });
  });

  test("abandonne au bout du délai", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = probeServer(
      { type: "llm", baseUrl: "http://localhost:8000/v1", apiKey: "" },
      { fetcher, now: clock(), timeoutMs: 1_000 },
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "unreachable",
    });
    vi.useRealTimers();
  });
});
