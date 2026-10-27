import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dismissToast: vi.fn(),
  openNew: vi.fn(),
  updateSettingsTabState: vi.fn(),
  clearDevtoolsPreview: vi.fn(),
  message: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  dismissedToastIds: new Set<string>(),
  sessionMode: "inactive",
  live: {
    status: "inactive" as "inactive" | "active" | "finalizing",
    sessionId: null as string | null,
  },
  currentTab: {
    type: "empty",
  } as {
    type: string;
    id?: string;
    state?: { tab?: string; view?: { type: string } };
  },
  config: {
    current_llm_provider: "local" as string | null,
    current_llm_model: "model" as string | null,
    current_stt_provider: "local" as string | null,
    current_stt_model: "model" as string | null,
  },
  notifications: {
    hasActiveDownload: false,
    downloadingModel: null as string | null,
    activeDownloads: [] as Array<{
      model: string;
      displayName: string;
      progress: number;
      isStarting?: boolean;
    }>,
    localSttStatus: null as null | "loading" | "unreachable",
    isLocalSttModel: false,
  },
}));

vi.mock("@syntheo/ui/components/ui/toast", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@syntheo/ui/components/ui/toast")>();
  return {
    ...actual,
    toast: {
      message: mocks.message,
      error: mocks.error,
      warning: mocks.warning,
      loading: mocks.loading,
      dismiss: mocks.dismiss,
    },
  };
});

vi.mock("~/contexts/notifications", () => ({
  useNotifications: () => mocks.notifications,
}));

vi.mock("~/shared/config", () => ({
  useConfigValues: () => mocks.config,
}));

vi.mock("~/store/zustand/devtools-toast-preview", () => ({
  useDevtoolsToastPreview: (
    selector: (state: { preview: null; clearPreview: () => void }) => unknown,
  ) =>
    selector({
      preview: null,
      clearPreview: mocks.clearDevtoolsPreview,
    }),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (
    selector: (state: {
      currentTab: typeof mocks.currentTab;
      openNew: () => void;
      updateSettingsTabState: () => void;
    }) => unknown,
  ) =>
    selector({
      currentTab: mocks.currentTab,
      openNew: mocks.openNew,
      updateSettingsTabState: mocks.updateSettingsTabState,
    }),
}));

vi.mock("~/stt/capabilities", () => ({
  isConfiguredSttModel: () => true,
  isSyntheoCloudSttModel: () => false,
}));

vi.mock("~/stt/contexts", () => ({
  useListener: (
    selector: (state: {
      getSessionMode: () => string;
      live: typeof mocks.live;
    }) => unknown,
  ) => selector({ getSessionMode: () => mocks.sessionMode, live: mocks.live }),
}));

vi.mock("./useDismissedToasts", () => ({
  useDismissedToasts: () => ({
    dismissToast: mocks.dismissToast,
    isDismissed: (id: string) => mocks.dismissedToastIds.has(id),
  }),
}));

import { ToastNotifications } from "./index";

const storedValues = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => storedValues.set(key, value),
  removeItem: (key: string) => storedValues.delete(key),
  clear: () => storedValues.clear(),
};

describe("ToastNotifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", localStorageMock);
    mocks.dismissToast.mockClear();
    mocks.message.mockClear();
    mocks.error.mockClear();
    mocks.warning.mockClear();
    mocks.loading.mockClear();
    mocks.dismiss.mockClear();
    mocks.dismissedToastIds.clear();
    localStorage.clear();
    mocks.live = { status: "inactive", sessionId: null };
    mocks.openNew.mockClear();
    mocks.updateSettingsTabState.mockClear();
    mocks.currentTab = { type: "empty" };
    mocks.config.current_llm_provider = "local";
    mocks.config.current_llm_model = "model";
    mocks.config.current_stt_provider = "local";
    mocks.config.current_stt_model = "model";
    mocks.notifications.hasActiveDownload = false;
    mocks.notifications.downloadingModel = null;
    mocks.notifications.activeDownloads = [];
    mocks.notifications.localSttStatus = null;
    mocks.notifications.isLocalSttModel = false;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses the latest registry action while a toast remains visible", () => {
    mocks.config.current_llm_provider = null;
    mocks.config.current_llm_model = null;

    const view = render(<ToastNotifications />);

    act(() => vi.advanceTimersByTime(500));

    const options = mocks.message.mock.calls[0][1];

    mocks.currentTab = { type: "settings", state: { tab: "general" } };
    view.rerender(<ToastNotifications />);

    options.action.onClick();

    expect(mocks.updateSettingsTabState).toHaveBeenCalledWith(
      mocks.currentTab,
      { tab: "intelligence" },
    );
    expect(mocks.openNew).not.toHaveBeenCalled();
  });
});
