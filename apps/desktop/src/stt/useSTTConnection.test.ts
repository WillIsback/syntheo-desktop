import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  billingState,
  config,
  getServerForModelMock,
  isModelDownloadedMock,
  providersState,
  readiness,
  startServerForPathMock,
} = vi.hoisted(() => ({
  billingState: {
    isPaid: true,
    isReady: true,
  },
  config: {
    current_stt_provider: "anarlog",
    current_stt_model: "cloud",
  },
  getServerForModelMock: vi.fn(),
  isModelDownloadedMock: vi.fn(),
  providersState: {} as Record<string, unknown>,
  readiness: {
    provider: true,
    settings: true,
  },
  startServerForPathMock: vi.fn(),
}));

const storedProviders = () => ({
  "stt:anarlog": {
    type: "stt",
    base_url: "   ",
    api_key: "test-key",
  },
  "stt:nvidia": {
    type: "stt",
    base_url: "http://localhost:9000",
    api_key: "",
  },
  "stt:deepgram": {
    type: "stt",
    base_url: "https://api.deepgram.com/v1",
    api_key: "legacy-key",
  },
  "stt:openai": {
    type: "stt",
    base_url: "http://192.168.1.87:8000/v1",
    api_key: "",
  },
});

vi.mock("@anlg/plugin-local-stt", () => ({
  commands: {
    getServerForModel: getServerForModelMock,
    isModelDownloaded: isModelDownloadedMock,
    startServerForPath: startServerForPathMock,
  },
}));

vi.mock("~/billing/billing-context", () => ({
  useBillingAccess: () => billingState,
}));

vi.mock("~/env", () => ({
  env: { VITE_API_URL: "https://api.anarlog.so" },
}));

vi.mock("~/settings/providers", () => ({
  useAiProvidersState: () => ({
    isReady: readiness.provider,
    providers: providersState,
  }),
}));

vi.mock("~/settings/queries", () => ({
  useSettingsReady: () => readiness.settings,
}));

vi.mock("~/shared/config", () => ({
  useConfigValues: () => config,
}));

vi.mock("~/stt/capabilities", () => ({
  isAnarlogCloudSttModel: (provider: string, model: string) =>
    provider === "anarlog" && model === "cloud",
  isLocalFileSttModel: (provider: string, model: string) =>
    provider === "local_file" && model === "local-file",
  isOnDeviceSttModel: (provider: string, model: string) =>
    provider === "soniqo" && model === "soniqo-parakeet-streaming",
  isRealtimeLocalModel: (model: string) =>
    model === "soniqo-parakeet-streaming",
}));

import { useSTTConnection } from "./useSTTConnection";

describe("useSTTConnection", () => {
  beforeEach(() => {
    config.current_stt_provider = "anarlog";
    config.current_stt_model = "cloud";
    billingState.isPaid = true;
    billingState.isReady = true;
    readiness.provider = true;
    readiness.settings = true;
    for (const key of Object.keys(providersState)) delete providersState[key];
    Object.assign(providersState, storedProviders());
    getServerForModelMock.mockReset();
    isModelDownloadedMock.mockReset();
    startServerForPathMock.mockReset();
  });

  it("stt_connection_without_session", () => {
    // Aucun module d'authentification simulé : la connexion à un endpoint
    // on-premise ne dépend d'aucune session.
    config.current_stt_provider = "nvidia";
    config.current_stt_model = "nemotron-asr-streaming";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    expect(result.current.conn).not.toBeNull();
    expect(result.current.isReady).toBe(true);
  });

  it("never connects to the hosted Anarlog STT (no account)", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    expect(result.current.conn).toBeNull();
    expect(result.current.isReady).toBe(false);
  });

  it("ignores_a_stored_provider_that_no_longer_exists", () => {
    config.current_stt_provider = "deepgram";
    config.current_stt_model = "nova-3";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    expect(result.current.conn).toBeNull();
  });

  it("openai_connection_accepts_empty_key_and_marks_provider", () => {
    config.current_stt_provider = "openai";
    config.current_stt_model = "mistralai/Voxtral-Mini-4B-Realtime-2602";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    expect(result.current.conn).toEqual({
      provider: "openai",
      model: "mistralai/Voxtral-Mini-4B-Realtime-2602",
      baseUrl: "http://192.168.1.87:8000/v1?provider=openai",
      apiKey: "",
    });
  });

  it("routes an unauthenticated NVIDIA NIM endpoint to its native adapter", () => {
    config.current_stt_provider = "nvidia";
    config.current_stt_model = "nemotron-asr-streaming";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useSTTConnection(), { wrapper });
    expect(result.current.conn).toEqual({
      provider: "nvidia",
      model: "nemotron-asr-streaming",
      baseUrl: "http://localhost:9000/?provider=nvidia",
      apiKey: "",
    });
    expect(result.current.isReady).toBe(true);
  });

  it("applies_the_nvidia_preset_without_a_stored_config_row", () => {
    // Un provider on-prem préréglé doit fonctionner sans qu'une ligne
    // stt:nvidia ait été enregistrée : l'URL par défaut fait office de
    // configuration.
    delete providersState["stt:nvidia"];
    config.current_stt_provider = "nvidia";
    config.current_stt_model = "nemotron-asr-streaming";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    expect(result.current.conn).toEqual({
      provider: "nvidia",
      model: "nemotron-asr-streaming",
      baseUrl:
        "https://spark-787d-1.tail6cba9f.ts.net/v1/realtime?provider=nvidia",
      apiKey: "",
    });
    expect(result.current.isReady).toBe(true);
  });

  it("waits for stored settings and secure provider configuration", () => {
    config.current_stt_provider = "openai";
    config.current_stt_model = "whisper-large-v3";
    readiness.provider = false;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const providerPending = renderHook(() => useSTTConnection(), { wrapper });

    expect(providerPending.result.current.isReady).toBe(false);

    providerPending.unmount();
    readiness.provider = true;
    readiness.settings = false;
    const settingsPending = renderHook(() => useSTTConnection(), { wrapper });

    expect(settingsPending.result.current.isReady).toBe(false);
  });
});
