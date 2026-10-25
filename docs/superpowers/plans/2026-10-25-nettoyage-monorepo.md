# Nettoyage du monorepo (fin du 04d) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** le dépôt ne contient plus que le client desktop et ce qu'il utilise : les applications serveur, web, mobile, Stripe et watchOS d'Anarlog, ainsi que leurs packages et crates exclusifs, sont supprimés.

**Architecture :** suppression franche, guidée par le graphe de dépendances calculé avant le plan. Côté Rust, `cargo metadata` montre que 39 membres du workspace ne sont atteints ni depuis `apps/desktop/src-tauri` ni depuis `apps/cli`. Côté JS, le graphe des `package.json` montre que `apps/web`, `apps/mobile`, `apps/stripe`, `packages/supabase`, `packages/pricing` et `packages/mobile-bridge-rn` ne sont pas atteints depuis `apps/desktop`. Un test garde-fou Vitest, exécuté par la CI, échoue tant que ces dossiers existent ou que la configuration racine y fait référence. Ce lot débloque 04b : `apps/api` utilise `transcribe-proxy`, `llm-proxy` et `api-pyannote`, qui dépendent des adaptateurs STT cloud que 04b retire.

**Tech Stack :** Cargo workspace (Rust 1.94), pnpm 11 workspace, Vitest, conteneur `syntheo-dev:1`.

**Spec :** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md`, section « Projet, identité et dépôt » (« Les applications hors périmètre (`apps/web`, `apps/mobile`, `apps/api`, `apps/stripe` et leurs packages exclusifs) sont retirées dans le chantier 04d, une fois le graphe de dépendances vérifié ») et section « Intégrations cloud hors IA : retirées (chantier 04d) ».

**Ordre des lots (2026-10-25) :** 04d (ce plan, imposé par les dépendances), puis 04b (choisi par l'utilisateur avant 04c-B ; providers on-prem, en trois PR : adaptateurs STT cloud, inférence embarquée, providers LLM), puis 04c-B (audio temporaire de la dictée, de l'import et du batch, sur la surface réduite).

## Global Constraints

- « Suppression franche. Les modules retirés sont supprimés du code, avec leurs dépendances » (spec, phase 5) : pas de code commenté ni de feature flag.
- **Conservés**, bien que hors du graphe par défaut : `crates/audio-mock` (dépendance optionnelle de `desktop`, features `dev`/`devtools`), `crates/tcc` (dépendance optionnelle de `plugins/permissions`), `crates/chrome-native-host` (binaire construit par `cargo xtask prepare-binaries`), `crates/xtask`, `e2e/blackbox`, `packages/plugin-sdk`, `examples/plugins/hello-world`, tous les `plugins/*` (leurs paquets JS ne sont pas importés, mais leurs crates Rust le sont ; leur sort relève d'autres lots).
- Aucune modification du code de `apps/desktop` ni de `apps/cli` : si leur compilation casse, c'est que le graphe était faux. Arrêter et ledger la cause.
- Lockfiles régénérés, jamais édités à la main : `Cargo.lock` par `cargo metadata --format-version 1` (hors ligne si possible), `pnpm-lock.yaml` par `pnpm install` dans le conteneur.
- Tests et builds dans le conteneur `syntheo-dev:1`, formatage par `dprint` sur la liste des fichiers modifiés (calculée sur l'hôte), textes nouveaux en français.
- Les fichiers `plugins/*/js/bindings.gen.ts` régénérés par les builds ne sont jamais commités.

## Review Focus

- Dépendance optionnelle ou de dev non vue par `cargo metadata` sans features (comme `audio-mock`, `tcc`) : `cargo check --workspace --all-targets --all-features --locked` doit passer après suppression → étape de vérification de la Task 2.
- Script ou config racine qui pointe encore vers un dossier supprimé et casse un outil du quotidien (`pnpm dev`, `dprint fmt`, `eslint`, `task`) → assertions de références dans `monorepo-scope.test.ts` (Task 1), plus `pnpm exec dprint check` et `pnpm lint:eslint --max-warnings=0 apps/desktop/src/monorepo-scope.test.ts` en vérification.
- CI : un workflow qui construit ou teste un package supprimé → assertion « aucun workflow ne référence `apps/(web|mobile|api|stripe|watch)` » dans le test garde-fou (Task 1).
- Dependabot ou overrides pnpm qui ne correspondent plus à rien : sans effet bloquant ; laissés en l'état et notés (overrides) → pas de test, simple vérification visuelle de `pnpm install` sans erreur.
- Paquet JS supprimé encore importé par le desktop par un chemin relatif (hors `package.json`) → `pnpm -F desktop typecheck` et la suite Vitest complète en vérification de la Task 1.

---

### Task 1 : applications et packages JS hors périmètre, config racine

**Files :**

- Create : `apps/desktop/src/monorepo-scope.test.ts`
- Delete : `apps/web/`, `apps/mobile/`, `apps/stripe/`, `apps/watch/`, `packages/supabase/`, `packages/pricing/`, `packages/mobile-bridge-rn/`, `supabase/`, `process-compose.backend.yaml`, `doxxer.api.toml`, `doxxer.web.toml`, `.infisical.json`, `scripts/nango.sh`, `scripts/supabase-tunnel-start.sh`, `scripts/supabase-tunnel-stop.sh`, `scripts/update-apt-repository.mjs`, `scripts/update-apt-repository.test.mjs`, `scripts/verify-apt-repository.mjs`, `scripts/verify-apt-repository.test.mjs` (le dépôt APT vivait dans `apps/web/public/apt` ; Syntheo s'installe par installateurs et one-liners)
- Modify : `package.json` (script `dev` → `node scripts/dev.mjs desktop`, scripts `dev:web` et `dev:api` retirés ; devDependencies `supabase` et `@infisical/cli` retirées ; `allowBuilds` de `pnpm-workspace.yaml` : entrées `supabase` et `@infisical/cli` retirées), `turbo.json` (tâche `//#dev:web`), `process-compose.yaml` (processus `web`), `Taskfile.yaml` (include `web`, tâche `stripe`, toutes les tâches `supabase*` et celles qui lisent `DB_URL` depuis Supabase, lignes ~165-210), `dprint.json` (plugin de formatage MDX `apps/web/scripts/format-mdx.js`), `eslint.config.js` (glob `apps/web/**`), `scripts/dev.mjs` et `scripts/dev.test.mjs` (cibles `web`, `api` et `stack` → seule `desktop` reste ; usage : `node scripts/dev.mjs desktop`), `scripts/release-version.mjs` et `scripts/release-version.test.mjs` (versions mobile et watch retirées, seule la version desktop reste), `pnpm-lock.yaml` (régénéré)

**Interfaces :**

- Produces : `apps/desktop/src/monorepo-scope.test.ts` exporte rien ; la Task 2 y ajoute ses assertions Rust. Constante interne `REPO_ROOT = path.resolve(__dirname, "../../..")`.

- [ ] **Step 1 : test qui échoue** — `monorepo-scope.test.ts`, sur le modèle de `apps/desktop/src/no-audio-at-rest.test.ts` (lecture du disque via `node:fs`) :
  - `it("keeps_only_desktop_and_cli_apps")` : `readdirSync(apps)` filtré sur les dossiers vaut exactement `["cli", "desktop"]`.
  - `it.each(["packages/supabase", "packages/pricing", "packages/mobile-bridge-rn", "supabase", "process-compose.backend.yaml"])("removes %s")` : `existsSync` est faux.
  - `it("root_config_no_longer_references_removed_apps")` : aucun des fichiers `package.json`, `turbo.json`, `process-compose.yaml`, `Taskfile.yaml`, `dprint.json`, `eslint.config.js`, `scripts/dev.mjs`, `scripts/release-version.mjs` ne contient la regex `/apps\/(web|mobile|api|stripe|watch)\b|@anlg\/web\b|supabase/`.
  - `it("no_workflow_references_removed_apps")` : aucun fichier de `.github/workflows/` ne matche `/apps\/(web|mobile|api|stripe|watch)\b/`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/monorepo-scope.test.ts` → FAIL sur les trois premiers tests (le quatrième passe déjà : c'est attendu, il protège l'avenir).
- [ ] **Step 3 : supprimer et nettoyer** — `git rm -r` des dossiers et fichiers listés ; éditer les fichiers de config listés. `scripts/dev.mjs` ne garde que la cible `desktop` et son port `18081` ; `scripts/dev.test.mjs` perd les cas `stack`, `web`, `api`. `release-version.mjs` perd `readMobileReleaseVersion`, l'écriture de `apps/mobile/*` et de `Version.xcconfig`, et son test les cas correspondants. Puis `pnpm install` dans le conteneur (réseau requis) pour régénérer `pnpm-lock.yaml`.
- [ ] **Step 4 : vérifier** — `pnpm -F desktop exec vitest run src/monorepo-scope.test.ts` → PASS ; `pnpm -F desktop typecheck` → PASS ; `pnpm -F desktop test` → PASS (même nombre de fichiers de test qu'avant, plus un) ; `node --test scripts/dev.test.mjs scripts/release-version.test.mjs` → PASS ; `pnpm exec dprint check` → PASS ; `pnpm lint:eslint apps/desktop/src/monorepo-scope.test.ts` → 0 erreur.
- [ ] **Step 5 : commit** — `chore(monorepo): retrait des applications web, mobile, Stripe et watchOS`.

### Task 2 : serveur `apps/api` et crates exclusifs

**Files :**

- Delete : `apps/api/` et les crates `api-auth`, `api-calendar`, `api-cloud`, `api-crm`, `api-env`, `api-error`, `api-mail`, `api-meeting-import`, `api-messenger`, `api-nango`, `api-notion`, `api-pyannote`, `api-research`, `api-subscription`, `api-sync`, `api-ticket`, `api-zoom`, `exa`, `google-mail`, `jina`, `linear`, `llm-proxy`, `loops`, `mcp`, `meeting-capture`, `mobile-bridge`, `nango`, `pyannote-cloud`, `slack-web`, `supabase-auth`, `supabase-storage`, `transcribe-proxy`, `uniffi-bindgen`, `updater-core` (34 crates : les 39 membres non atteints, moins `apps/api` compté à part, `audio-mock`, `tcc`, `chrome-native-host` et `xtask`, conservés)
- Modify : `Cargo.toml` (membre `apps/api` et entrées `[workspace.dependencies]` des crates supprimés ; dépendances externes devenues orphelines retirées de `[workspace.dependencies]`), `crates/xtask/src/main.rs` (sous-commandes `mobile-bridge`, `supabase-patch` et `toml-set` retirées, avec `mobile_bridge.rs` et `toml_util.rs` ; seule `prepare-binaries` reste), `Cargo.lock` (régénéré), `apps/desktop/src/monorepo-scope.test.ts`

**Interfaces :**

- Consumes : `monorepo-scope.test.ts` (Task 1).
- Produces : workspace Cargo réduit, utilisé tel quel par 04b.

- [ ] **Step 1 : test qui échoue** — dans `monorepo-scope.test.ts` :
  - `it("cargo_workspace_has_no_server_member")` : `Cargo.toml` ne contient ni `"apps/api"` ni aucune des chaînes `crates/api-`, `crates/transcribe-proxy`, `crates/llm-proxy`, `crates/supabase-`, `crates/mobile-bridge`.
  - `it.each([<les 34 crates>])("removes crate %s")` : `existsSync(crates/<nom>)` est faux.
  - `it("keeps_optional_and_tooling_crates")` : `audio-mock`, `tcc`, `chrome-native-host`, `xtask` existent (protège contre une suppression trop large).
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/monorepo-scope.test.ts` → FAIL sur les deux premiers nouveaux tests, PASS sur le troisième.
- [ ] **Step 3 : supprimer** — `git rm -r` ; éditer `Cargo.toml` et `xtask`. Retirer de `[workspace.dependencies]` toute dépendance externe que plus aucun `Cargo.toml` restant n'utilise (vérification : `grep -rl "<dep>.workspace\|<dep> = { workspace" --include=Cargo.toml apps crates plugins`). Régénérer `Cargo.lock` via `cargo metadata --format-version 1 > /dev/null`.
- [ ] **Step 4 : vérifier** — `pnpm -F desktop exec vitest run src/monorepo-scope.test.ts` → PASS ; `cargo check --workspace --all-targets --all-features --locked` → PASS (features `dev`/`devtools` et `private-tcc` incluses) ; `cargo test --locked -p template-app -p db-app -p owhisper-client -p listener-core -p storage` → PASS (la commande de la CI) ; `cargo clippy --workspace --locked -- -D warnings` → PASS ; relancer `reach.py` sur une nouvelle `cargo metadata` : seuls `audio-mock`, `tcc`, `chrome-native-host`, `xtask` restent non atteints.
- [ ] **Step 5 : commit** — `chore(monorepo): retrait du serveur API et des crates qui ne servaient qu'à lui`.

### Task 3 : documentation

**Files :**

- Modify : `NOTICE.md` (section « Retiré » : applications web, mobile, Stripe, watchOS, serveur API, et la liste des crates et packages supprimés), `README.md`, `CONTRIBUTING.md` et `AGENTS.md` (s'ils mentionnent les applications retirées, `pnpm dev`, `dev:web` ou `dev:api`), `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (aucune modification ; l'ordre des lots est consigné dans ce plan)
- Test : `apps/desktop/src/monorepo-scope.test.ts`

- [ ] **Step 1 : test qui échoue** — `it("notice_lists_removed_apps")` : `NOTICE.md` contient `apps/api`, `apps/web`, `apps/mobile`, `apps/stripe` et `apps/watch`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/monorepo-scope.test.ts` → FAIL (`apps/watch` et `apps/stripe` absents de `NOTICE.md`).
- [ ] **Step 3 : rédiger** — compléter `NOTICE.md` ; corriger les mentions dans README, CONTRIBUTING et AGENTS (la commande de démarrage du dev devient `pnpm dev:desktop`, ou `node scripts/dev.mjs desktop` si le script racine `dev` est retiré). Si `scripts/ci/quickstart_test.sh` rejoue une section de `CONTRIBUTING.md` modifiée, la commande rejouée doit rester exécutable.
- [ ] **Step 4 : vérifier** — `pnpm -F desktop exec vitest run src/monorepo-scope.test.ts src/docs-rgpd.test.ts` → PASS ; `pnpm exec dprint check` → PASS.
- [ ] **Step 5 : commit** — `docs: NOTICE et guides à jour après le nettoyage du monorepo`.
