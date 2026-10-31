import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: {
    providerId: "openai",
    baseUrl: "https://spark.tail6cba9f.ts.net/v1/realtime",
    apiKey: "",
    state: { status: "untested" } as Record<string, unknown>,
    test: vi.fn(),
  },
  config: {
    current_stt_provider: "openai",
    current_stt_model: "voxtral-mini",
  } as Record<string, string>,
  setSelection: vi.fn(),
  setAiProvider: vi.fn(),
}));

vi.mock("~/settings/ai/shared/server-connection", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useServerConnection: () => mocks.connection,
}));
vi.mock("~/settings/ai/shared/server-address", () => ({
  ServerAddressForm: ({ onTest }: { onTest: () => void }) => (
    <button type="button" onClick={onTest}>
      Test connection
    </button>
  ),
}));
vi.mock("~/settings/ai/shared/persist-selection", () => ({
  PersistAiSelection: () => null,
}));
vi.mock("~/settings/providers", () => ({
  setAiProvider: mocks.setAiProvider,
}));
vi.mock("~/settings/queries", () => ({
  useSetSettingValues: () => mocks.setSelection,
}));
vi.mock("~/shared/config", () => ({
  useConfigValues: () => mocks.config,
}));

import { SttServerCard } from "./server-card";

function setup() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SttServerCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.providerId = "openai";
  mocks.connection.state = { status: "untested" };
  mocks.config = {
    current_stt_provider: "openai",
    current_stt_model: "voxtral-mini",
  };
  mocks.setAiProvider.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("SttServerCard", () => {
  it("dit quoi faire quand le serveur est injoignable", () => {
    mocks.connection.state = {
      status: "failed",
      failure: { ok: false, reason: "unreachable" },
    };
    setup();

    expect(screen.getByRole("status").textContent).toBe("Unreachable");
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("spark.tail6cba9f.ts.net/v1/realtime");
    expect(alert).toContain("(VPN, Tailscale), then test again.");
  });

  it("affiche la latence et les modèles annoncés, choisis d'un clic", () => {
    mocks.connection.state = {
      status: "connected",
      latencyMs: 84,
      protocol: "openai",
      models: ["voxtral-mini", "whisper-large-v3"],
    };
    setup();

    expect(screen.getByRole("status").textContent).toBe("Connected · 84 ms");
    expect(screen.getByText(/detected automatically/)).toBeTruthy();
    const current = screen.getByRole("radio", { name: /voxtral-mini/ });
    expect(current.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /whisper-large-v3/ }));
    expect(mocks.setSelection).toHaveBeenCalledWith({
      current_stt_provider: "openai",
      current_stt_model: "whisper-large-v3",
    });
  });

  it("propose les modèles connus du NIM", () => {
    mocks.connection.providerId = "nvidia";
    mocks.config = {
      current_stt_provider: "nvidia",
      current_stt_model: "parakeet-tdt-0.6b-v3",
    };
    setup();

    expect(
      screen
        .getByRole("radio", { name: /parakeet-tdt-0\.6b-v3/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: /nemotron-asr-streaming/ }),
    ).toBeTruthy();
    expect(
      screen.getByText(/NIM does not publish its model list/),
    ).toBeTruthy();
  });

  it("change de protocole avec le modèle par défaut du protocole", () => {
    setup();

    fireEvent.click(
      screen.getByRole("radio", { name: "NVIDIA NIM · WebSocket" }),
    );

    expect(mocks.setSelection).toHaveBeenCalledWith({
      current_stt_provider: "nvidia",
      current_stt_model: "nemotron-asr-streaming",
    });
  });

  it("reprend l'adresse quand le test détecte un autre protocole", async () => {
    mocks.connection.state = {
      status: "connected",
      latencyMs: 12,
      protocol: "nvidia",
      models: [],
    };
    setup();

    expect(
      screen.getByText(/This server answers as NVIDIA NIM · WebSocket\./),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this protocol" }));

    await waitFor(() =>
      expect(mocks.setSelection).toHaveBeenCalledWith({
        current_stt_provider: "nvidia",
        current_stt_model: "nemotron-asr-streaming",
      }),
    );
    expect(mocks.setAiProvider).toHaveBeenCalledWith("stt", "nvidia", {
      base_url: "https://spark.tail6cba9f.ts.net/v1/realtime",
      api_key: "",
    });
  });

  it("relance le test à la demande", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(mocks.connection.test).toHaveBeenCalled();
  });
});
