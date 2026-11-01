import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DesignColors,
  DesignPalettes,
  PALETTE_IDS,
} from "@syntheo/design-system";

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

  it("réserve le rouge beni à l'écoute et au sceau, l'encre des notes personnelles au vert", () => {
    for (const mode of [light, dark]) {
      expect(mode["--seal"]).toBe(mode["--recording"]);
      expect(mode["--user-ink"]).toBe(mode["--primary"]);
      expect(mode["--faint"]).toBeDefined();
      expect(mode["--shadow-capsule"]).toBeDefined();
    }
    expect(light["--recording"]).toBe("357 54% 51%"); // #c53d43
    expect(dark["--recording"]).toBe("4 72% 64%"); // #e5675f
  });
});

// Palettes alternatives (#259) : `data-palette` sur <html>, indépendant du
// mode clair / sombre. Thé vert reste le défaut (`:root` / `.dark`).
const PALETTE_SELECTORS = {
  fuji: {
    light: '[data-palette="fuji"]',
    dark: '[data-palette="fuji"] .dark',
  },
  enji: {
    light: '[data-palette="enji"]',
    dark: '[data-palette="enji"] .dark',
  },
} as const;

describe.each([
  ["Glycine", "fuji"],
  ["Laque et encre", "enji"],
] as const)("palette « %s »", (_name, id) => {
  const cha = block(":root");
  const light = block(PALETTE_SELECTORS[id].light);
  const dark = block(PALETTE_SELECTORS[id].dark);

  it("définit exactement les mêmes variables que Thé vert, en clair et en sombre", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(cha).sort());
    expect(Object.keys(dark).sort()).toEqual(Object.keys(cha).sort());
  });

  it("applique la variante sombre à <html class=dark> comme à un sous-arbre .dark", () => {
    expect(css).toContain(
      `[data-palette="${id}"].dark,\n  [data-palette="${id}"] .dark {`,
    );
  });

  it("garde les relations de Thé vert entre jetons", () => {
    for (const mode of [light, dark]) {
      expect(mode["--ring"]).toBe(mode["--primary"]);
      expect(mode["--user-ink"]).toBe(mode["--primary"]);
      expect(mode["--chart-1"]).toBe(mode["--primary"]);
      expect(mode["--seal"]).toBe(mode["--recording"]);
      expect(mode["--card-foreground"]).toBe(mode["--foreground"]);
      expect(mode["--popover"]).toBe(mode["--card"]);
      expect(mode["--secondary"]).toBe(mode["--muted"]);
      expect(mode["--sidebar-accent"]).toBe(mode["--accent"]);
      expect(mode["--app-floating-chrome"]).toBe(mode["--muted"]);
    }
    expect(light["--primary-foreground"]).toBe(light["--background"]);
    expect(light["--accent-foreground"]).toBe(light["--primary-hover"]);
  });
});

describe("valeurs claires des palettes (issue #259)", () => {
  it("Glycine : 江戸紫 sur fond papier, encre violine", () => {
    const light = block(PALETTE_SELECTORS.fuji.light);
    expect(light["--background"]).toBe("40 33% 98%"); // #fcfbf9
    expect(light["--primary"]).toBe("266 31% 42%"); // #674a8c
    expect(light["--accent"]).toBe("266 39% 93%"); // #ece6f4
    expect(light["--foreground"]).toBe("267 12% 17%"); // #2c2732
    expect(light["--recording"]).toBe("357 54% 51%"); // #c53d43
  });

  it("Laque et encre : 臙脂 sur 胡粉, rouge d'écoute 朱", () => {
    const light = block(PALETTE_SELECTORS.enji.light);
    expect(light["--background"]).toBe("60 100% 99%"); // #fffffc
    expect(light["--primary"]).toBe("357 50% 42%"); // #9f353a
    expect(light["--accent"]).toBe("6 61% 94%"); // #f9e8e6
    expect(light["--foreground"]).toBe("0 5% 12%"); // #1f1c1c
    expect(light["--recording"]).toBe("9 77% 47%"); // #d3381c
  });
});

describe("jetons exposés à Tailwind", () => {
  it.each(themeSources)("$path expose les nouveaux jetons", ({ css }) => {
    for (const token of [
      "primary-hover",
      "faint",
      "recording",
      "seal",
      "user-ink",
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
    expect(DesignColors.light.chart3).toBe("#93691A"); // 39 70% 34%
  });

  it("expose les mêmes clés en clair et en sombre", () => {
    expect(Object.keys(DesignColors.light).sort()).toEqual(
      Object.keys(DesignColors.dark).sort(),
    );
  });

  it("garde Thé vert comme palette par défaut", () => {
    expect(PALETTE_IDS).toEqual(["cha", "fuji", "enji"]);
    expect(DesignColors).toBe(DesignPalettes.cha);
  });
});

// Correspondance DesignPalettes (camelCase, hex) → variables CSS (HSL arrondi).
const TS_TO_CSS: Record<string, string> = {
  background: "background",
  foreground: "foreground",
  card: "card",
  cardForeground: "card-foreground",
  primary: "primary",
  primaryHover: "primary-hover",
  primaryForeground: "primary-foreground",
  secondary: "secondary",
  secondaryForeground: "secondary-foreground",
  muted: "muted",
  mutedForeground: "muted-foreground",
  faint: "faint",
  accent: "accent",
  accentForeground: "accent-foreground",
  destructive: "destructive",
  destructiveForeground: "destructive-foreground",
  alert: "alert",
  alertForeground: "alert-foreground",
  alertBorder: "alert-border",
  border: "border",
  input: "input",
  ring: "ring",
  recording: "recording",
  seal: "seal",
  userInk: "user-ink",
  floatingChrome: "app-floating-chrome",
  floatingPanel: "app-floating-panel",
  floatingBorder: "app-floating-border",
  chart1: "chart-1",
  chart2: "chart-2",
  chart3: "chart-3",
  chart4: "chart-4",
  chart5: "chart-5",
};

function hslToRgb255(value: string): number[] {
  const [h, s, l] = value.trim().split(/\s+/);
  const hue = Number(h);
  const sat = parseFloat(s) / 100;
  const light = parseFloat(l) / 100;
  const a = sat * Math.min(light, 1 - light);
  return [0, 8, 4].map((n) => {
    const k = (n + hue / 30) % 12;
    return 255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  });
}

function hexToRgb255(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

describe.each([
  ["cha", ":root", ".dark"],
  ["fuji", PALETTE_SELECTORS.fuji.light, PALETTE_SELECTORS.fuji.dark],
  ["enji", PALETTE_SELECTORS.enji.light, PALETTE_SELECTORS.enji.dark],
] as const)("DesignPalettes.%s", (id, lightSelector, darkSelector) => {
  it.each([
    ["light", lightSelector],
    ["dark", darkSelector],
  ] as const)("aligne le mode %s sur tokens.css", (mode, selector) => {
    const tokens = block(selector);
    const colors: Record<string, string> = DesignPalettes[id][mode];
    expect(Object.keys(colors).sort()).toEqual(
      Object.keys(DesignColors.light).sort(),
    );
    for (const [key, cssName] of Object.entries(TS_TO_CSS)) {
      const fromCss = hslToRgb255(tokens[`--${cssName}`]);
      const fromTs = hexToRgb255(colors[key]);
      // HSL arrondi à l'entier : on tolère 4/255 par canal.
      fromCss.forEach((channel, i) => {
        expect(
          Math.abs(channel - fromTs[i]),
          `${id}.${mode}.${key}`,
        ).toBeLessThanOrEqual(4);
      });
    }
    expect(colors.scrim).toBe(tokens["--scrim"]);
  });
});
