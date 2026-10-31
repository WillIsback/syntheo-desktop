import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contraste WCAG 2.x des paires texte / fond de la palette « Thé vert »,
// calculé depuis la source de vérité (packages/design-system/src/tokens.css),
// en clair et en sombre. Seuil AA texte courant : 4.5:1.
// `faint` est volontairement exclu : il ne sert qu'aux placeholders et aux
// libellés en capitales, jamais à un texte à lire (voir identite.md).

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
    const decl = line.match(/^\s*--([a-z0-9-]+):\s*(.+?);/);
    if (decl) out[decl[1]] = decl[2];
  }
  return out;
}

function hslToRgb(value: string): [number, number, number] {
  const [h, s, l] = value.trim().split(/\s+/);
  const hue = Number(h);
  const sat = parseFloat(s) / 100;
  const light = parseFloat(l) / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function contrast(fg: string, bg: string): number {
  const a = luminance(hslToRgb(fg));
  const b = luminance(hslToRgb(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "muted"],
  ["foreground", "accent"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "card"],
  ["muted-foreground", "accent"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-hover"],
  ["primary", "background"],
  ["primary", "card"],
  ["accent-foreground", "accent"],
  ["alert-foreground", "alert"],
  ["destructive-foreground", "destructive"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["alert-foreground", "background"],
  ["alert-foreground", "card"],
  ["ai-ink", "background"],
  ["ai-ink", "card"],
  ["recording", "background"],
  ["recording", "card"],
];

describe.each([
  ["clair", ":root"],
  ["sombre", ".dark"],
])("contraste du texte en thème %s", (_mode, selector) => {
  const tokens = block(selector);

  it.each(TEXT_PAIRS)("%s sur %s ≥ 4.5:1", (fg, bg) => {
    expect(tokens[fg], `--${fg} manquant`).toBeDefined();
    expect(tokens[bg], `--${bg} manquant`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
