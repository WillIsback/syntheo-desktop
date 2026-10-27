# E2E blackbox desktop — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire passer le test E2E blackbox (`e2e/blackbox`, webdriverio + tauri-driver) : l'application doit démarrer et rendre `[data-testid="main-app-shell"]` sous Xvfb/WebKitWebDriver.

**Architecture:** Le test pilote le binaire Tauri via `tauri-driver` (WebDriver sur 127.0.0.1:4444, WebKitWebDriver en amont). `wdio.blackbox.conf.ts` lance `xvfb-run -a tauri-driver` quand `CI` est défini. Le binaire ciblé est `apps/desktop/src-tauri/target/release/syntheo` (`APP_BINARY_PATH`).

**Tech Stack:** Rust (Tauri 2), webdriverio, tauri-driver, WebKitWebDriver, Xvfb, dbus.

## Contexte / diagnostic

Le premier essai échouait sur `POST /session` (timeout) — présenté comme un problème d'environnement Docker. En capturant la stderr de l'app sous Xvfb, la vraie cause est un **panic au démarrage** :

```
thread 'main' panicked at crates/db-reactive/src/runtime.rs:45:26:
there is no reactor running, must be called from the context of a Tokio 1.x runtime
  ... tauri_plugin_db::runtime::PluginDbRuntime::new
  ... <tauri::plugin::TauriPlugin as tauri::plugin::Plugin>::initialize
  ... tauri::plugin::PluginStore::initialize_all
  ... tauri::app::Builder::build
```

`PluginDbRuntime::new` (appelé depuis le `setup` du plugin `db`) construit `LiveQueryRuntime::new`, qui fait **eagerly** `tokio::spawn` du dispatcher de live-queries. Or le `setup` des plugins Tauri s'exécute **synchroniquement sur le thread principal** depuis `Builder::build`, **sans réacteur Tokio entré** (le runtime vit dans `tauri::async_runtime::set`, jamais entré sur ce thread). Le panic avorte le démarrage → aucune fenêtre → timeout WebDriver.

Bug latent depuis l'import initial (`f3a017e`) : identique avant/après le lot 04d (`#98`).

## Global Constraints

- Ne pas entrer le runtime Tokio sur le thread principal au-delà du strict nécessaire (le `setup` du plugin single-instance utilise zbus en bloquant et panique si le thread est déjà dans un runtime — cf. commentaire de `main()`).
- Un chantier = Conventional Commits ; PR `Closes #N` + `[skip release]`.

## Review Focus

- L'app démarre sans panic ; `[data-testid="main-app-shell"]` est rendu.
- Aucun audio sur disque, aucune télémétrie (inchangé).
- Le dispatcher de live-queries fonctionne toujours (les tests `db-reactive` et `plugins/db` restent verts).

---

### Task 1: Réparer le démarrage (réacteur Tokio manquant à la construction du runtime db)

**Files:**

- Modify: `plugins/db/src/lib.rs`

- [x] **Step 1: Reproduire et confirmer le callpath**

Run (conteneur) : binaire release sous `xvfb-run` + `RUST_BACKTRACE=1`.
Expected : panic à `crates/db-reactive/src/runtime.rs:45` via `PluginDbRuntime::new` → `Builder::build`.

- [x] **Step 2: Construire le runtime dans `tauri::async_runtime::block_on`**

Extraire un helper `build_runtime(db)` qui enveloppe `PluginDbRuntime::new` dans `tauri::async_runtime::block_on(async { ... })`, entrant ainsi le réacteur Tauri **le temps de la construction** (spawn du dispatcher), sans le laisser entré sur le thread principal.

- [x] **Step 3: Test de régression**

Ajouter dans `plugins/db/src/lib.rs` : `runtime_constructs_outside_async_context` (plain `#[test]`, hors réacteur) qui construit le runtime via `build_runtime`. Échouait avant le correctif, passe après.

Run: `cargo test --locked -p tauri-plugin-db`
Expected: 36 passed (35 + 1).

- [x] **Step 4: Rebuild release + E2E blackbox vert**

Run (conteneur) :
`WEBKIT_FORCE_SANDBOX=0 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 dbus-run-session -- xvfb-run -a pnpm e2e`
Expected: `1 passing` (app.spec.ts).

- [x] **Step 5: Commit et PR** — `fix(db): démarre le runtime de live-queries dans le réacteur Tokio` (PR #106, `Closes #105`, `[skip release]`).

---

### Task 2: Vérifications qualité restantes (lot finalisation)

- [x] `cargo deny check advisories licenses bans sources` (v0.20.2) → `advisories ok, bans ok, licenses ok, sources ok`.
- [x] `trivy fs --scanners vuln --severity HIGH,CRITICAL --ignorefile .trivyignore` (v0.76.0) → 0 findings.
- [x] `uvx zizmor@1.31.0 --min-severity high` → 0 findings.
- [x] `actionlint` → clean ; `scripts/check_security_exceptions.py` → valide.
- [x] CodeQL : PR Rust-only → analyse TS non déclenchée ; Rust reste gate release/hebdo.
- [x] SonarCloud : `.sonarcloud.properties` présent → analyse automatique via l'app GitHub (pas de `sonar-project.properties` nécessaire).
