# Rebranding « Anarlog » → « Syntheo » — plan d'implémentation (lot 06b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plus aucune occurrence d'« Anarlog »/« anarlog »/« anlg »/« hyprnote » dans le code, les identifiants techniques, les configurations et les chaînes visibles — sauf l'attribution MIT obligatoire (`LICENSE`, `NOTICE.md`) et les documents historiques de migration (`docs/superpowers/**`).

**Architecture:** Un codemod unique et testé (`scripts/rebrand.mjs`) applique une table de règles ordonnée à tout fichier texte suivi, en **protégeant les hôtes Fastrepl** (`anarlog.so`, `anarlog.dev`, `anarlog.git`) et les fichiers à ne pas toucher (lockfiles, catalogues i18n, licence, historique). Les renommages de **chemins** (dossiers, fichiers, assets) se font ensuite par `git mv`, puis les ajustements non automatisables : identifiants Rust/Tauri + lockfile, clés persistées (localStorage) avec repli hérité, audit des URLs Fastrepl, régénération des catalogues Lingui, documentation.

**Tech Stack:** Node 22 (`node --test`), pnpm 11 (workspaces), Rust/Cargo (rename de crates), Tauri 2 (identifiants de plugins + capabilities), Lingui 6 (extract/compile), dprint.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (astuce du chantier « i18n fr », décisions « Rebrand complet, sources comprises »). Chantier précédent : `docs/superpowers/plans/2026-10-24-identite-et-debranchement-fastrepl.md` (lot 01 `brand`, conventions).

## Global Constraints

- **Attribution MIT intouchable** : `LICENSE` conserve `Copyright (c) 2023-present Fastrepl, Inc.` et `NOTICE.md` conserve la mention de la source Anarlog. Ces deux fichiers sont **exclus** du codemod.
- **Historique exclu** : `docs/superpowers/**` et `.superpowers/**` décrivent la migration et citent Anarlog — exclus.
- **Lockfiles exclus du codemod** : `Cargo.lock`, `pnpm-lock.yaml`, `package-lock.json` (régénérés par `pnpm install` / `cargo metadata`).
- **Catalogues i18n exclus** : `apps/desktop/src/i18n/locales/**` régénéré par `lingui extract`/`compile` (Task 7).
- **Hôtes Fastrepl protégés** par le codemod et traités à la main (Task 6) : `anarlog.so`, `anarlog.dev`, `anarlog.git`.
- Aucune synchronisation amont : on renomme sans couche de compatibilité, sauf pour ce qui est **persisté sur le poste** (localStorage, Task 5).
- Un commit Conventional Commits par tâche ; PR avec `Closes #N` et `[skip release]` tant que les lots 04b/04c/06 ne sont pas fusionnés.
- **Toujours** `pnpm exec dprint fmt` (global) avant de pousser, puis `pnpm exec dprint check`.
- Gates : `tsc`, Vitest, `cargo test --locked` (crates CI : `template-app`, `db-app`, `owhisper-client`, `listener-core`, `storage`), `cargo metadata --locked`, `pnpm install --frozen-lockfile`.
- Rappels d'environnement : `cargo check -p desktop` impossible dans le conteneur (`ort-sys`/`onnxruntime` absent) ; la CI `ci-test (Rust)` ne construit qu'un sous-ensemble de crates ; ne jamais lancer un `edit` et un `git commit` dans le même message.

## Review Focus

- Attribution : `LICENSE` et `NOTICE.md` contiennent encore « Fastrepl »/« Anarlog » → `rg -n "Fastrepl|Anarlog" LICENSE NOTICE.md` renvoie des lignes (voulu).
- Repli de thème : un poste de dev ayant déjà `anarlog-theme`/`hypr-theme` dans son localStorage conserve son thème → test `readStoredThemePreference` (Task 5).
- Plugin Tauri `anlg-tray` renommé : la capability et le JS doivent converger, sinon la barre de menus casse → `rg -n "anlg-tray|syntheo-tray"` ; gate de build (Task 4).
- Domaine : aucune occurrence de `anarlog.so` ne doit subsister dans du code **exécutable** (elle prouverait un appel vers l'infra Fastrepl) → `rg -n "anarlog\.(so|dev)" apps crates plugins` (Task 6).
- Catalogues : après extract, `fr/messages.po` n'a plus de msgid « Anarlog » ; les traductions orphelines sont supprimées par `--clean` (Task 7).

---

### Task 1: Codemod `scripts/rebrand.mjs` (testé)

**Files:**

- Create: `scripts/rebrand.mjs`
- Test: `scripts/rebrand.test.mjs`

**Interfaces:**

- Produces: `export function rebrandText(input: string): string` ; `export const RULES: [RegExp, string][]` ; CLI `node scripts/rebrand.mjs [--write] [--path <dir>]` (dry-run par défaut).

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// scripts/rebrand.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { rebrandText } from "./rebrand.mjs";

test("renomme le produit, les identifiants et les scopes", () => {
  assert.equal(rebrandText("Anarlog Desktop"), "Syntheo Desktop");
  assert.equal(rebrandText("ANARLOG_DB_PATH"), "SYNTHEO_DB_PATH");
  assert.equal(rebrandText("anarlog-cli"), "syntheo-cli");
  assert.equal(rebrandText("@anlg/desktop"), "@syntheo/desktop");
  assert.equal(rebrandText("@anlg/plugin-tray"), "@syntheo/plugin-tray");
  assert.equal(
    rebrandText("tauri-plugin-anlg-tray"),
    "tauri-plugin-syntheo-tray",
  );
  assert.equal(rebrandText("anlg-http-utils"), "syntheo-http-utils");
  assert.equal(rebrandText("AnarlogMark"), "SyntheoMark");
  assert.equal(rebrandText("anarlog-mark"), "syntheo-mark");
  assert.equal(rebrandText('"anlg-tray"'), '"syntheo-tray"');
});

test("renomme les identifiants hyprnote hérités", () => {
  assert.equal(rebrandText("com.hyprnote.stable"), "com.syntheo.stable");
  assert.equal(rebrandText("hyprnote://share/open"), "syntheo://share/open");
});

test("protège les hôtes et le dépôt Fastrepl", () => {
  assert.equal(
    rebrandText("https://anarlog.so/changelog"),
    "https://anarlog.so/changelog",
  );
  assert.equal(rebrandText("https://anarlog.dev"), "https://anarlog.dev");
  assert.equal(
    rebrandText("https://github.com/fastrepl/anarlog.git"),
    "https://github.com/fastrepl/anarlog.git",
  );
});

test("laisse la clé localStorage héritée hypr-theme intacte", () => {
  assert.equal(
    rebrandText('const K = "hypr-theme";'),
    'const K = "hypr-theme";',
  );
});

test("ne touche pas un texte déjà rebrandé", () => {
  assert.equal(rebrandText("Syntheo Desktop"), "Syntheo Desktop");
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node --test scripts/rebrand.test.mjs`
Expected: FAIL (`Cannot find module './rebrand.mjs'`).

- [ ] **Step 3: Implémenter `scripts/rebrand.mjs`**

```js
#!/usr/bin/env node
// Rebranding Syntheo : remplace les identifiants Anarlog/anlg/hyprnote dans les
// fichiers texte suivis. Les hôtes Fastrepl sont protégés (traitement manuel).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Sentinelles : mises en place avant les règles génériques, restaurées après.
const KEEP = {
  "anarlog.so": "\u0000KEEP_SO\u0000",
  "anarlog.git": "\u0000KEEP_GIT\u0000",
};

// Règles ordonnées, sensibles à la casse.
export const RULES = [
  [/anarlog\.so/g, KEEP["anarlog.so"]],
  [/anarlog\.git/g, KEEP["anarlog.git"]],
  // `anarlog.dev` nu (URL/fin de mot) protégé ; `anarlog.dev.x` reste renommable.
  [/anarlog\.dev(?![A-Za-z0-9.-])/g, "\u0000KEEP_DEV\u0000"],
  [/Anarlog/g, "Syntheo"],
  [/ANARLOG/g, "SYNTHEO"],
  [/anarlog/g, "syntheo"],
  [/Anlg/g, "Syntheo"],
  [/ANLG/g, "SYNTHEO"],
  [/anlg/g, "syntheo"],
  [/Hyprnote/g, "Syntheo"],
  [/HYPRNOTE/g, "SYNTHEO"],
  [/hyprnote/g, "syntheo"],
  [/\u0000KEEP_SO\u0000/g, "anarlog.so"],
  [/\u0000KEEP_GIT\u0000/g, "anarlog.git"],
  [/\u0000KEEP_DEV\u0000/g, "anarlog.dev"],
];

export function rebrandText(input) {
  let out = input;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".git",
  ".codegraph",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);
const SKIP_BASENAMES = new Set([
  "Cargo.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "LICENSE",
  "NOTICE.md",
]);
// Le codemod se contient lui-même : ne jamais le réécrire.
const SKIP_FILES = new Set(["scripts/rebrand.mjs", "scripts/rebrand.test.mjs"]);
const SKIP_PREFIXES = [
  "apps/desktop/src/i18n/locales",
  "docs/superpowers",
  ".superpowers",
];
const EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".json5",
  ".rs",
  ".toml",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".css",
  ".html",
  ".sh",
  ".bash",
  ".py",
  ".swift",
  ".sql",
  ".txt",
  ".ftl",
  ".cfg",
  ".ini",
  ".conf",
  ".plist",
  ".entitlements",
  ".nix",
  ".service",
  ".gradle",
  ".properties",
]);
const EXT_LESS = new Set(["PKGBUILD", "Dockerfile", "Makefile"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    const rel = relative(ROOT, abs).split("\\").join("/");
    if (
      SKIP_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`)) ||
      SKIP_FILES.has(rel)
    ) {
      continue;
    }
    if (statSync(abs).isDirectory()) {
      yield* walk(abs);
    } else if (
      !SKIP_BASENAMES.has(entry) &&
      (EXT.has(extname(entry)) || EXT_LESS.has(entry))
    ) {
      yield abs;
    }
  }
}

function main() {
  const write = process.argv.includes("--write");
  const onlyIdx = process.argv.indexOf("--path");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
  let changedFiles = 0;
  for (const abs of walk(only ? join(ROOT, only) : ROOT)) {
    const before = readFileSync(abs, "utf8");
    const after = rebrandText(before);
    if (after !== before) {
      changedFiles += 1;
      if (write) writeFileSync(abs, after);
      else console.log(relative(ROOT, abs));
    }
  }
  console.log(
    `${write ? "réécrits" : "à réécrire"} : ${changedFiles} fichiers`,
  );
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `node --test scripts/rebrand.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit et PR**

```bash
pnpm exec dprint fmt
git add scripts/rebrand.mjs scripts/rebrand.test.mjs
git commit -m "chore(rebrand): codemod de renommage Anarlog vers Syntheo"
```

---

### Task 2: Appliquer le codemod et renommer les chemins

**Files:**

- Modify: tous les fichiers texte suivis (hors exclusions de Task 1)
- Rename (git mv) :
  - `skills/anarlog/` → `skills/syntheo/`
  - `agent-plugins/anarlog/` → `agent-plugins/syntheo/`
  - `packaging/aur/anarlog-bin/` → `packaging/aur/syntheo-bin/`
  - `scripts/publish-anarlog-skill.mjs` → `scripts/publish-syntheo-skill.mjs` (+ `.test.mjs`)
  - `apps/desktop/public/assets/anarlog-icon.png` → `apps/desktop/public/assets/syntheo-icon.png`
  - `apps/desktop/src/shared/anarlog-mark.tsx` → `apps/desktop/src/shared/syntheo-mark.tsx` (+ son `.test.tsx`)
  - `.agents/skills/anarlog-workflow/` → `.agents/skills/syntheo-workflow/` (si présent)

- [ ] **Step 1: Dry-run et revue**

Run: `node scripts/rebrand.mjs`
Expected: la liste des fichiers qui changeraient. Vérifier **à l'œil** qu'aucun fichier exécutable ne garde un hôte Fastrepl dans le diff (le dry-run ne montre que les noms ; utiliser `node scripts/rebrand.mjs --path apps` pour cibler).

- [ ] **Step 2: Appliquer**

```bash
node scripts/rebrand.mjs --write
```

- [ ] **Step 3: Renommer les chemins**

```bash
git mv skills/anarlog skills/syntheo
git mv agent-plugins/anarlog agent-plugins/syntheo
git mv packaging/aur/anarlog-bin packaging/aur/syntheo-bin
git mv scripts/publish-anarlog-skill.mjs scripts/publish-syntheo-skill.mjs
git mv scripts/publish-anarlog-skill.test.mjs scripts/publish-syntheo-skill.test.mjs
git mv apps/desktop/public/assets/anarlog-icon.png apps/desktop/public/assets/syntheo-icon.png
git mv apps/desktop/src/shared/anarlog-mark.tsx apps/desktop/src/shared/syntheo-mark.tsx
git mv apps/desktop/src/shared/anarlog-mark.test.tsx apps/desktop/src/shared/syntheo-mark.test.tsx
```

(Pour `.agents/skills/anarlog-workflow`, `git mv .agents/skills/anarlog-workflow .agents/skills/syntheo-workflow` — adapter au nom réel.)

- [ ] **Step 4: Relinker et formater**

```bash
pnpm install
pnpm exec dprint fmt
```

- [ ] **Step 5: Vérifier**

Run:

```bash
rg -n -i "anarlog|anlg" apps/desktop/src --glob '!**/i18n/locales/**' | rg -v "anarlog\.so|anarlog\.dev" | head
pnpm -F @syntheo/desktop typecheck
```

Expected: plus d'occurrence hors hôtes protégés ; `typecheck` passe (les imports `@syntheo/*` se résolvent après `pnpm install`).

- [ ] **Step 6: Commit et PR**

```bash
git add -A
git commit -m "chore(rebrand): renommage global des sources et des chemins [skip release]"
```

---

### Task 3: Identifiants Rust/Tauri, capability et lockfile

**Files:**

- Modify: `crates/http/Cargo.toml` (package `anlg-http-utils` → `syntheo-http-utils`), `plugins/tray/Cargo.toml` (`tauri-plugin-anlg-tray` → `tauri-plugin-syntheo-tray`), `apps/cli/Cargo.toml` (`anarlog`/`anarlog-cli` → `syntheo`/`syntheo-cli`), `apps/desktop/src-tauri/Cargo.toml` (`anarlog_desktop_lib` → `syntheo_desktop_lib`)
- Modify: `apps/desktop/src-tauri/capabilities/default.json` (`anlg-tray:default` → `syntheo-tray:default`)
- Modify (déjà fait par le codemod, à confirmer) : `plugins/tray/src/lib.rs` (`PLUGIN_NAME = "syntheo-tray"`), `plugins/tray/src/ext.rs` (`TRAY_ID`), `plugins/tray/src/macos_position.rs`
- Modify/Regenerate (fichiers **générés** qui embarquent les identifiants de plugin) : `plugins/tray/js/bindings.gen.ts`, `apps/desktop/src-tauri/gen/schemas/{capabilities,acl-manifests,desktop-schema,linux-schema}.json`
- Regenerate: `Cargo.lock`

**Interfaces:**

- Consumes: renommages de Task 2.
- Produces: workspace Rust dont les crates/plugins portent des noms `syntheo-*`, buildable.

- [ ] **Step 1: Confirmer les identifiants restants**

Run: `rg -n "anlg|anarlog" --glob '*/Cargo.toml' --glob 'Cargo.lock' | head -40`
Expected: uniquement des lignes `anlg-http-utils`, `tauri-plugin-anlg-tray`, `anarlog`, `anarlog-cli`, `anarlog_desktop_lib` (les autres ont été faites en Task 2).

- [ ] **Step 2: Régénérer le lockfile (sans `--locked`)**

```bash
cargo metadata --format-version 1 > /dev/null
```

- [ ] **Step 3: Vérifier les crates CI et le workspace**

Run:

```bash
cargo test --locked -p storage -p db-app -p listener-core -p template-app -p owhisper-client
cargo metadata --locked > /dev/null
```

Expected: PASS ; metadata OK (lockfile à jour).

- [ ] **Step 4: Contrôle capability/plugin et fichiers générés (pas de build desktop possible en conteneur)**

Run:

```bash
rg -n "syntheo-tray" apps/desktop/src-tauri/capabilities/default.json plugins/tray/src
rg -n "anlg-tray" apps/desktop/src-tauri/gen plugins/tray/js
```

Expected: `syntheo-tray:default` (capability) et `"syntheo-tray"` (constantes) cohérents ; la seconde commande ne renvoie **rien**. Si les schémas générés sont commités, les régénérer via le `export_types`/build du plugin `tray` (hors conteneur, lib native requise) ou confirmer que le codemod les a mis à jour de façon cohérente.

- [ ] **Step 5: Commit et PR**

```bash
git add -A
git commit -m "chore(rebrand): crates, plugin tray et capability Syntheo [skip release]"
```

---

### Task 4: Clés persistées sur le poste (thème) et repli hérité

**Files:**

- Modify: `apps/desktop/src/shared/theme/apply.ts:5-16,34-40`
- Modify: `apps/desktop/public/theme-boot.js:3-5`
- Modify: `apps/desktop/src/shared/theme/provider.tsx` (repli d'identifiant `com.syntheo.stable` → `fr.willisback.syntheo`)
- Modify: `apps/desktop/src/shared/theme/apply.test.ts` (tests de repli) et `provider.test.tsx` si besoin

**Interfaces:**

- Produces: `THEME_STORAGE_KEY = "syntheo-theme"`, `LEGACY_THEME_STORAGE_KEYS = ["anarlog-theme", "hypr-theme"]` (lecture seule).

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// ajout au describe("readStoredThemePreference") de apply.test.ts
it("lit la nouvelle clé Syntheo", () => {
  localStorage.setItem("syntheo-theme", "dark");
  expect(readStoredThemePreference()).toBe("dark");
});

it("conserve le repli depuis l'ancienne clé anarlog-theme", () => {
  localStorage.setItem("anarlog-theme", "light");
  expect(readStoredThemePreference()).toBe("light");
});

it("écrit sous la nouvelle clé Syntheo", async () => {
  getStoredSettingValues.mockResolvedValue({
    values: { theme: "dark" },
    hasValues: new Set(["theme"]),
  });
  await bootstrapThemeFromSettings({ timeoutMs: 100 });
  expect(localStorage.getItem("syntheo-theme")).toBe("dark");
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm -F @syntheo/desktop test src/shared/theme/apply.test.ts`
Expected: FAIL (`syntheo-theme` non lu).

- [ ] **Step 3: Implémenter** (`apply.ts`)

```ts
const THEME_STORAGE_KEY = "syntheo-theme";
const LEGACY_THEME_STORAGE_KEYS = ["anarlog-theme", "hypr-theme"] as const;
```

Puis dans `readStoredThemePreference` :

```ts
export function readStoredThemePreference(): ThemePreference {
  const stored =
    localStorage.getItem(THEME_STORAGE_KEY) ??
    LEGACY_THEME_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(
      (value) => value !== null,
    ) ??
    null;
  return normalizeThemePreference(stored);
}
```

Dans `theme-boot.js`, remplacer la lecture (l. 3-5) par :

```js
var stored =
  localStorage.getItem("syntheo-theme") ??
  localStorage.getItem("anarlog-theme") ??
  localStorage.getItem("hypr-theme");
```

Dans `provider.tsx`, remplacer le repli `"com.syntheo.stable"` (issu du codemod) par `"fr.willisback.syntheo"` (aligné sur `brand::STABLE_BUNDLE_ID`).

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm -F @syntheo/desktop test src/shared/theme && pnpm -F @syntheo/desktop typecheck`
Expected: PASS.

- [ ] **Step 5: Commit et PR**

```bash
pnpm exec dprint fmt
git add apps/desktop/src/shared/theme apps/desktop/public/theme-boot.js
git commit -m "feat(theme): clé localStorage Syntheo avec repli hérité [skip release]"
```

---

### Task 5: Variables d'environnement et scripts

**Files:**

- Modify (déjà renommées par le codemod, à confirmer) : `ANARLOG_*` → `SYNTHEO_*`, `ANLG_*` → `SYNTHEO_*` dans `apps`, `crates`, `plugins`, `scripts`, `.github/workflows`, `e2e`
- Modify: secrets/CI si référencés en clair (`.github/workflows/*.yml`, `Taskfile.yaml`)

**Interfaces:**

- Produces: aucune variable `ANARLOG_*`/`ANLG_*` restante dans le dépôt.

- [ ] **Step 1: Auditer**

Run:

```bash
rg -n "ANARLOG_[A-Z0-9_]+|ANLG_[A-Z0-9_]+" --glob '!**/node_modules/**' --glob '!**/target/**' | head -40
rg -n "SYNTHEO_[A-Z0-9_]+" .github scripts | head -20
```

Expected: plus aucune `ANARLOG_*`/`ANLG_*` ; les `SYNTHEO_*` correspondantes existent.

Pour les tests QA qui fixent des variables (`ANARLOG_AUDIO_QA_IN_DBUS`, `ANARLOG_NAVIGATE__*`), vérifier que producteurs et consommateurs ont été renommés **ensemble** : `rg -n "SYNTHEO_AUDIO_QA_IN_DBUS|SYNTHEO_NAVIGATE__"`.

- [ ] **Step 2: Vérifier les tests QA/scripts concernés**

Run: `node --test scripts/verify-linux-audio-qa-run.test.mjs scripts/verify-linux-audio-qa-evidence.test.mjs`
Expected: PASS (ou adapter les fixtures si elles embarquent l'ancien nom, ce que le codemod a déjà fait).

- [ ] **Step 3: Commit et PR**

```bash
git add -A
git commit -m "chore(rebrand): variables d'environnement SYNTHEO_* [skip release]"
```

---

### Task 6: Audit des URLs et domaines Fastrepl

**Files:**

- Modify: occurrences restantes de `anarlog.so`, `anarlog.dev`, `anarlog.git`, `desktop.anarlog.so`, `api.anarlog.so`, `github.com/fastrepl/anarlog`, `docs.anarlog.so` dans `apps`, `crates`, `plugins`, `agent-plugins`, `skills`, `packaging`, `docs`, `.github`, `README.md`

**Décision (à confirmer avec Will)** : Syntheo n'a pas encore de domaine web. On applique la correspondance suivante :

- Hôtes Fastrepl **fonctionnels** (`api.anarlog.so`, `desktop.anarlog.so`, `anarlog.so/api/*`, `anarlog.so/stt`) : relèvent de fonctions retirées (cloud, updater) → **supprimer** la référence (chantier 04d a retiré la fonction ; il ne doit rester aucune ligne de code qui les appelle).
- Documentation / marketing (`docs.anarlog.so`, `anarlog.so/changelog`, `/discord`, `/x`, `/security`, `/agents/overview`) : pointer vers le dépôt du projet.
- Dépôt (`github.com/fastrepl/anarlog`, `anarlog.git`) → `github.com/WillIsback/syntheo-desktop` (`.git`).

- [ ] **Step 1: Inventorier**

Run:

```bash
rg -n "anarlog\.(so|dev|git)" --glob '!**/node_modules/**' --glob '!**/target/**' --glob '!docs/superpowers/**' -g '!*.lock' | wc -l
rg -n "anarlog\.(so|dev)" apps crates plugins agent-plugins skills packaging
```

Expected: **zéro** dans `apps`/`crates`/`plugins` (code exécutable). Des occurrences dans `docs/`, `agent-plugins`/`skills` (documentation) et `packaging`.

- [ ] **Step 2: Corriger le code exécutable**

Pour chaque occurrence dans `apps`/`crates`/`plugins` : soit la supprimer (fonction retirée), soit la faire pointer vers le dépôt `https://github.com/WillIsback/syntheo-desktop`. Ne rien inventer de fonctionnel.

- [ ] **Step 3: Corriger documentation et packaging**

- `docs/**` : remplacer `docs.anarlog.so` par `https://github.com/WillIsback/syntheo-desktop/tree/main/docs` ; `anarlog.so/<page>` (marketing) par le dépôt. Une passe ultérieure (hors lot 06) traduira la doc en français.
- `agent-plugins/syntheo/**`, `skills/syntheo/**` : URLs de dépôt et MCP (`api.anarlog.so/mcp`) → retirer l'accès cloud (le MCP local suffit) ou repo.
- `packaging/aur/syntheo-bin/PKGBUILD` : `url=` et `source=` → dépôt du projet.

- [ ] **Step 4: Vérifier**

Run:

```bash
rg -n "anarlog\.(so|dev|git)|fastrepl/anarlog" --glob '!**/node_modules/**' --glob '!**/target/**' --glob '!docs/superpowers/**' -g '!*.lock'
```

Expected: uniquement `LICENSE`/`NOTICE.md` (attribution) et `docs/superpowers/**` (exclus).

- [ ] **Step 5: Commit et PR**

```bash
pnpm exec dprint fmt
git add -A
git commit -m "chore(rebrand): URLs et domaines Syntheo [skip release]"
```

---

### Task 7: Régénérer les catalogues Lingui

**Files:**

- Modify: `apps/desktop/src/i18n/locales/**/messages.po` et `messages.ts` (régénérés)
- Modify (si noms changés) : `apps/desktop/lingui.config.ts`, `apps/desktop/src/i18n/locales.ts`

**Interfaces:**

- Consumes: msgids rebrandés par le codemod dans `apps/desktop/src/**`.

- [ ] **Step 1: Extraire**

```bash
pnpm -F @syntheo/desktop i18n:extract --clean
```

- [ ] **Step 2: Vérifier que plus aucun msgid ne cite Anarlog**

Run:

```bash
rg -n "^msgid .*Anarlog" apps/desktop/src/i18n/locales | head
rg -n "^msgid .*Syntheo" apps/desktop/src/i18n/locales/en/messages.po | head
```

Expected: première commande vide ; seconde non vide.

- [ ] **Step 3: Compiler**

```bash
pnpm -F @syntheo/desktop i18n:compile
pnpm -F @syntheo/desktop i18n:check
```

Expected: PASS (`i18n:check` refait extract --clean + compile --strict et exige un arbre propre).

- [ ] **Step 4: Commit et PR**

```bash
pnpm exec dprint fmt 'apps/desktop/src/i18n/**'
git add apps/desktop/src/i18n apps/desktop/lingui.config.ts apps/desktop/src/i18n/locales.ts
git commit -m "chore(rebrand): catalogues i18n régénérés [skip release]"
```

(Les traductions FR orphelines seront refaites au lot 07 ; ici on ne fait que propager les msgids.)

---

### Task 8: Documentation, changelog et attribution

**Files:**

- Modify: `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `SECURITY.md`, `docs/**/*.mdx`, `docs/docs.json`, `docs/AGENTS.md`
- Modify: `packages/changelog/content/**/*.md` (notes de version affichées dans l'app)
- Keep (exclus du codemod, à vérifier) : `LICENSE`, `NOTICE.md`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`, `.github/security-exceptions.yml` (commentaires citant Anarlog)

- [ ] **Step 1: Vérifier l'attribution**

Run: `rg -n "Fastrepl|Anarlog" LICENSE NOTICE.md`
Expected: présent (voulu). Si le codemod les a touchés, restaurer via `git checkout -- LICENSE NOTICE.md`.

- [ ] **Step 2: Mettre à jour les mentions « Origine »**

Dans `README.md` et `NOTICE.md`, s'assurer que la section « Origine » cite la source (dépôt `fastrepl/anarlog`, révision importée, licence MIT) — c'est l'unique endroit où « Anarlog » doit rester.

- [ ] **Step 3: Nettoyer les résidus documents**

Run: `rg -n -i "anarlog|anlg" docs packages/changelog --glob '!docs/superpowers/**' | rg -v "Fastrepl|Origine" | head`
Expected: corriger les mentions restantes (titres, exemples de commandes `anarlog` → `syntheo`, etc.).

- [ ] **Step 4: Commit et PR**

```bash
pnpm exec dprint fmt 'docs/**/*' 'packages/changelog/**/*'
git add README.md CONTRIBUTING.md AGENTS.md SECURITY.md docs packages/changelog .github
git commit -m "docs(rebrand): documentation et changelog Syntheo [skip release]"
```

---

### Task 9: Vérification finale du lot 06b

- [ ] **Aucune occurrence hors exceptions**

Run:

```bash
rg -i "anarlog|anlg|hyprnote" \
  --glob '!**/node_modules/**' --glob '!**/target/**' --glob '!**/dist/**' \
  --glob '!LICENSE' --glob '!NOTICE.md' --glob '!docs/superpowers/**' \
  --glob '!.superpowers/**' -g '!*.lock' -g '!**/i18n/locales/**'
```

Expected: vide (ou uniquement des fichiers binaires ignorés).

- [ ] **Clé héritée volontaire**

Run: `rg -n "hypr-theme|anarlog-theme" apps/desktop/src apps/desktop/public`
Expected: uniquement les `LEGACY_THEME_STORAGE_KEYS` de Task 4 et `theme-boot.js`.

- [ ] **Gates**

Run:

```bash
pnpm install --frozen-lockfile
pnpm -F @syntheo/desktop typecheck
pnpm -F @syntheo/desktop test
cargo metadata --locked > /dev/null
cargo test --locked -p storage -p db-app -p listener-core -p template-app -p owhisper-client
pnpm exec dprint check
node --test scripts/rebrand.test.mjs
```

Expected: tout vert.

- [ ] **Contrôle manuel** : lancer l'app (localement ou via le conteneur `syntheo-dev:1`) et vérifier onboarding, session, réglages, barre de menus (tray), dictée et CLI (`syntheo` sur le `PATH`), sans aucune mention « Anarlog ».

## Notes de risque (lot 06b)

- Le renommage de scope `@anlg/*` → `@syntheo/*` touche ~57 `package.json` et ~681 importeurs : `pnpm install` puis `typecheck` sont le filet de sécurité.
- Le renommage du plugin Tauri `anlg-tray` → `syntheo-tray` change un identifiant d'API inspecté par Tauri : valider par un build desktop hors conteneur (ou via la CI release) avant fusion.
- Les clés de configuration SQLite (`syntheo.stt.provider.name`) sont renommées sans migration : Syntheo ayant son propre dossier de données (lot 01), il n'y a pas d'installation à migrer — un poste de dev peut perdre sa config de provider, à re-saisir.
- Les URLs `anarlog.so` restantes sont **volontairement** laissées par le codemod et traitées en Task 6 : ne pas les renommer mécaniquement en `syntheo.so` (domaine inexistant).
