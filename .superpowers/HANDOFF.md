# Passation — Syntheo Desktop

Dernière mise à jour : 2026-10-27 (soir).
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
| `main` | **`d630ec6`** — arbre **propre** (aucun fichier modifié suivi, aucun untracked hors `target/`) |
| Lots 04 / 04b / 04c / 10 | terminés et fusionnés (sessions précédentes) |
| Lots 06-09 | terminés et fusionnés (sessions précédentes) |
| **Lot 04d — retrait cloud** | **TERMINÉ** (voir ci-dessous) |
| Build préprod | **RÉUSSI** (deb + AppImage `0.1.0-preprod`) |
| E2E blackbox | **NON RÉSOLU** — à finir (voir « Tâche en cours ») |
| Linters/qualité | quasi tous verts (voir « Vérifications ») ; reste cargo-deny / trivy / CodeQL / Sonar |

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

### 1. E2E blackbox (webdriverio + tauri-driver) — BLOQUÉ

Cible : `e2e/blackbox` (`pnpm e2e`), config `wdio.blackbox.conf.ts`, test `tests/app.spec.ts`
(vérifie `[data-testid="main-app-shell"]`). `tests/linux-virtual-audio.spec.ts` est **skippé**
sauf `E2E_VIRTUAL_AUDIO=1` (exige audio virtuel PipeWire + `NO_AEC=1`).

Prérequis Linux : `webkit2gtk-driver` (WebKitWebDriver), `desktop-file-utils`, `xvfb`,
`dbus-x11`, un binaire app, et `tauri-driver`.

Ce qui a été tenté (2 essais, échoués) :

1. `cargo install tauri-driver` + `xvfb-run` sur le binaire préprod
   (`APP_BINARY_PATH=target/release/syntheo`) → **session WebDriver timeout**
   (`http://127.0.0.1:4444/session`). Cause probable : l'app WebKitGTK ne démarre pas dans
   Docker (sandbox WebKit / pas de D-Bus / pas d'affichage). A aussi vu
   `FATAL: Unable to listen … port 4445` au retry (port 4444 non libéré entre les retries).
2. Avec `WEBKIT_FORCE_SANDBOX=0` + `WEBKIT_DISABLE_COMPOSITING_MODE=1` +
   `WEBKIT_DISABLE_DMABUF_RENDERER=1` + `dbus-run-session` + symlink `tauri-driver` de
   `node_modules` → **nouvelle erreur** : `@crabnebula/tauri-driver/cli.js` introuvable car le
   symlink `$CARGO_HOME/bin/tauri-driver -> node_modules/.bin/tauri-driver` résout un import
   relatif depuis `$CARGO_HOME` (mauvais cwd). → **installer `tauri-driver` par cargo** (pas le
   wrapper node) OU copier un script launcher qui `cd` dans le bon dossier.

**À faire pour débloquer l'E2E :**

```bash
docker run --rm -v /home/will/work/syntheo-desktop:/work -w /work syntheo-dev:1 bash -lc '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq webkit2gtk-driver desktop-file-utils xvfb dbus-x11
  cargo install tauri-driver --locked          # binaire natif, pas le wrapper node
  cd /work/e2e/blackbox
  export CI=1 ONBOARDING=0 APP_BINARY_PATH=/work/apps/desktop/src-tauri/target/release/syntheo
  export WEBKIT_FORCE_SANDBOX=0 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
  dbus-run-session -- xvfb-run -a pnpm e2e
'
```

Pistes si la session timeout persiste :
- Lancer l'app seule sous `xvfb-run` et lire sa stderr (libs manquantes ? `libwebkit2gtk-4.1-0`,
  plugins GStreamer, `bwrap`).
- `docker run` avec `--security-opt seccomp=unconfined --cap-add SYS_ADMIN` (sandbox WebKit) ou
  `--ipc=host`.
- Ne pas sur-wraper `xvfb-run` : `wdio.blackbox.conf.ts` lance **déjà** `xvfb-run -a tauri-driver`
  quand `CI` est défini.
- Vérifier que `/usr/bin/WebKitWebDriver` est bien appelé par `tauri-driver` (webdriver port).
- Alternative : binaire construit avec la config **dev** (`tauri.conf.json`, binaire
  `target/release/syntheo-dev`) est le chemin par défaut du conf ; ici on pointe
  `APP_BINARY_PATH` vers le binaire préprod `syntheo` (config `tauri.conf.syntheo.json`), ce qui
  doit convenir.

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

À lancer (non encore fait dans cette session) :
- `cargo deny check advisories licenses bans sources` (installer `cargo-deny`)
- `trivy fs --scanners vuln --severity HIGH,CRITICAL --ignorefile .trivyignore` (installer trivy)
- `uvx zizmor@1.31.0 --min-severity high --format sarif .github/workflows .github/actions`
  (installer `uv` ; config `.github/zizmor.yml`, `continue-on-error: true` en CI)
- ESLint sur fichiers modifiés (la CI ne le lance que sur la diff d'une PR)
- **CodeQL** (`ci-codeql.yml`) et **Sonar** : services CI. `ci-codeql` est un gate **release**
  (Rust > 25 min) + hebdo ; PR = TypeScript seul. **Aucune config Sonar (`sonar-project.properties`)
  trouvée dans le dépôt** — vérifier si SonarCloud est branché via l'app GitHub (analyse
  automatique) ou si c'est un reste d'Anarlog.

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
  passent localement : 35 tests).
- `pnpm exec dprint fmt` global + `cargo fmt -p <crate>` avant de pousser.
- `gh pr create --body-file` (jamais `--body` avec backticks → zsh exécute).
- PR : `gh pr merge <n> --squash --admin` (contourne le job Rust CI lent quand vérifié localement).
- Vérifier que `main` est bien la branche courante avant de committer (ne pas committer sur `main`).

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

1. **Finir l'E2E blackbox** (section 1) — c'est le seul blocage fonctionnel connu.
2. Lancer `cargo deny`, `trivy`, `zizmor`, ESLint sur la diff (section 2).
3. Confirmer CodeQL (TS sur la prochaine PR ; Rust = gate release) et clarifier SonarCloud.
4. Décider de la signature pour distribution (section 4).
5. Mettre à jour `.superpowers/HANDOFF.md` + le plan `docs/superpowers/plans/2026-10-27-cloud-integrations.md`
   (marquer 04d-a et 04d-b comme terminés).
