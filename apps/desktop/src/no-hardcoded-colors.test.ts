import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Garde-fou de l'identité « Thé vert » : aucune couleur en dur dans les
// composants, uniquement les jetons (packages/design-system/src/tokens.css,
// exposés à Tailwind : background, foreground, primary, muted, destructive,
// alert*, recording, chart-1..5, scrim…). Échoue si une classe de palette
// Tailwind brute (`bg-red-500`, `text-neutral-600`, `bg-white`, `text-black`…)
// ou une couleur hex / rgb() apparaît dans le code de production.
// Vitest s'exécute depuis apps/desktop.
const ROOT = join(process.cwd(), "../..");
const SCANNED = ["apps/desktop/src", "packages/ui/src/components"];

const PALETTE =
  /\b(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|from|to|via|fill|stroke|outline|decoration|divide|shadow|placeholder|caret|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const BLACK_WHITE =
  /\b(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|from|to|via|fill|stroke|outline|decoration|divide|placeholder|caret)-(?:white|black)\b/g;
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1,5})?\b/g;
const RGB = /\brgba?\(/g;

// Fichiers exclus en entier, avec la raison.
const ALLOWED_FILES: Record<string, string> = {
  // Logos de marques tierces : leurs couleurs appartiennent aux marques.
  "packages/ui/src/components/icons/outlook.tsx": "logo Outlook",
  "apps/desktop/src/editor-bridge/app-link-view.tsx":
    "logos Slack, Discord, Atlassian, Asana, Trello, Airtable, Miro, Loom, Dropbox, Zoom, Calendly",
  "apps/desktop/src/settings/developers/skills.tsx": "logo OpenCode",
  "apps/desktop/src/settings/ai/shared/index.tsx":
    "couleurs de marque des fournisseurs à teinter selon le thème (comparaison, pas d'affichage)",
  // Couleurs choisies par l'utilisateur et enregistrées avec le modèle ou le
  // dossier (palette alignée sur identite.md / chart-*, sélecteur arc-en-ciel).
  "apps/desktop/src/templates/template-icon-picker.tsx":
    "palette proposée pour la couleur d'icône (valeur enregistrée)",
  "apps/desktop/src/templates/template-icon.tsx":
    "couleur d'icône par défaut, identique au défaut stocké en base (packages/db/src/schema.ts)",
  "apps/desktop/src/templates/generator.ts":
    "couleur d'icône enregistrée avec un modèle généré",
  // Outil développeur : n'apparaît qu'en build de dev ou staging
  // (should_show_devtool dans src-tauri/src/commands.rs).
  "apps/desktop/src/devtools-bar/index.tsx": "outil développeur",
  "apps/desktop/src/devtools-bar/render-outlines.ts": "outil développeur",
  "apps/desktop/src/devtools-bar/scan-panel.tsx": "outil développeur",
  "apps/desktop/src/devtools-bar/react-scan-controls.tsx": "outil développeur",
  "apps/desktop/src/devtools-bar/hint.tsx": "outil développeur",
};

// Lignes tolérées : la couleur n'est pas affichée telle quelle.
const ALLOWED_LINES: Array<{ file: string; includes: string; why: string }> = [
  {
    file: "apps/desktop/src/onboarding/index.tsx",
    includes: "[mask-image:",
    why: "masque de fondu : seule l'opacité compte",
  },
  {
    file: "apps/desktop/src/contacts/contact-avatar.tsx",
    includes: 'context.fillStyle = "#ffffff"',
    why: "aplat blanc d'un JPEG exporté (pas d'alpha), indépendant du thème",
  },
];

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "i18n" || name === "__fixtures__"
        ? []
        : productionFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.|\.gen\.|\.d\.ts$/.test(name)
      ? [path]
      : [];
  });
}

function findHardcodedColors(source: string): string[] {
  return [
    ...(source.match(PALETTE) ?? []),
    ...(source.match(BLACK_WHITE) ?? []),
    ...(source.match(HEX) ?? []),
    ...(source.match(RGB) ?? []),
  ];
}

describe("no hardcoded colors", () => {
  it("détecte bien les couleurs en dur", () => {
    expect(findHardcodedColors('className="bg-red-500 text-white"')).toEqual([
      "bg-red-500",
      "text-white",
    ]);
    expect(findHardcodedColors('color: "#1a73e8"')).toEqual(["#1a73e8"]);
    expect(findHardcodedColors("rgba(0, 0, 0, 0.4)")).toEqual(["rgba("]);
    expect(
      findHardcodedColors(
        'className="bg-primary text-destructive bg-chart-3/15 bg-scrim"',
      ),
    ).toEqual([]);
  });

  it("n'utilise que des jetons dans les composants", () => {
    const files = SCANNED.flatMap((dir) => productionFiles(join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(500);

    const offenders = files.flatMap((path) => {
      const file = relative(ROOT, path);
      if (file in ALLOWED_FILES) return [];
      const allowed = ALLOWED_LINES.filter((entry) => entry.file === file);
      return readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) => {
          if (allowed.some((entry) => line.includes(entry.includes))) {
            return [];
          }
          return findHardcodedColors(line).map(
            (hit) => `${file}:${index + 1} ${hit}`,
          );
        });
    });

    expect(offenders).toEqual([]);
  });

  it("ne garde pas d'exception périmée", () => {
    const missing = [
      ...Object.keys(ALLOWED_FILES),
      ...ALLOWED_LINES.map((entry) => entry.file),
    ].filter((file) => {
      try {
        return !statSync(join(ROOT, file)).isFile();
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  // L'encre verte est celle des notes de l'utilisateur (`user-ink`) : l'ancien
  // jeton `ai-ink` (texte de Syntheo) ne doit pas revenir.
  it("n'emploie plus l'ancien jeton ai-ink", () => {
    const files = SCANNED.flatMap((dir) => productionFiles(join(ROOT, dir)));
    const offenders = files.flatMap((path) =>
      /\bai-ink\b|\baiInk\b/.test(readFileSync(path, "utf8"))
        ? [relative(ROOT, path)]
        : [],
    );
    expect(offenders).toEqual([]);
  });
});
