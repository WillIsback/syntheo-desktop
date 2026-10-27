import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DesignColors } from "@anlg/design-system";

const css = readFileSync(
  resolve(process.cwd(), "../../packages/design-system/src/tokens.css"),
  "utf8",
);

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(
    new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`),
  );
  if (!match) throw new Error(`bloc ${selector} introuvable`);
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const decl = line.match(/^\s*(--[a-z0-9-]+):\s*(.+?);\s*$/);
    if (decl) out[decl[1]] = decl[2];
  }
  return out;
}

describe("palette Syntheo", () => {
  const light = block(":root");
  const dark = block(".dark");

  it("définit exactement les mêmes variables en clair et en sombre", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it("utilise le bleu Syntheo en clair", () => {
    expect(light["--primary"]).toBe("214 82% 51%"); // #1a73e8
    expect(light["--background"]).toBe("210 17% 98%"); // #f8f9fa
    expect(light["--border"]).toBe("0 0% 88%"); // #e0e0e0
    expect(light["--foreground"]).toBe("225 6% 13%"); // #202124
    expect(light["--muted-foreground"]).toBe("213 5% 39%"); // #5f6368
    expect(light["--ring"]).toBe("214 82% 51%");
  });

  it("éclaircit le bleu primaire en sombre", () => {
    expect(dark["--primary"]).toBe("217 89% 76%"); // #8ab4f8
    expect(dark["--primary-foreground"]).toBe("220 6% 10%");
    expect(dark["--background"]).toBe("220 6% 10%"); // #17181a
    expect(dark["--border"]).toBe("206 6% 25%"); // #3c4043
    expect(dark["--foreground"]).toBe("216 12% 92%"); // #e8eaed
  });
});

describe("DesignColors Syntheo", () => {
  it("aligne les tokens TS sur la palette CSS", () => {
    expect(DesignColors.light.primary).toBe("#1A73E8");
    expect(DesignColors.light.background).toBe("#F8F9FA");
    expect(DesignColors.light.border).toBe("#E0E0E0");
    expect(DesignColors.dark.primary).toBe("#8AB4F8");
    expect(DesignColors.dark.background).toBe("#17181A");
    expect(DesignColors.dark.border).toBe("#3C4043");
  });
});
