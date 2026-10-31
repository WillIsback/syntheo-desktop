import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DesignColors } from "@syntheo/design-system";

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
    const decl = line.match(
      /^\s*(--[a-z0-9-]+):\s*(.+?);(?:\s*\/\*.*\*\/)?\s*$/,
    );
    if (decl) out[decl[1]] = decl[2];
  }
  return out;
}

const themeSources = [
  "../../packages/ui/src/styles/globals.css",
  "src/styles/globals.css",
].map((path) => ({
  path,
  css: readFileSync(resolve(process.cwd(), path), "utf8"),
}));

describe("palette Syntheo « Thé vert »", () => {
  const light = block(":root");
  const dark = block(".dark");

  it("définit exactement les mêmes variables en clair et en sombre", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it("utilise le vert chitose-midori sur fond kinari en clair", () => {
    expect(light["--primary"]).toBe("142 36% 30%"); // #316745
    expect(light["--primary-hover"]).toBe("146 39% 24%"); // #25553a
    expect(light["--background"]).toBe("50 43% 97%"); // #fbfaf5
    expect(light["--border"]).toBe("55 18% 87%"); // #e4e3d8
    expect(light["--foreground"]).toBe("100 8% 15%"); // #262a24
    expect(light["--muted-foreground"]).toBe("95 6% 36%"); // #5c6357
    expect(light["--ring"]).toBe(light["--primary"]);
  });

  it("éclaircit le vert primaire sur fond sumi en sombre", () => {
    expect(dark["--primary"]).toBe("142 34% 62%"); // #7dbf95
    expect(dark["--primary-foreground"]).toBe("143 32% 11%"); // #13251a
    expect(dark["--background"]).toBe("105 7% 11%"); // #1b1e1a
    expect(dark["--border"]).toBe("105 7% 21%"); // #343a32
    expect(dark["--foreground"]).toBe("46 25% 90%"); // #ece9df
    // Lot 6 : rouge clair + texte foncé, pour que `text-destructive` reste
    // lisible sur le fond sumi (≥ 4.5:1, voir theme-contrast.test.ts).
    expect(dark["--destructive"]).toBe("358 66% 64%"); // #e0676b
    expect(dark["--destructive-foreground"]).toBe("358 45% 12%"); // #2c1112
  });

  it("réserve le rouge beni à l'écoute et au sceau, l'encre IA au vert", () => {
    for (const mode of [light, dark]) {
      expect(mode["--seal"]).toBe(mode["--recording"]);
      expect(mode["--ai-ink"]).toBe(mode["--primary"]);
      expect(mode["--faint"]).toBeDefined();
      expect(mode["--shadow-capsule"]).toBeDefined();
    }
    expect(light["--recording"]).toBe("357 54% 51%"); // #c53d43
    expect(dark["--recording"]).toBe("4 72% 64%"); // #e5675f
  });
});

describe("jetons exposés à Tailwind", () => {
  it.each(themeSources)("$path expose les nouveaux jetons", ({ css }) => {
    for (const token of [
      "primary-hover",
      "faint",
      "recording",
      "seal",
      "ai-ink",
    ]) {
      expect(css).toContain(`--color-${token}: hsl(var(--${token}));`);
    }
    expect(css).toMatch(
      /@utility shadow-capsule\s*\{\s*box-shadow:\s*var\(--shadow-capsule\);/,
    );
  });
});

describe("DesignColors Syntheo", () => {
  it("aligne les tokens TS sur la palette CSS", () => {
    expect(DesignColors.light.primary).toBe("#316745");
    expect(DesignColors.light.primaryHover).toBe("#25553A");
    expect(DesignColors.light.background).toBe("#FBFAF5");
    expect(DesignColors.light.border).toBe("#E4E3D8");
    expect(DesignColors.light.recording).toBe("#C53D43");
    expect(DesignColors.dark.primary).toBe("#7DBF95");
    expect(DesignColors.dark.background).toBe("#1B1E1A");
    expect(DesignColors.dark.border).toBe("#343A32");
    expect(DesignColors.dark.recording).toBe("#E5675F");
    expect(DesignColors.dark.destructive).toBe("#E0676B");
    expect(DesignColors.dark.destructiveForeground).toBe("#2C1112");
  });

  it("expose les mêmes clés en clair et en sombre", () => {
    expect(Object.keys(DesignColors.light).sort()).toEqual(
      Object.keys(DesignColors.dark).sort(),
    );
  });
});
