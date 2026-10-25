import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  billingState,
  config,
  getServerForModelMock,
  isModelDownloadedMock,
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
    local_stt_model_path: "",
  },
  getServerForModelMock: vi.fn(),
  isModelDownloadedMock: vi.fn(),
  readiness: {
    provider: true,
    settings: true,
  },
  startServerForPathMock: vi.fn(),
}));

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
    providers: {
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
      "stt:openai": {
        type: "stt",
        base_url: "http://192.168.1.87:8000/v1",
        api_key: "",
      },
    },
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
    config.local_stt_model_path = "";
    billingState.isPaid = true;
    billingState.isReady = true;
    readiness.provider = true;
    readiness.settings = true;
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

  it("waits for an on-device model server to become ready", async () => {
    config.current_stt_provider = "soniqo";
    config.current_stt_model = "soniqo-parakeet-streaming";
    isModelDownloadedMock.mockResolvedValue({ status: "ok", data: true });
    getServerForModelMock.mockResolvedValue({
      status: "ok",
      data: { status: "loading" },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    await waitFor(() => expect(result.current.local.isPending).toBe(false));
    expect(result.current.conn).toBeNull();
    expect(result.current.local.data?.status).toBe("loading");
    expect(result.current.isReady).toBe(false);
  });

  it("starts a selected local model file and exposes its local URL", async () => {
    config.current_stt_provider = "local_file";
    config.current_stt_model = "local-file";
    config.local_stt_model_path = "/models/ggml-small.bin";
    startServerForPathMock.mockResolvedValue({
      status: "ok",
      data: "http://127.0.0.1:4040/v1",
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    await waitFor(() =>
      expect(result.current.conn).toEqual({
        provider: "local_file",
        model: "local-file",
        baseUrl: "http://127.0.0.1:4040/v1",
        apiKey: "",
      }),
    );
    expect(startServerForPathMock).toHaveBeenCalledWith(
      "/models/ggml-small.bin",
    );
  });
});
