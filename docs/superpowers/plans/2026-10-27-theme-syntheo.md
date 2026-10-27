# Thème Syntheo (couleurs, police) — plan d'implémentation (lot 06a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'application prend l'identité visuelle Syntheo (bleu `#1a73e8`, surfaces claires `#f8f9fa`, rayons 6–12 px, thème sombre dérivé, police Inter embarquée), sans toucher aux chaînes de caractères ni aux identifiants (lot 06b).

**Architecture:** La palette vit déjà dans `packages/design-system/src/tokens.css` sous forme de triplets HSL non préfixés, consommés par Tailwind v4 via les blocs `@theme` de `apps/desktop/src/styles/globals.css` et `packages/ui/src/styles/globals.css`. On remplace uniquement les **valeurs** des variables `:root` (clair) et `.dark` (sombre) par la palette Syntheo, on aligne les tokens TS `DesignColors`, on remplace les couleurs « warm stone » résiduelles dans `dark-theme.css`, et on branche la police Inter embarquée via `@fontsource-variable/inter`.

**Tech Stack:** Tailwind CSS v4 (CSS-first, pas de `tailwind.config`), React 19, TypeScript, Vite, Vitest, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (inventaire « Logo / Tokens `--syn-*` », Phase 3 « Identité Syntheo »). Tokens d'origine lus dans `/home/will/work/syntheo/src/components/tokens.css`.

## Global Constraints

- Aucune chaîne de texte modifiée ici : « Anarlog » → « Syntheo » est le lot 06b. Ce plan ne touche que CSS, tokens TS, dépendance de police et assets de police.
- La palette doit rester exprimée en **triplets HSL** (`H S% L%`, sans `hsl()` ni virgules) : c'est ce que Tailwind recompose (`hsl(var(--primary))`).
- Les jeux de variables de `:root` et `.dark` doivent rester **identiques en noms** (un test le vérifie).
- Claire/sombre continuent de basculer par la **classe `.dark` sur `<html>`** (aucun changement de mécanisme).
- Inter est embarquée localement (paquet `@fontsource-variable/inter`), **aucun appel réseau** au chargement.
- Avant de pousser : `pnpm exec dprint fmt` (global) puis `pnpm exec dprint check`. Piège connu : les éditions scriptées laissent des lignes vides qui font échouer `ci-code-quality (TypeScript)`.
- Gates de PR au vert ; un commit Conventional Commits par tâche ; PR avec `Closes #N` et `[skip release]` tant que les lots 04b/04c/06 ne sont pas tous fusionnés.

## Review Focus

- Thème sombre : chaque variable définie dans `:root` doit exister dans `.dark` → `theme-tokens.test.ts` (Task 1).
- Un utilisateur en mode « system » sombre : le fond passe bien en `#17181a` et le bleu primaire devient le bleu clair `#8ab4f8` (contraste sur fond noir) → mêmes variables, valeurs `.dark`.
- Police : le `--font-sans` effectif commence par `"Inter Variable"` et l'OTF SF Pro mort a disparu → `font-tokens.test.ts` (Task 2).
- Tokens TS (exportés pour le canvas/`icon.ts`) cohérents avec le CSS : `DesignColors.light.primary === "#1A73E8"` → `theme-tokens.test.ts` (Task 3).

---

### Task 1: Palette Syntheo claire + sombre dans `tokens.css`

**Files:**

- Modify: `packages/design-system/src/tokens.css:1-76`
- Test: `apps/desktop/src/styles/theme-tokens.test.ts` (nouveau)

**Interfaces:**

- Produces (variables CSS, mêmes noms qu'aujourd'hui) : `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--alert`, `--alert-foreground`, `--alert-border`, `--border`, `--input`, `--ring`, `--app-floating-chrome`, `--app-floating-panel`, `--app-floating-border`, `--chart-1..5`, `--radius`, `--sidebar-accent`, `--kbd-shadow-*`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// apps/desktop/src/styles/theme-tokens.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest s'exécute avec cwd = apps/desktop (via `pnpm -F @anlg/desktop test`
// ou `vitest run` depuis ce dossier).
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
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm -F @anlg/desktop test src/styles/theme-tokens.test.ts`
Expected: FAIL (`--primary` clair vaut `24 10% 16%`, sombre `24 10% 16%`).

- [ ] **Step 3: Implémenter — remplacer les blocs `:root` et `.dark`**

Remplacer le contenu de `packages/design-system/src/tokens.css` (garder l'en-tête `@layer base {` et les accolades) par :

```css
@layer base {
  :root {
    --background: 210 17% 98%;
    --foreground: 225 6% 13%;
    --card: 0 0% 100%;
    --card-foreground: 225 6% 13%;
    --popover: 0 0% 100%;
    --popover-foreground: 225 6% 13%;
    --primary: 214 82% 51%;
    --primary-foreground: 0 0% 100%;
    --secondary: 200 12% 95%;
    --secondary-foreground: 225 6% 13%;
    --muted: 200 12% 95%;
    --muted-foreground: 213 5% 39%;
    --accent: 218 92% 95%;
    --accent-foreground: 214 79% 39%;
    --destructive: 1 73% 45%;
    --destructive-foreground: 0 0% 100%;
    --alert: 5 81% 96%;
    --alert-foreground: 1 73% 45%;
    --alert-border: 5 70% 86%;
    --border: 0 0% 88%;
    --input: 0 0% 88%;
    --ring: 214 82% 51%;
    --app-floating-chrome: 200 12% 95%;
    --app-floating-panel: 210 17% 98%;
    --app-floating-border: 0 0% 88%;
    --chart-1: 214 82% 51%;
    --chart-2: 151 83% 34%;
    --chart-3: 31 100% 45%;
    --chart-4: 272 89% 61%;
    --chart-5: 214 79% 39%;
    --radius: 0.5rem;
    --sidebar-accent: 218 92% 95%;
    --kbd-shadow-outer: rgba(0, 0, 0, 0.1);
    --kbd-shadow-inset: rgba(255, 255, 255, 0.8);
    --kbd-shadow-outer-hover: rgba(0, 0, 0, 0.15);
  }

  .dark {
    --background: 220 6% 10%;
    --foreground: 216 12% 92%;
    --card: 225 5% 17%;
    --card-foreground: 216 12% 92%;
    --popover: 225 5% 17%;
    --popover-foreground: 216 12% 92%;
    --primary: 217 89% 76%;
    --primary-foreground: 220 6% 10%;
    --secondary: 206 6% 25%;
    --secondary-foreground: 216 12% 92%;
    --muted: 206 6% 25%;
    --muted-foreground: 210 6% 63%;
    --accent: 217 30% 25%;
    --accent-foreground: 217 89% 76%;
    --destructive: 1 60% 35%;
    --destructive-foreground: 0 0% 98%;
    --alert: 1 50% 14%;
    --alert-foreground: 5 86% 72%;
    --alert-border: 1 45% 24%;
    --border: 206 6% 25%;
    --input: 206 6% 25%;
    --ring: 217 89% 76%;
    --app-floating-chrome: 206 6% 25%;
    --app-floating-panel: 225 5% 17%;
    --app-floating-border: 206 6% 32%;
    --chart-1: 217 89% 76%;
    --chart-2: 151 60% 45%;
    --chart-3: 31 80% 60%;
    --chart-4: 272 70% 70%;
    --chart-5: 214 79% 60%;
    --radius: 0.5rem;
    --sidebar-accent: 217 30% 25%;
    --kbd-shadow-outer: rgba(0, 0, 0, 0.35);
    --kbd-shadow-inset: rgba(255, 255, 255, 0.08);
    --kbd-shadow-outer-hover: rgba(0, 0, 0, 0.5);
  }
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm -F @anlg/desktop test src/styles/theme-tokens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit et PR**

```bash
pnpm exec dprint fmt
git add packages/design-system/src/tokens.css apps/desktop/src/styles/theme-tokens.test.ts
git commit -m "feat(theme): palette Syntheo claire et sombre"
```

---

### Task 2: Police Inter embarquée

**Files:**

- Modify: `apps/desktop/package.json` (dépendance `@fontsource-variable/inter`)
- Modify: `apps/desktop/src/styles/globals.css:1-6,42-45`
- Modify: `apps/desktop/index.html` (palette « stone » codée en dur de l'écran de démarrage → palette Syntheo, et pile de police Inter)
- Delete: `apps/desktop/public/fonts/SF-Pro-Text-{Regular,Medium,Semibold,Bold}.otf` (assets morts, aucun `@font-face`, aucune référence)
- Test: `apps/desktop/src/styles/font-tokens.test.ts` (nouveau)

**Interfaces:**

- Consumes: `--font-sans` (défini dans `apps/desktop/src/styles/globals.css` `@theme`).
- Produces: `--font-sans` commençant par `"Inter Variable"`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// apps/desktop/src/styles/font-tokens.test.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest s'exécute avec cwd = apps/desktop.
const globals = readFileSync(
  resolve(process.cwd(), "src/styles/globals.css"),
  "utf8",
);

describe("police Syntheo", () => {
  it("déclare la police Inter embarquée en tête de --font-sans", () => {
    expect(globals).toMatch(/--font-sans:\s*\n?\s*"Inter Variable",/);
  });

  it("importe la police via le paquet fontsource", () => {
    expect(globals).toMatch(/@import "@fontsource-variable\/inter";/);
  });

  it("supprime les anciens OTF SF Pro inutilisés", () => {
    expect(
      existsSync(
        resolve(process.cwd(), "public/fonts/SF-Pro-Text-Regular.otf"),
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm -F @anlg/desktop test src/styles/font-tokens.test.ts`
Expected: FAIL (`--font-sans` commence par `system-ui`, pas d'import fontsource, OTF encore présent).

- [ ] **Step 3: Implémenter**

Ajouter la dépendance :

```bash
pnpm --filter @anlg/desktop add @fontsource-variable/inter
```

En tête de `apps/desktop/src/styles/globals.css`, avant les autres `@import`, ajouter :

```css
@import "@fontsource-variable/inter";
```

Remplacer la déclaration `--font-sans` (l. 43-44) par :

```css
--font-sans:
  "Inter Variable", "Inter", system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif;
```

Dans `apps/desktop/index.html`, remplacer la pile `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` de l'écran de démarrage par la même pile Inter (garder les mêmes replis ; l'écran de démarrage s'affiche avant le bundle, Inter est fourni par le CSS de l'app et n'est pas critique à cet instant).

Dans le même fichier, `index.html` code en dur l'ancienne palette « stone » du splash (elle s'affiche avant le CSS de l'app) : la remplacer par la palette Syntheo — `hsl(60 9% 98%)` → `hsl(210 17% 98%)`, `hsl(24 10% 11%)` → `hsl(220 6% 10%)`, `hsl(24 10% 10% / 0.2)` → `hsl(225 6% 13% / 0.2)`, `hsl(60 9% 98% / 0.2)` → `hsl(216 12% 92% / 0.2)`, `hsl(24 10% 10% / 0.75)` → `hsl(225 6% 13% / 0.75)`, `hsl(60 9% 98% / 0.5)` → `hsl(216 12% 92% / 0.5)`, `hsl(25 5% 45%)` → `hsl(213 5% 39%)`, `hsl(25 5% 55%)` → `hsl(210 6% 63%)`.

Supprimer les assets morts :

```bash
git rm apps/desktop/public/fonts/SF-Pro-Text-Regular.otf \
       apps/desktop/public/fonts/SF-Pro-Text-Medium.otf \
       apps/desktop/public/fonts/SF-Pro-Text-Semibold.otf \
       apps/desktop/public/fonts/SF-Pro-Text-Bold.otf
```

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm -F @anlg/desktop test src/styles/font-tokens.test.ts && pnpm -F @anlg/desktop typecheck`
Expected: PASS ; aucune erreur TypeScript. Puis `rg -n "SF-Pro-Text" apps/desktop` → vide (hors `dist/`).

- [ ] **Step 5: Commit et PR**

```bash
pnpm exec dprint fmt
git add apps/desktop/package.json pnpm-lock.yaml \
  apps/desktop/src/styles/globals.css apps/desktop/index.html \
  apps/desktop/src/styles/font-tokens.test.ts
git commit -m "feat(theme): police Inter embarquée"
```

---

### Task 3: Aligner les tokens TS et `dark-theme.css`

**Files:**

- Modify: `packages/design-system/src/index.ts:1-54` (`DesignColors`)
- Modify: `apps/desktop/src/styles/dark-theme.css:30-36` (pouce de barre de défilement)
- Test: `apps/desktop/src/styles/theme-tokens.test.ts` (étendre, même fichier que Task 1)

**Interfaces:**

- Consumes: palette de Task 1.
- Produces: `DesignColors.light.primary === "#1A73E8"`, `DesignColors.dark.primary === "#8AB4F8"`.

- [ ] **Step 1: Écrire le test qui échoue** (bloc ajouté à `theme-tokens.test.ts`)

```ts
import { DesignColors } from "@anlg/design-system";

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
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm -F @anlg/desktop test src/styles/theme-tokens.test.ts`
Expected: FAIL (`DesignColors.light.primary` vaut `#292524`).

- [ ] **Step 3: Implémenter**

Remplacer les objets `light` et `dark` de `DesignColors` (`packages/design-system/src/index.ts`) :

```ts
export const DesignColors = {
  light: {
    background: "#F8F9FA",
    foreground: "#202124",
    card: "#FFFFFF",
    cardForeground: "#202124",
    primary: "#1A73E8",
    primaryForeground: "#FFFFFF",
    secondary: "#F1F3F4",
    secondaryForeground: "#202124",
    muted: "#F1F3F4",
    mutedForeground: "#5F6368",
    accent: "#E8F0FE",
    accentForeground: "#1557B0",
    destructive: "#C5221F",
    destructiveForeground: "#FFFFFF",
    alert: "#FCE8E6",
    alertForeground: "#C5221F",
    alertBorder: "#F5C6C2",
    border: "#E0E0E0",
    input: "#E0E0E0",
    ring: "#1A73E8",
    floatingChrome: "#F1F3F4",
    floatingPanel: "#F8F9FA",
    floatingBorder: "#E0E0E0",
    scrim: "rgba(32, 33, 36, 0.32)",
  },
  dark: {
    background: "#17181A",
    foreground: "#E8EAED",
    card: "#292A2D",
    cardForeground: "#E8EAED",
    primary: "#8AB4F8",
    primaryForeground: "#17181A",
    secondary: "#3C4043",
    secondaryForeground: "#E8EAED",
    muted: "#3C4043",
    mutedForeground: "#9AA0A6",
    accent: "#2D3A4A",
    accentForeground: "#8AB4F8",
    destructive: "#8C2A26",
    destructiveForeground: "#FAFAF9",
    alert: "#3A1C1A",
    alertForeground: "#F2B8B5",
    alertBorder: "#5C2B28",
    border: "#3C4043",
    input: "#3C4043",
    ring: "#8AB4F8",
    floatingChrome: "#3C4043",
    floatingPanel: "#292A2D",
    floatingBorder: "#4A4E51",
    scrim: "rgba(0, 0, 0, 0.5)",
  },
} as const;
```

Dans `apps/desktop/src/styles/dark-theme.css`, remplacer les couleurs « warm stone » du pouce :

```css
.dark ::-webkit-scrollbar-thumb {
  background: #3c4043;
}

.dark ::-webkit-scrollbar-thumb:hover {
  background: #5f6368;
}
```

(`--provider-brand-filter`, les surlignages ProseMirror et `--selection-overlay` bleus restent inchangés.)

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm -F @anlg/desktop test src/styles/theme-tokens.test.ts && pnpm -F @anlg/desktop typecheck`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit et PR**

```bash
pnpm exec dprint fmt
git add packages/design-system/src/index.ts apps/desktop/src/styles/dark-theme.css \
  apps/desktop/src/styles/theme-tokens.test.ts
git commit -m "feat(theme): tokens TS et accents sombres Syntheo"
```

---

## Vérification finale (lot 06a)

- [ ] `pnpm -F @anlg/desktop test` (suite complète) et `pnpm -F @anlg/desktop typecheck` verts.
- [ ] `pnpm exec dprint check` vert.
- [ ] Contrôle visuel dans le conteneur de build (`docker run … syntheo-dev:1`) ou en local : les écrans onboarding, session, réglages, en clair et en sombre, utilisent le bleu `#1a73e8`, les surfaces claires et la police Inter ; aucune trace de la palette « stone » (`24 10% 16%`, `#292524`, `#44403c`).
- [ ] `rg -n "292524|44403c|57534e|24 10% 16%|60 9% 98%" packages/design-system apps/desktop/src --glob '!**/*.test.ts'` → vide.

## Hors périmètre (lots suivants)

- Remplacer les chaînes « Anarlog » → « Syntheo » (msgids, titres, ambiance) : **lot 06b**.
- Palette des locuteurs s1–s4 (`stt/speaker-context.ts`, timeline) et export DOCX : **lot 09** (phase 6).
- Traduction FR des catalogues : **lot 07**.
