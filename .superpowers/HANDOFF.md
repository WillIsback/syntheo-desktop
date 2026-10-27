# Passation — Syntheo Desktop

Dernière mise à jour : 2026-10-27 (nuit) — E2E blackbox **résolu**, qualité **verte**.
Dépôt : `/home/will/work/syntheo-desktop` (GitHub `WillIsback/syntheo-desktop`, miroir
Forgejo `wderue/syntheo-desktop`). Fork d'Anarlog (MIT), historique neuf, jamais fusionné
vers l'amont.

## Règles non négociables

- Inférence **uniquement** via des endpoints on-premise standard (OpenAI-compatible, vLLM
  Realtime, NVIDIA NIM WS/gRPC). Aucun provider cloud.
- **Aucun audio écrit sur disque**, même temporairement.
- **Aucune télémétrie**, aucun compte, aucun paywall.
- Textes d'interface en **français d'abord**.
- Commits/PR en Conventional Commits ; PR avec issue (`Closes #N`), suffixe `[skip release]`.
- Un chantier = un plan écrit dans `docs/superpowers/plans/` **avant** d'exécuter.

## État au moment de la passation

| Élément | État |
|---|---|
| `main` | **`145eee2`** — arbre **propre** (aucun fichier modifié suivi, aucun untracked hors `target/`) |
| Lots 04 / 04b / 04c / 10 | terminés et fusionnés (sessions précédentes) |
| Lots 06-09 | terminés et fusionnés (sessions précédentes) |
| **Lot 04d — retrait cloud** | **TERMINÉ** (voir ci-dessous) |
| Build préprod | **RÉUSSI** (deb + AppImage `0.1.0-preprod`) ; binaire release reconstruit après #106 |
| E2E blackbox | **RÉSOLU** (PR #106) — `pnpm e2e` → `1 passing`, exit 0 |
| Linters/qualité | **VERTS** : cargo-deny / trivy / zizmor / CodeQL / Sonar / actionlint / ESLint |

### Lot 04d — « aux chiottes le cloud » (app 100 % locale)

Retrait complet de toutes les intégrations cloud non-inference. PR fusionnées :

| PR | Objet |
|---|---|
| #80, #82, #84, #86, #88 | messenger ; import cloud + calendrier cloud ; todo Linear/GitHub ; client d'API hébergée (Rust) ; SDK JS api-client |
| #90 | étapes cloud des automatisations (Slack/Notion/Linear/Drive) ; garde l'export Markdown local |
| #92 | **updater** (plugin Rust `updater2`, tray, toasts, devtools, configs, capacités) |
| #94 | mapping d'intégrations cloud de l'écran « instruction » |
| #96 | **04d-b 1/3** : sync cloud des pièces jointes (`attachment-sync-core`, `plugins/attachment-sync`) |
| #98 | **04d-b 2/2** : runtime de sync + réplique E2EE (`crates/cloudsync|db-sync|e2ee`, substrat `db-core`, runtime `plugins/db`, config `src-tauri`) |
| #100 | sync des catalogues i18n (rend `i18n:check` vert) |
| #102 | clippy : code mort (`session_deletion.rs`) + lints `desktop` |
| #104 | passation (docs) |
| #106 | **fix démarrage** : runtime de live-queries construit dans le réacteur Tokio (voir ci-dessous) + E2E blackbox vert |

Points clés du retrait :

- **Binding de workspace local** : `crates/db-app/src/lib.rs::ensure_local_workspace_binding`
  recrée la ligne `app_settings` `cloudsync_workspace_binding` (auparavant provisionnée par le
  module CloudSync). **Indispensable** : de nombreuses requêtes SQL chaudes
  (`legacy_import.rs`, `session_lifecycle_ops.rs`, `calendar_sync_ops.rs`, `contact_ops.rs`)
  lisent cette clé pour le `workspace_id`. Sans elle → `NOT NULL constraint failed: sessions.workspace_id`.
- **Migrations/tables/triggers E2EE laissés en place** (append-only), simplement dormants. Ne
  **jamais** supprimer/dropper sans migration `-- breaking` (risque données + compat stable/nightly).
- JS : helpers d'activité CloudSync conservés comme **no-ops** dans `plugins/db/js/index.ts`
  (`beginCloudsyncActivity`/`endCloudsyncActivity`) pour ne pas casser les appelants et tests
  `stt/*`. Plus aucun appel natif.
- `crates/audio-sync` et `crates/fs-sync-core` sont **locaux** (pas cloud) — conservés.
- **Correctif annexe** (#98) : bug ACL **pré-existant** depuis #59 — `plugins/dictation` listait
  `allow-discard-recording` sans commande → `cargo check -p desktop` échouait. Retiré.

## Tâche en cours : E2E blackbox + finalisation qualité

### 1. E2E blackbox (webdriverio + tauri-driver) — **RÉSOLU** (#106)

Cible : `e2e/blackbox` (`pnpm e2e`), config `wdio.blackbox.conf.ts`, test `tests/app.spec.ts`
(vérifie `[data-testid="main-app-shell"]`). `tests/linux-virtual-audio.spec.ts` est **skippé**
sauf `E2E_VIRTUAL_AUDIO=1` (exige audio virtuel PipeWire + `NO_AEC=1`).

**Cause réelle du « timeout WebDriver »** : l'app **panic au démarrage** —
`crates/db-reactive/src/runtime.rs:45` (`tokio::spawn` sans réacteur) via
`PluginDbRuntime::new` → `tauri::plugin::PluginStore::initialize_all` → `Builder::build`.
Le `setup` des plugins Tauri s'exécute synchroniquement sur le thread principal, **hors
réacteur Tokio** ; `LiveQueryRuntime::new` fait un `tokio::spawn` eager. Bug **latent depuis
l'import initial** (`f3a017e`), identique avant/après 04d (#98). **Correctif #106** : construire
le runtime dans `tauri::async_runtime::block_on` (helper `build_runtime` dans `plugins/db`),
+ test de régression `runtime_constructs_outside_async_context`.

**Second obstacle** : `linux-virtual-audio.spec.ts` ouvrait une 2ᵉ session WebDriver même
skippée ; le 2ᵉ `tauri-driver` ne pouvait pas rebinder 4444/4445 pendant la fermeture du 1ᵉʳ
→ exit 1 malgré le test vert. **Correctif #106** : `exclude` la suite tant que
`E2E_VIRTUAL_AUDIO != 1`.

Commande qui passe (**exit 0**) :
```bash
docker run --rm -v /home/will/work/syntheo-desktop:/work -w /work syntheo-dev:1 bash -lc '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq webkit2gtk-driver desktop-file-utils xvfb dbus-x11
  cargo install tauri-driver --locked          # binaire natif, pas le wrapper node
  cd /work/e2e/blackbox
  export CI=1 ONBOARDING=0 APP_BINARY_PATH=/work/apps/desktop/src-tauri/target/release/syntheo
  export WEBKIT_FORCE_SANDBOX=0 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
  dbus-run-session -- xvfb-run -a pnpm e2e    # → 1 passing ; E2E_EXIT_CODE=0
'
```
Résultat : `[wry 0.55 linux #0-0] ✓ launches and renders the main app shell` / `1 passing` /
`Spec Files: 1 passed, 1 total`.

Note : la suite audio virtuelle (`E2E_VIRTUAL_AUDIO=1`) reste **non validée** (exige PipeWire +
`NO_AEC=1`) ; elle relance 2 sessions et pourrait re-manifester le conflit de ports — à durcir
(kill du groupe de processus) si on l'active un jour.

### 2. Vérifications qualité — état

Vert :
- `cargo metadata --locked` ✅
- `cargo test --locked -p template-app -p db-app -p owhisper-client -p listener-core -p storage` ✅
- `cargo clippy --locked --no-deps -p db-app -p desktop --all-targets -- -D warnings` ✅ (après #102)
- `pnpm -F desktop typecheck` (tsc) ✅ · `pnpm -F ui build` ✅
- `pnpm exec oxlint --quiet --format=github apps/desktop/src/` → **0 erreur** (149 warnings tolérés)
- `pnpm -F desktop i18n:check` ✅ (après #100)
- Vitest complet : **397 fichiers / 3174 tests** ✅
- `python3 scripts/check_security_exceptions.py` ✅ · `actionlint` ✅
- **`cargo deny check advisories licenses bans sources`** ✅ (avec **cargo-deny 0.20.2** ;
  0.18.5 ne parse pas les avis CVSS 4.0). `advisories ok, bans ok, licenses ok, sources ok`
  (warnings `advisory-not-detected` sur des ignores devenus inutiles après 04b/04d : non bloquants).
- **`trivy fs --scanners vuln --severity HIGH,CRITICAL --ignorefile .trivyignore`** ✅ (v0.76.0) → 0 finding.
- **`uvx zizmor@1.31.0 --min-severity high`** ✅ → 0 finding.
- ESLint (CI = diff de PR) : la config **ignore** `e2e/**` → aucun souci introduit.
- **CodeQL** (`ci-codeql.yml`) : PR Rust-only → CodeQL Rust `skipping` ; PR avec `.ts` →
  CodeQL TS **pass**. Rust reste gate **release** (`workflow_call`) + hebdo + manuel.
- **SonarCloud** : `.sonarcloud.properties` existe → analyse **automatique via l'app GitHub**
  (`SonarCloud Code Analysis` **pass** sur #106). Pas de `sonar-project.properties` requis.

Pièges qualité connus :
- Clippy `--all-targets -p tauri-plugin-db` remonte un `dead_code` **pré-existant** sur des
  helpers `#[cfg(test)]` de `plugins/db/src/runtime.rs` (`pause_next_transaction_after_begin`,
  `wait_for_transaction_after_begin`) — jamais appelés. `plugins/*` n'étant pas linté en CI,
  non bloquant (à nettoyer si on veut `-D warnings` local sur ce crate).

Limpitations d'environnement :
- `dprint check` **échoue uniquement sur les fichiers Swift** (`crates/intercept/swift-lib`,
  `crates/dictation-ui-macos/swift-lib`, `crates/tcc/swift-lib`) : pas de formateur Swift sous
  Linux. La CI PR limite dprint à la diff, donc OK ; `pnpm fmt:check` global échouera toujours
  sur Linux (et probablement en CI `workflow_dispatch`). **Ne pas « corriger » en reformatant.**
- Clippy sur les **deps** (audio-device, plugins/windows, tray, icon, sfx…) produit des
  `dead_code` Unix/macOS pré-existants : non bloquants (`--no-deps`, et en CI `continue-on-error: true`).

### 3. Build préprod — FAIT (à refaire si besoin)

Artefacts produits (non suivis par git) :
```
apps/desktop/src-tauri/target/release/bundle/deb/Syntheo_0.1.0-preprod_amd64.deb
apps/desktop/src-tauri/target/release/bundle/appimage/Syntheo_0.1.0-preprod_amd64.AppImage
```
SHA256 :
```
54998929ff8690e0571329ba70ffb58ff00f7fd2f49f079f9f36e5cddaf74fe9  deb/Syntheo_0.1.0-preprod_amd64.deb
5e28f61c52bb405efed4e8e5e9f4b939489bc304c8832244b68a6504b4acef43  appimage/Syntheo_0.1.0-preprod_amd64.AppImage
```
Recette (identique `release.yml` build job, `VITE_API_URL` factice) :
```bash
docker run --rm -v /home/will/work/syntheo-desktop:/work -w /work syntheo-dev:1 bash -lc '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq libxdo-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev desktop-file-utils
  cd /work
  VERSION=0.1.0-preprod
  jq --arg v "$VERSION" ".version = \$v" apps/desktop/src-tauri/tauri.conf.syntheo.json > /tmp/c && mv /tmp/c apps/desktop/src-tauri/tauri.conf.syntheo.json
  pnpm -F ui build
  VITE_API_URL=http://127.0.0.1:9 pnpm -F desktop tauri build --ci --bundles deb,appimage --config ./src-tauri/tauri.conf.syntheo.json
'
# puis IMPORTANT : git checkout -- apps/desktop/src-tauri/tauri.conf.syntheo.json (version injectée non commitée)
```
Note : `--ci` désactive le mode interactif. ~7 min (release) + bundling.

⚠️ Les SHA256 ci-dessus datent **d'avant #106** (binaire qui paniquait au démarrage) :
**reconstruire les bundles** avant toute distribution. Le binaire release `target/release/syntheo`
a lui été reconstruit après #106 (recette `--no-bundle`, `VITE_API_URL` factice) et sert à l'E2E.

### 4. Signature pour distribution

`release.yml` publie deb+AppImage + SBOM sans étape de signature (l'updater a été retiré en
#92 → plus de minisign). Décider avec Will si une signature (cosign/GPG des artefacts, ou
signature de code macOS/Windows) est requise pour la distribution préprod ; sinon la section
« signature » est sans objet.

## Pièges déjà rencontrés (à ne pas revivre)

- **Conteneur = root** : il écrit des fichiers **root-owned** dans le dépôt (via `cargo fmt`,
  dprint, tests `export_types`, `i18n:compile`). Ensuite `git pull`/`git checkout` échouent
  (`Permission denied`) et `git` crie *dubious ownership*. **Remède systématique** :
  ```bash
  docker run --rm -v /home/will/work/syntheo-desktop:/work alpine:3 sh -c "chown -R $(id -u):$(id -g) /work"
  ```
  Et pour git dans le conteneur : `git config --global --add safe.directory /work`.
- **Ne jamais lancer un `edit` et un `git commit` dans le même message.**
- `git rm -f` requis si le fichier a des modifs locales (ex. après un sed).
- Après ajout/retrait d'une commande Tauri : régénérer bindings **et** permissions via le
  `codegen` du plugin (`cargo test -p tauri-plugin-<nom>`) ; supprimer aussi les fichiers
  `permissions/autogenerated/commands/*.toml` obsolètes (le build ne les efface pas) et
  `permissions/{autogenerated,schemas}` pour forcer une regénération propre.
- La CI `ci-code-quality (Rust)` ne teste que `template-app, db-app, owhisper-client,
  listener-core, storage`. `plugins/*` n'est **pas** testé en CI (les tests `plugins/db`
  passent localement : **36 tests**, dont le garde-fou de démarrage ajouté en #106).
- `pnpm exec dprint fmt` global + `cargo fmt -p <crate>` avant de pousser.
- `gh pr create --body-file` (jamais `--body` avec backticks → zsh exécute).
- PR : `gh pr merge <n> --squash --admin` (contourne le job Rust CI lent quand vérifié localement).
- Vérifier que `main` est bien la branche courante avant de committer (ne pas committer sur `main`).
- **Réacteur Tokio dans le `setup` d'un plugin Tauri** (#106) : le `setup` s'exécute sur le
  thread principal, **hors réacteur**. Tout `tokio::spawn` (direct, ou via un constructeur qui
  spawne) y **panic** (`there is no reactor running`). Utiliser `tauri::async_runtime::spawn`
  ou envelopper la construction dans `tauri::async_runtime::block_on`. Symptôme trompeur :
  l'E2E échoue en **timeout WebDriver** parce que l'app meurt avant d'ouvrir une fenêtre.

## Commandes utiles

```bash
# conteneur de build (image déjà construite)
docker run --rm -v /home/will/work/syntheo-desktop:/work -w /work syntheo-dev:1 bash -lc '…'
# conteneur desktop (tsc/vitest)
docker run --rm -v /home/will/work/syntheo-desktop:/work -w /work/apps/desktop syntheo-dev:1 bash -lc 'pnpm exec tsc --noEmit; pnpm exec vitest run'
# chown après chaque run conteneur
docker run --rm -v /home/will/work/syntheo-desktop:/work alpine:3 sh -c "chown -R 1000:1000 /work"
# PR
gh pr create --body-file /tmp/opencode/pr-body.md && gh pr merge <n> --squash --admin
```

Secrets : `bws` (Bitwarden EU). Jetons Forgejo/GitHub via `bws secret list`.

## Ordre suggéré pour la prochaine session

1. **Reconstruire les bundles préprod** (deb + AppImage) depuis `main` post-#106 — les SHA256 de
   la section 3 datent du binaire qui paniquait au démarrage.
2. **Décider de la signature** pour la distribution (section 4) : cosign/GPG des artefacts, ou
   signature de code macOS/Windows, ou rien pour la préprod.
3. Optionnel : durcir l'E2E audio virtuel (`E2E_VIRTUAL_AUDIO=1`, kill du groupe de processus)
   et nettoyer les entrées `deny.toml` devenues inutiles (`advisory-not-detected`).
4. Le seul blocage fonctionnel connu (démarrage) est corrigé ; la qualité et l'E2E sont verts.
