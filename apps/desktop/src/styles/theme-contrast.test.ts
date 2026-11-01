import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contraste WCAG 2.x des paires texte / fond des trois palettes (緑茶 Thé vert,
// 藤 Glycine, 臙脂 Laque et encre), calculé depuis la source de vérité
// (packages/design-system/src/tokens.css), en clair et en sombre. Seuil AA
// texte courant : 4.5:1.
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
  ["user-ink", "background"],
  ["user-ink", "card"],
  ["recording", "background"],
  ["recording", "card"],
  // Bouton « Commencer l'écoute » de la capsule : texte background sur recording.
  ["background", "recording"],
  // Couleurs de catégorie (badges, niveaux de journal) employées en texte.
  ["chart-2", "background"],
  ["chart-2", "card"],
  ["chart-3", "background"],
  ["chart-3", "card"],
  ["chart-4", "background"],
  ["chart-4", "card"],
];

const THEMES = [
  ["Thé vert", "clair", ":root"],
  ["Thé vert", "sombre", ".dark"],
  ["Glycine", "clair", '[data-palette="fuji"]'],
  ["Glycine", "sombre", '[data-palette="fuji"] .dark'],
  ["Laque et encre", "clair", '[data-palette="enji"]'],
  ["Laque et encre", "sombre", '[data-palette="enji"] .dark'],
] as const;

describe.each(THEMES)(
  "contraste du texte, palette %s en thème %s",
  (_palette, _mode, selector) => {
    const tokens = block(selector);

    it.each(TEXT_PAIRS)("%s sur %s ≥ 4.5:1", (fg, bg) => {
      expect(tokens[fg], `--${fg} manquant`).toBeDefined();
      expect(tokens[bg], `--${bg} manquant`).toBeDefined();
      expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
    });
  },
);

// CIE L*a*b* (D65) puis ΔE 1976 : distance perçue entre deux couleurs.
function lab(value: string): [number, number, number] {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const [r, g, b] = hslToRgb(value).map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// Le bouton « Commencer l'écoute » (bg-recording) est posé sur la capsule
// (bg-primary), et le point d'écoute aussi : le rouge d'écoute doit se
// distinguer nettement du primaire, surtout dans Laque et encre où les deux
// sont rouges (臙脂 #9f353a / 朱 #d3381c, ΔE ≈ 34 ; le 紅 #c53d43 de Thé vert
// n'y ferait que ΔE ≈ 14).
describe.each(THEMES)(
  "rouge d'écoute, palette %s en thème %s",
  (_palette, _mode, selector) => {
    const tokens = block(selector);

    it("recording se distingue de primary (ΔE76 ≥ 25)", () => {
      expect(deltaE(tokens.recording, tokens.primary)).toBeGreaterThanOrEqual(
        25,
      );
    });
  },
);
