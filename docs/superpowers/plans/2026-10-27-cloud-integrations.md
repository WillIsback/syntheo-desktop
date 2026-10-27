# Retrait des intégrations cloud — plan d'implémentation (lot 04d-a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer du dépôt toutes les intégrations cloud **hors inférence** : calendriers distants, import de réunions cloud, messagerie, tickets, CRM, updater, facturation — en ne conservant que le local (SQLite, recherche, dossiers, dictée, Apple Calendar/Reminders, MCP local, export).

**Architecture:** Le code cloud restant est **mort à l'exécution** (les gardes 04b/04d partielles le neutralisent déjà : `no-cloud-imports.test.ts`, `automations/engine.ts` `CLOUD_STEP_REMOVED_MESSAGE`, `plugins/todo` `require_access_token` en erreur). On le supprime donc franchement (crates, plugins, code desktop, dépendances), en gardant les migrations SQLite (règle append-only) et les intégrations **locales** (Apple Calendar/Reminders, `crates/summary`, `crates/host`, `agent-access`, `plugins/{fs-sync,local-auth,mcp,local-api,session,template,agent}`).

**Hors périmètre (lot 04d-b, plan ultérieur)** : `cloudsync`, `db-sync`, `e2ee`, `attachment-sync-core`, `plugins/attachment-sync`, le runtime CloudSync de `plugins/db` et `crates/db-core`, `session-ingest` — entremêlés au schéma SQLite et aux migrations (blast radius élevé, à faire en dernier).

**Tech Stack:** Rust (Cargo workspace), Tauri 2 (plugins + capabilities), React 19/TypeScript, Vitest, Lingui.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (section « Intégrations cloud hors IA : retirées (chantier 04d) »).

## Global Constraints

- Aucun provider cloud, aucun compte, aucune télémétrie ; inférence on-prem uniquement.
- **Ne pas supprimer les migrations SQLite** (append-only) : les tables désactivées restent ; on retire la **politique** et le **runtime**, pas le SQL livré.
- Conserver les intégrations **locales** (Apple Calendar/Reminders, MCP local, fs-sync, export).
- Les détections locales qui mentionnent `zoom.us`/`slack`/`teams` (détection de réunion, parsing de liens de calendrier) sont **locales** : ne pas les retirer.
- Après retrait d'un plugin/commande Tauri : régénérer bindings **et** capabilities (`apps/desktop/src-tauri/capabilities/default.json`, `plugins/<name>/permissions`).
- `pnpm exec dprint fmt` (global) avant de pousser ; Conventional Commits ; PR `Closes #N` + `[skip release]`.

## Review Focus

- Aucune référence résiduelle aux fournisseurs cloud retirés → `rg` de vérification (Task 8).
- Les gardes existantes (`no-cloud-imports.test.ts`, `llm-on-prem.test.ts`) restent vertes.
- L'app démarre et fonctionne en local (onboarding, session, réglages, Apple Calendar/Reminders sur macOS) — contrôle manuel.
- `cargo metadata --locked` + `cargo test` des crates CI verts.

---

### Task 1: Retirer `plugins/messenger` (stub) et `plugins/importer` (imports cloud)

**Files:**

- Delete: `plugins/messenger/`, `plugins/importer/`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (retirer les init `messenger:212`, `importer:180`)
- Modify: `apps/desktop/src-tauri/capabilities/default.json` (retirer `messenger:default`, `importer:default`)
- Modify: `Cargo.toml` (retirer les alias de workspace `syntheo-plugin-messenger`, `syntheo-plugin-importer`)
- Modify: `apps/desktop/package.json` (retirer `@syntheo/plugin-messenger`, `@syntheo/plugin-importer`)
- Modify: `apps/desktop/src/imports/providers.ts` (retirer le catalogue cloud Nango/OAuth ; ne garder que l'import de **fichiers locaux**)
- Delete (si plus référencés) : `crates/meeting-import/`, `crates/zoom/`

- [ ] **Step 1: Confirmer les références**

Run: `rg -n "plugin-messenger|plugin-importer|messenger::|importer::|meeting-import|syntheo-zoom" apps plugins crates Cargo.toml --glob '!**/target/**' | head -40`
Expected: les init/alias/JS ci-dessus, plus `plugins/importer` → `meeting-import`/`zoom`.

- [ ] **Step 2: Supprimer**

```bash
git rm -r plugins/messenger plugins/importer crates/meeting-import crates/zoom
```

Retirer les alias de `Cargo.toml`, les dépendances de `apps/desktop/package.json`, les init dans `lib.rs`, les permissions dans `capabilities/default.json`. Dans `imports/providers.ts`, ne conserver que les fournisseurs d'**import de fichiers** locaux.

- [ ] **Step 3: Vérifier**

Run: `cargo metadata --format-version 1 > /dev/null && cargo check -p desktop 2>&1 | tail -5`
Expected: échec attendu de `-p desktop` (onnxruntime absent, cf. plan 06) ; `cargo metadata` OK. Puis `pnpm -F @syntheo/desktop typecheck`.

- [ ] **Step 4: Commit et PR** — `refactor(cloud): retire les plugins messenger et importer`.

---

### Task 2: Retirer `plugins/todo` (Linear/GitHub) en gardant Apple Reminders

**Files:**

- Modify: `plugins/todo/src/commands.rs` (retirer les branches Linear/GitHub/API, garder Apple), `src/{fetch.rs,read_path.rs,github_state.rs}`
- Modify: `crates/github-issues/` (Delete), `crates/ticket-interface/` (Delete)
- Modify: `crates/api-client/` (voir Task 4)

- [ ] **Step 1: Confirmer** — `rg -n "github-issues|ticket-interface|linear|github" plugins/todo crates/api-client --glob '!**/target/**' | head`
- [ ] **Step 2: Supprimer** les branches cloud de `plugins/todo` et les crates `github-issues`, `ticket-interface`.
- [ ] **Step 3: Vérifier** — `cargo test --locked -p tauri-plugin-todo` (ou le nom réel) vert ; `typecheck`.
- [ ] **Step 4: Commit et PR** — `refactor(cloud): retire les intégrations Linear/GitHub de todo`.

---

### Task 3: Retirer les calendriers distants (Google, Outlook) en gardant Apple Calendar

**Files:**

- Delete: `crates/google-calendar/`, `crates/outlook-calendar/`
- Modify: `crates/calendar-interface/` (retirer les variantes Google/Outlook de l'enum fournisseur)
- Modify: `crates/calendar/src/lib.rs:36-48` (retirer les providers Google/Outlook), `src/fetch.rs`, `src/runtime.rs`
- Modify: `plugins/calendar/src/{lib.rs,commands.rs,fetch.rs,storage/connection_sync.rs}` (retirer les commandes de connexion distante)
- Modify: `apps/desktop/src/calendar/**` (retirer la sélection de fournisseur Google/Outlook)
- Test: `apps/desktop/src/calendar/**/*.test.*`, `crates/calendar/**`

- [ ] **Step 1: Confirmer** — `rg -n "google-calendar|outlook-calendar|GoogleCalendar|OutlookCalendar" crates plugins apps --glob '!**/target/**' | head -30`
- [ ] **Step 2: Supprimer** les crates et les branches provider ; ne garder qu'Apple Calendar (EventKit).
- [ ] **Step 3: Vérifier** — `cargo test --locked -p calendar -p tauri-plugin-calendar` vert ; `typecheck`.
- [ ] **Step 4: Commit et PR** — `refactor(cloud): retire les calendriers Google et Outlook`.

---

### Task 4: Retirer le client d'API hébergée (`api-client`)

**Files:**

- Delete: `crates/api-client/`, `crates/progenitor-utils/`, `packages/api-client/`
- Modify: `Cargo.toml` (alias `syntheo-api-client`), `apps/desktop/package.json` (`@syntheo/api-client`)
- Modify: tout consommateur restant (`crates/calendar`, `plugins/todo` — déjà nettoyés en Tasks 2/3) ; `apps/desktop/src/automations/engine.test.ts` (mock `@syntheo/api-client` à retirer)

- [ ] **Step 1: Confirmer** — `rg -n "api-client|progenitor-utils" --glob '!**/target/**' | head -30`
- [ ] **Step 2: Supprimer** et retirer les dépendances.
- [ ] **Step 3: Vérifier** — `cargo metadata --locked > /dev/null` ; `pnpm install` ; `pnpm -F @syntheo/desktop typecheck`.
- [ ] **Step 4: Commit et PR** — `refactor(cloud): retire le client d'API hébergée`.

---

### Task 5: Retirer les étapes cloud des automatisations

**Files:**

- Modify: `apps/desktop/src/automations/{workflows.ts,engine.ts,starters.tsx}`
- Modify: `apps/desktop/src/settings/schema.ts` (retirer les clés `automation_slack_recap_*`, `automation_notion_*`, `automation_linear_*`, `automation_google_drive_*`)
- Test: `apps/desktop/src/automations/*.test.*`

- [ ] **Step 1: Confirmer** — `rg -n "slack_recap|notion_update|linear_issues|google_drive_export|CLOUD_STEP_REMOVED" apps/desktop/src | head`
- [ ] **Step 2: Supprimer** les types/étapes cloud (déjà morts à l'exécution) et les clés de réglages associées.
- [ ] **Step 3: Vérifier** — `pnpm -F @syntheo/desktop test src/automations` + `typecheck`.
- [ ] **Step 4: Commit et PR** — `refactor(cloud): retire les étapes cloud des automatisations`.

---

### Task 6: Retirer la facturation et le gating « plan »

**Files:**

- Delete: `apps/desktop/src/billing/`, `apps/desktop/src/settings/plan-gate.tsx` (+ test)
- Modify: les consommateurs (`useBillingAccess`, `useNotifyPlanRequired`) pour retirer le gating (tout est déverrouillé localement, cf. lot 03)
- Modify: `apps/desktop/src/settings/developers/api-key-row.tsx` (supprimer si inutilisé) et mocks périmés dans `settings/developers/index.test.tsx`

- [ ] **Step 1: Confirmer** — `rg -n "useBillingAccess|useNotifyPlanRequired|plan-gate|api-key-row" apps/desktop/src | head`
- [ ] **Step 2: Supprimer** le sous-système billing et le gating.
- [ ] **Step 3: Vérifier** — `pnpm -F @syntheo/desktop test src/settings src/billing 2>/dev/null; pnpm -F @syntheo/desktop typecheck`.
- [ ] **Step 4: Commit et PR** — `refactor(billing): retire le gating et le sous-système de facturation`.

---

### Task 7: Retirer l'updater Tauri et `plugins/relay`

**Files:**

- Delete: `plugins/updater2/` (et `plugins/updater` s'il existe)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (init updater), `apps/desktop/src-tauri/tauri.conf.json` + `tauri.conf.syntheo.json` (bloc `plugins.updater`), `capabilities/default.json` (perms `updater*`)
- Modify: `plugins/relay/` (retirer si dev-only non indispensable) + `apps/desktop/src-tauri/src/lib.rs:259`
- Modify: `apps/desktop/src/env.ts`, `apps/desktop/src/main/lifecycle.tsx` (si updater utilisé côté JS)

- [ ] **Step 1: Confirmer** — `rg -n "updater|relay" apps/desktop/src-tauri apps/desktop/src plugins --glob '!**/target/**' | head -30`
- [ ] **Step 2: Supprimer** ; les mises à jour passent par les GitHub Releases (aucun updater dans l'app).
- [ ] **Step 3: Vérifier** — `pnpm -F @syntheo/desktop typecheck` ; `cargo metadata`.
- [ ] **Step 4: Commit et PR** — `refactor(cloud): retire l'updater Tauri et le relay de dev`.

---

### Task 8: Vérification finale du lot 04d-a

- [ ] `rg -n "supabase|nango|googleapis|notion|loops|linear|fathom|fireflies|circleback|granola" apps crates plugins packages --glob '!**/target/**' --glob '!**/*.md'` : ne doit rester que des détections/parsing locaux ou des commentaires justifiés.
- [ ] `rg -n "plugin-messenger|plugin-importer|plugin-todo|plugin-calendar|plugin-updater|api-client" apps/desktop/package.json Cargo.toml` : vide pour les éléments retirés.
- [ ] `cargo test --locked -p template-app -p db-app -p owhisper-client -p listener-core -p storage` vert.
- [ ] `pnpm -F @syntheo/desktop typecheck` + Vitest complet verts ; `pnpm exec dprint check` vert.
- [ ] Les gardes `no-cloud-imports.test.ts` et `llm-on-prem.test.ts` restent vertes.
- [ ] Contrôle manuel : onboarding, session, réglages, Apple Calendar/Reminders (macOS) fonctionnent sans les intégrations retirées.

## Suite (lot 04d-b — plan séparé)

`cloudsync`, `db-sync`, `e2ee`, `attachment-sync-core`, `plugins/attachment-sync`, le runtime CloudSync de `plugins/db`/`crates/db-core`, `session-ingest`, et les migrations/triggers associés. Blast radius élevé (schéma SQLite, dylib native, capabilities, `plugins/db` always-on) : à traiter dans un plan dédié, en gardant les fichiers de migration en place (append-only).
