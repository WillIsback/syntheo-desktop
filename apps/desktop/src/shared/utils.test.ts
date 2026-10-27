import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIdentifier: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getIdentifier: mocks.getIdentifier,
}));

import * as utils from "./utils";
import { getScheme } from "./utils";

describe("getScheme", () => {
  beforeEach(() => {
    mocks.getIdentifier.mockReset();
  });

  it.each([
    ["fr.willisback.syntheo", "syntheo"],
    ["fr.willisback.syntheo.dev", "syntheo-dev"],
    ["com.syntheo.stable", "syntheo"],
    ["unknown", "syntheo"],
  ])("maps %s to %s", async (identifier, scheme) => {
    mocks.getIdentifier.mockResolvedValue(identifier);

    await expect(getScheme()).resolves.toBe(scheme);
  });
});

describe("web app flows", () => {
  it("no longer builds hosted web app URLs (no account, no web flows)", () => {
    expect("buildWebAppUrl" in utils).toBe(false);
  });
});
