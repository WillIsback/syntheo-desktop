# Templates Syntheo et générateur IA — plan d'implémentation (lot 08)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les templates de compte rendu sont ceux de Syntheo (17 templates Anarlog traduits en FR + 4 templates Syntheo épinglés), importables/exportables en Markdown, et générables par le LLM de l'utilisateur.

**Architecture:** Un template n'est pas un fichier Jinja : c'est une ligne SQLite (`templates.sections_json` = `[{title, description}]`), injectée dans le prompt d'enhance par la macro `template_numbered`. On intègre donc les données par une **migration SQL** (fichier déjà rédigé et validé sur le schéma réel). Côté desktop, on ajoute un **parseur Markdown ⇄ sections** (import/export) et un **générateur** qui appelle le LLM configuré via `generateObject` (AI SDK) et pré-remplit le formulaire.

**Tech Stack:** SQLite migrations Rust (`crates/db-app`), TypeScript/React 19, AI SDK v6 (`generateObject`), zod v4, Lingui, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (Phase 4, chantiers 07-08). Données prêtes : `docs/superpowers/specs/2026-10-24-syntheo-desktop-templates-fr.sql`.

## Global Constraints

- **Aucun provider cloud** : le générateur utilise le LLM configuré (`useLLMConnection`), jamais un service tiers.
- Migrations **append-only** : la nouvelle migration est horodatée après la dernière (`20261013090000_recording_import_jobs.sql`) et idempotente (`UPDATE` + `INSERT OR IGNORE`).
- Format des sections : `sections_json = [{title, description}]` ; icônes en `icon_json = {"type":"icon","value":...,"color":...}`.
- Textes d'interface et templates en **français**.
- `pnpm exec dprint fmt` (global) avant de pousser ; Conventional Commits ; PR `Closes #N` + `[skip release]`.

## Review Focus

- Les 4 templates Syntheo sont épinglés en tête (`pinned=1`, `pin_order` 0-3) → test Rust (Task 1).
- Aucun libellé anglais résiduel dans les templates → test + `rg` (Task 1).
- Import d'un template Markdown `# Titre\nconsigne` → `sections` correctes, et export inverse identique → test parseur (Task 2).
- LLM injoignable ou JSON invalide → repli Markdown, pas de crash → test générateur (Task 3).
- Le bouton « Générer » est désactivé sans connexion LLM → test UI (Task 4).

---

### Task 1: Migration des templates FR

**Files:**

- Create: `crates/db-app/migrations/20261024120000_syntheo_templates_fr.sql` (copie du fichier de spec)
- Modify: `crates/db-app/src/lib.rs:80+` (`APP_MIGRATION_STEPS`, nouvelle entrée en fin de tableau)
- Test: `crates/db-app/src/schema_tests/templates_fr.rs` (nouveau)

- [ ] **Step 1: Écrire le test qui échoue**

```rust
// crates/db-app/src/schema_tests/templates_fr.rs
use crate::schema_tests::test_db; // helper existant du module

#[tokio::test]
async fn syntheo_templates_are_pinned_and_french() {
    let db = test_db().await;
    let syntheo: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT id, title, pinned, pin_order FROM templates
         WHERE id LIKE 'syntheo-%' ORDER BY pin_order",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(
        syntheo
            .iter()
            .map(|(id, ..)| id.as_str())
            .collect::<Vec<_>>(),
        [
            "syntheo-general",
            "syntheo-compliance",
            "syntheo-project",
            "syntheo-standup"
        ]
    );
    assert!(syntheo.iter().all(|(_, _, pinned, _)| *pinned == 1));

    let board: String =
        sqlx::query_scalar("SELECT title FROM templates WHERE id = 'default-board-meeting'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(board, "Conseil d'administration");
}
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cargo test --locked -p db-app --lib -- schema_tests::templates_fr`
Expected: FAIL (templates `syntheo-*` absents).

- [ ] **Step 3: Implémenter**

```bash
cp docs/superpowers/specs/2026-10-24-syntheo-desktop-templates-fr.sql \
   crates/db-app/migrations/20261024120000_syntheo_templates_fr.sql
```

Ajouter en **fin** du tableau `APP_MIGRATION_STEPS` (`crates/db-app/src/lib.rs`) :

```rust
syntheo_db_migrate::MigrationStep {
    id: "20261024120000_syntheo_templates_fr",
    scope: syntheo_db_migrate::MigrationScope::Plain,
    sql: include_str!("../migrations/20261024120000_syntheo_templates_fr.sql"),
},
```

Déclarer `mod templates_fr;` avec les autres sous-modules de `schema_tests`.

- [ ] **Step 4: Vérifier le succès**

Run: `cargo test --locked -p db-app --lib -- schema_tests`
Expected: PASS. Puis `rg -n "Board meeting|Brainstorming session" crates/db-app/migrations/20261024120000_syntheo_templates_fr.sql` → vide (titres FR).

- [ ] **Step 5: Commit et PR**

```bash
git add crates/db-app/migrations/20261024120000_syntheo_templates_fr.sql crates/db-app/src/lib.rs crates/db-app/src/schema_tests
git commit -m "feat(templates): migration des templates Syntheo en français"
```

---

### Task 2: Parseur Markdown ⇄ sections

**Files:**

- Create: `apps/desktop/src/templates/markdown.ts`
- Test: `apps/desktop/src/templates/markdown.test.ts`

**Interfaces:**

- Produces: `export function parseTemplateMarkdown(markdown: string): TemplateSection[]` (une ligne `^#+\s*(.+)` ouvre une section ; les lignes suivantes, trimées, forment la `description`) et `export function templateSectionsToMarkdown(sections: TemplateSection[]): string`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, expect, it } from "vitest";

import { parseTemplateMarkdown, templateSectionsToMarkdown } from "./markdown";

describe("parseTemplateMarkdown", () => {
  it("découpe les sections sur les titres #", () => {
    expect(
      parseTemplateMarkdown(
        "# Participants\nListe les participants.\n\n## Décisions\nRésume les décisions.",
      ),
    ).toEqual([
      { title: "Participants", description: "Liste les participants." },
      { title: "Décisions", description: "Résume les décisions." },
    ]);
  });
  it("fusionne les lignes de consigne", () => {
    expect(parseTemplateMarkdown("# A\nligne 1\nligne 2")).toEqual([
      { title: "A", description: "ligne 1\nligne 2" },
    ]);
  });
  it("ignore le texte avant le premier titre", () => {
    expect(parseTemplateMarkdown("préambule\n# A\nx")).toEqual([
      { title: "A", description: "x" },
    ]);
  });
});

describe("templateSectionsToMarkdown", () => {
  it("est l'inverse du parseur", () => {
    const sections = [{ title: "Participants", description: "Liste." }];
    expect(parseTemplateMarkdown(templateSectionsToMarkdown(sections))).toEqual(
      sections,
    );
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `pnpm -F @syntheo/desktop test src/templates/markdown.test.ts` — Expected: FAIL (module absent).

- [ ] **Step 3: Implémenter** `markdown.ts`

```ts
import type { TemplateSection } from "@syntheo/store";

export function parseTemplateMarkdown(markdown: string): TemplateSection[] {
  const sections: TemplateSection[] = [];
  let current: TemplateSection | null = null;
  for (const rawLine of markdown.split("\n")) {
    const heading = rawLine.match(/^#+\s*(.+?)\s*$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1], description: "" };
      continue;
    }
    if (!current) continue;
    const line = rawLine.trim();
    if (line)
      current.description = current.description
        ? `${current.description}\n${line}`
        : line;
  }
  if (current) sections.push(current);
  return sections;
}

export function templateSectionsToMarkdown(
  sections: TemplateSection[],
): string {
  return sections
    .map(
      (section) =>
        `# ${section.title}${section.description ? `\n${section.description}` : ""}`,
    )
    .join("\n\n");
}
```

- [ ] **Step 4: Vérifier le succès** — Run: `pnpm -F @syntheo/desktop test src/templates/markdown.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit et PR** — `feat(templates): parseur markdown vers sections`, `Closes #N`.

---

### Task 3: Générateur de templates par IA

**Files:**

- Create: `apps/desktop/src/templates/generator.ts`
- Test: `apps/desktop/src/templates/generator.test.ts`

**Interfaces:**

- Consumes: `useLLMConnection` (`~/ai/hooks`), `parseTemplateMarkdown` (Task 2).
- Produces: `export const TEMPLATE_GEN_SYSTEM_PROMPT: string` ; `export const generatedTemplateSchema: z.ZodType<GeneratedTemplate>` où `GeneratedTemplate = { title; description; category; icon; sections: TemplateSection[] }` (sections 3..6) ; `export async function generateTemplate({ model, input, existingNote? }): Promise<GeneratedTemplate>` utilisant `generateObject` avec repli texte→`parseTemplateMarkdown`.

- [ ] **Step 1: Écrire les tests qui échouent** — mock de la fonction d'appel LLM ; vérifier (a) un JSON structuré produit un `GeneratedTemplate` valide, (b) un texte libre est reconstruit via le parseur Markdown, (c) un échec LLM est propagé proprement (`rejects`).

- [ ] **Step 2: Vérifier l'échec** — Run: `pnpm -F @syntheo/desktop test src/templates/generator.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implémenter** `generator.ts` : prompt système FR (reprendre `TEMPLATE_GEN_SYSTEM_PROMPT` de Syntheo, adapté aux sections), schéma zod `{ title: string, description: string, category: string, icon: string, sections: array({title, description}).min(3).max(6) }`, appel `generateObject({ model, schema, system, prompt })`, normalisation de l'icône via `normalizeTemplateIcon`, et repli : si `generateObject` échoue (modèle sans JSON structuré), demander un Markdown puis `parseTemplateMarkdown`.

- [ ] **Step 4: Vérifier le succès** — Run: `pnpm -F @syntheo/desktop test src/templates/generator.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit et PR** — `feat(templates): générateur de templates par IA`.

---

### Task 4: Bouton « Générer avec IA » dans le formulaire

**Files:**

- Modify: `apps/desktop/src/templates/template-form.tsx` (bouton + état de chargement + pré-remplissage)
- Modify/Test: `apps/desktop/src/templates/auto-form.test.tsx` ou nouveau `template-form.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue** : bouton désactivé quand `lnStatus() !== "connected"` ; au clic (LLM connecté, générateur mocké), le formulaire est pré-rempli (titre, catégorie, icône, sections).

- [ ] **Step 2: Vérifier l'échec** — Run: `pnpm -F @syntheo/desktop test src/templates/template-form.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implémenter** : bouton `✨ Générer avec IA` à côté des champs, un champ « Décris le type de réunion », appel `generateTemplate` puis injection des valeurs dans l'état du formulaire (mêmes setters que l'édition manuelle) ; aucune écriture directe en base.

- [ ] **Step 4: Vérifier le succès** — Run: `pnpm -F @syntheo/desktop test src/templates && pnpm -F @syntheo/desktop typecheck` — Expected: PASS.

- [ ] **Step 5: Commit et PR** — `feat(templates): génération de template depuis le formulaire`.

---

### Task 5: Vérification finale du lot 08

- [ ] `cargo test --locked -p db-app -p template-app` vert.
- [ ] `pnpm -F @syntheo/desktop typecheck` + Vitest complet verts.
- [ ] `pnpm exec dprint check` vert.
- [ ] Contrôle manuel : créer un template Syntheo, l'exporter en Markdown, le réimporter, et générer « comité de pilotage mensuel d'un projet SI » → 3 à 6 sections avec titre et icône.

## Notes de risque

- **Structure de `templates`** : la migration suppose les colonnes `pinned`, `pin_order`, `icon_json`, `targets_json` (présentes d'après `20260712170000_template_icons.sql` et `20260524000000_default_templates.sql`). Vérifier avec `crates/db-app/migrations/20260413020000_templates.sql`.
- **Compat données** : les 17 templates Anarlog sont traduits **sur place** (mêmes ids `default-*`) ; aucun risque de doublon, `INSERT OR IGNORE` pour les 4 Syntheo.
- **AI SDK v6** : `generateObject` et `zod` v4 sont déjà des dépendances du desktop ; utiliser l'API v6 (paramètre `schema`, pas `mode`).
