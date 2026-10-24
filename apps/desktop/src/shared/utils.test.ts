import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIdentifier: vi.fn(),
  startCallbackServer: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getIdentifier: mocks.getIdentifier,
}));

vi.mock("@anlg/plugin-deeplink2", () => ({
  commands: { startCallbackServer: mocks.startCallbackServer },
}));

import { buildWebAppUrl, getScheme } from "./utils";

describe("getScheme", () => {
  beforeEach(() => {
    mocks.getIdentifier.mockReset();
  });

  it.each([
    ["fr.willisback.syntheo", "syntheo"],
    ["fr.willisback.syntheo.dev", "syntheo-dev"],
    ["com.hyprnote.stable", "syntheo"],
    ["unknown", "syntheo"],
  ])("maps %s to %s", async (identifier, scheme) => {
    mocks.getIdentifier.mockResolvedValue(identifier);

    await expect(getScheme()).resolves.toBe(scheme);
  });
});

describe("development integration return", () => {
  beforeEach(() => {
    mocks.startCallbackServer.mockReset();
    mocks.startCallbackServer.mockResolvedValue({ status: "ok", data: 14888 });
  });
  it.each(["/app/integration", "/app/google-drive-picker"] as const)(
    "starts a callback listener for %s",
    async (path) => {
      mocks.getIdentifier.mockResolvedValue("fr.willisback.syntheo.dev");
      const url = new URL(await buildWebAppUrl(path));
      expect(url.searchParams.get("callback_port")).toBe("14888");
      expect(mocks.startCallbackServer).toHaveBeenCalledWith(
        "syntheo-dev",
        null,
      );
    },
  );
  it("keeps installed app and auth flows unchanged", async () => {
    mocks.getIdentifier.mockResolvedValue("fr.willisback.syntheo");
    expect(
      new URL(await buildWebAppUrl("/app/integration")).searchParams.has(
        "callback_port",
      ),
    ).toBe(false);
    mocks.getIdentifier.mockResolvedValue("fr.willisback.syntheo.dev");
    await buildWebAppUrl("/auth");
    expect(mocks.startCallbackServer).not.toHaveBeenCalled();
  });
  it("reports a listener failure before opening a broken browser flow", async () => {
    mocks.getIdentifier.mockResolvedValue("fr.willisback.syntheo.dev");
    mocks.startCallbackServer.mockResolvedValue({
      status: "error",
      error: "bind failed",
    });
    await expect(buildWebAppUrl("/app/integration")).rejects.toThrow(
      "bind failed",
    );
  });
});
