import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectImportSources: vi.fn(),
  cancelConnectedImport: vi.fn(),
  connectConnectedImport: vi.fn(),
  connectNangoImport: vi.fn(),
  disconnectConnectedImport: vi.fn(),
  disconnectNangoImport: vi.fn(),
  sync: vi.fn(),
  selectFiles: vi.fn(),
  readTextFiles: vi.fn(),
  importMeetingFiles: vi.fn(),
  signIn: vi.fn(),
  signedIn: true,
  connections: [] as Array<{
    connection_id: string;
    integration_id: string;
    status?: string | null;
  }>,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.selectFiles }));
vi.mock("@syntheo/plugin-importer", () => ({
  commands: { readTextFiles: mocks.readTextFiles },
}));

vi.mock("./detection", () => ({
  detectImportSources: mocks.detectImportSources,
}));

vi.mock("./queries", () => ({
  EMPTY_MEETING_IMPORT_HISTORY: [],
  importConnectedMeetings: vi.fn(),
  importMeetingFiles: mocks.importMeetingFiles,
  useMeetingImportHistory: () => ({ data: [] }),
}));

vi.mock("./connected-import", () => ({
  cancelConnectedImport: mocks.cancelConnectedImport,
  connectConnectedImport: mocks.connectConnectedImport,
  connectNangoImport: mocks.connectNangoImport,
  disconnectConnectedImport: mocks.disconnectConnectedImport,
  disconnectNangoImport: mocks.disconnectNangoImport,
  isDirectMeetingImport: (provider: { directImport?: string }) =>
    Boolean(provider.directImport),
  isNangoMeetingImport: (provider: { directImport?: string }) =>
    provider.directImport === "nango-oauth",
  isLocalConnectedImport: (provider: { directImport?: string }) =>
    provider.directImport === "mcp-oauth" || provider.directImport === "cli",
  nangoConnectionIsReady: (
    connection: { status?: string | null } | undefined,
  ) => Boolean(connection) && connection?.status !== "reconnect_required",
  connectedImportCredentialsQueryKey: (providerId: string) => [
    "meeting-import",
    providerId,
    "credentials",
  ],
  connectedImportSyncQueryKey: (providerId: string) => [
    "meeting-import",
    providerId,
    "sync",
  ],
  connectedImportCredentialsQueryOptions: (providerId: string) => ({
    queryKey: ["meeting-import", providerId, "credentials"],
    queryFn: async () => null,
    staleTime: Infinity,
  }),
  connectedImportSyncQueryOptions: (
    provider: { id: string },
    enabled: boolean,
  ) => ({
    queryKey: ["meeting-import", provider.id, "sync"],
    queryFn: async () => ({
      result: {
        discovered: 0,
        imported: 0,
        matched: 0,
        conflicts: 0,
        errors: 0,
      },
      warnings: [],
    }),
    enabled,
    retry: false,
  }),
  nangoImportSyncQueryOptions: (
    provider: { id: string },
    connectionId: string | undefined,
    _headers: Record<string, string> | null,
    enabled: boolean,
  ) => ({
    queryKey: ["meeting-import", provider.id, "sync", connectionId],
    queryFn: () => mocks.sync(provider.id),
    enabled,
    retry: false,
  }),
}));

import { MEETING_IMPORT_PROVIDERS } from "./providers";
import { MeetingImportScreen } from "./screen";

function renderImports(
  props: {
    compact?: boolean;
    onNoSourcesDetected?: () => void;
    secondaryAction?: ReactNode;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MeetingImportScreen {...props} />
    </QueryClientProvider>,
  );
}

function mockDetected(ids: string[]) {
  mocks.detectImportSources.mockResolvedValue(
    MEETING_IMPORT_PROVIDERS.filter((provider) =>
      ids.includes(provider.id),
    ).map((provider) => ({
      ...provider,
      installedAppId: `app.${provider.id}`,
      iconUrl: `data:image/png;base64,${provider.id}`,
    })),
  );
}

describe("MeetingImportScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectFiles.mockResolvedValue(["export.json"]);
    mocks.readTextFiles.mockResolvedValue({ status: "ok", data: [] });
    mocks.signedIn = true;
    mocks.connections = [];
    mocks.sync.mockResolvedValue({
      result: {
        discovered: 0,
        imported: 0,
        matched: 0,
        conflicts: 0,
        errors: 0,
      },
      warnings: [],
    });
    mocks.cancelConnectedImport.mockResolvedValue(true);
    mocks.connectNangoImport.mockResolvedValue({
      connection_id: "zoom-1",
      integration_id: "zoom",
    });
    mocks.signIn.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("lists only detected apps that import from local files", async () => {
    mockDetected([
      "chatgpt-record",
      "circleback",
      "granola",
      "slack-huddles",
      "zoom",
    ]);

    renderImports();

    expect(await screen.findByText("ChatGPT Record")).toBeTruthy();
    expect(screen.getByText("Slack Huddles")).toBeTruthy();
    // Connexions directes (OAuth, MCP) retirées : ces services ne sont pas listés.
    expect(screen.queryByText("Circleback")).toBeNull();
    expect(screen.queryByText("Granola")).toBeNull();
    expect(screen.queryByText("Zoom")).toBeNull();
    expect(screen.queryByText("Avoma")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("shows a completed file import even when all counts are zero", async () => {
    mockDetected(["slack-huddles"]);
    mocks.importMeetingFiles.mockResolvedValue({
      discovered: 0,
      imported: 0,
      matched: 0,
      conflicts: 0,
      errors: 0,
    });
    renderImports();
    fireEvent.click(
      await screen.findByRole("button", { name: "Choose files" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Slack Huddles" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Slack Huddles" }));
    expect(
      await screen.findByText("Last import: 0 added, 0 unchanged"),
    ).toBeTruthy();
  });

  it("does not show an import result when the file picker is cancelled", async () => {
    mockDetected(["slack-huddles"]);
    mocks.selectFiles.mockResolvedValue(null);
    renderImports();
    fireEvent.click(
      await screen.findByRole("button", { name: "Choose files" }),
    );
    await waitFor(() => expect(mocks.selectFiles).toHaveBeenCalledOnce());
    expect(mocks.importMeetingFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reports when detection finishes without finding any apps", async () => {
    const onNoSourcesDetected = vi.fn();
    mockDetected([]);

    renderImports({ onNoSourcesDetected });

    await waitFor(() => {
      expect(onNoSourcesDetected).toHaveBeenCalledOnce();
    });
  });

  it("does not report an empty result while detection is pending", async () => {
    const onNoSourcesDetected = vi.fn();
    mocks.detectImportSources.mockReturnValue(new Promise(() => {}));

    renderImports({ onNoSourcesDetected });

    expect(
      await screen.findByText("Checking installed meeting assistants…"),
    ).toBeTruthy();
    expect(onNoSourcesDetected).not.toHaveBeenCalled();
  });

  it("does not report an empty result when detection fails", async () => {
    const onNoSourcesDetected = vi.fn();
    mocks.detectImportSources.mockRejectedValue(new Error("Detection failed"));

    renderImports({ onNoSourcesDetected });

    expect(await screen.findByText("Detection failed")).toBeTruthy();
    expect(onNoSourcesDetected).not.toHaveBeenCalled();
  });
});
