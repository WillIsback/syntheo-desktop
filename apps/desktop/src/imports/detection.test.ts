import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInstalledApplicationIcons, listInstalledApplications } = vi.hoisted(
  () => ({
    getInstalledApplicationIcons: vi.fn(),
    listInstalledApplications: vi.fn(),
  }),
);

vi.mock("@syntheo/plugin-detect", () => ({
  commands: { getInstalledApplicationIcons, listInstalledApplications },
}));

import { detectImportSources } from "./detection";

describe("import source detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInstalledApplicationIcons.mockResolvedValue({
      status: "ok",
      data: [
        {
          id: "ai.plaud.desktop.plaud",
          dataUrl: "data:image/png;base64,plaud",
        },
      ],
    });
    listInstalledApplications.mockResolvedValue({
      status: "ok",
      data: [{ id: "ai.plaud.desktop.plaud", name: "Plaud Desktop" }],
    });
  });

  it("détecte les sources d'import locales installées et récupère leurs icônes", async () => {
    const result = await detectImportSources();

    expect(listInstalledApplications).toHaveBeenCalledOnce();
    expect(getInstalledApplicationIcons).toHaveBeenCalledWith([
      "ai.plaud.desktop.plaud",
    ]);
    expect(result.map((provider) => provider.id)).toEqual(["plaud"]);
    expect(result[0]?.iconUrl).toBe("data:image/png;base64,plaud");
  });
});
