# Signature de code macOS / Windows — plan d'implémentation

> **Statut :** décision prise (Will, 2026-10-27) — la distribution **doit** avoir une signature de
> code macOS/Windows. Ce plan reste **à exécuter** pour la signature (secrets à fournir).
>
> **Avancement (2026-10-30) :** le build Windows **non signé** est en place
> (`.github/workflows/build-windows.yml`) et **publié** par `release.yml` (job `build-windows` :
> NSIS + MSI + `SHA256SUMS-windows`), avec un one-liner `scripts/install.ps1`. Reste : signature
> Windows (Task 2), signature/notarisation macOS (Task 1), extension aux stores.

**Goal:** produire des paquets **signés** macOS (Developer ID + notarisation) et Windows
(certificat de signature de code) depuis `release.yml`, en plus du deb/AppImage Linux.

**Architecture:** `release.yml` construit aujourd'hui **uniquement** Linux
(`runs-on: ubuntu-24.04`, `--bundles deb,appimage`). On ajoute des jobs `build-macos`
(`macos-latest`, matrice `aarch64-apple-darwin` + `x86_64-apple-darwin`) et `build-windows`
(`windows-latest`), on publie leurs artefacts, et on étend `publish` (attestations + upload)
et `notify-failure` en conséquence.

**Contexte app:**

- `bundle.macOS.entitlements` est **déjà** référencé (`./Entitlements.plist`) dans `tauri.conf.json`.
- Le code macOS existe (`crates/dictation-ui-macos`, `crates/intercept/swift-lib`, `crates/tcc/swift-lib`).
- **Prérequis déjà fait** : références macOS obsolètes retirées de `tauri.conf.json`
  (`bundle.macOS.frameworks` → dylib `crates/cloudsync` supprimé ; `bundle.macOS.files` →
  `resources/mlx.metallib` introuvable). Toutes les sources de bundle résolvent désormais.
- Cible `app-store` : build **hors** App Store (Developer ID) pour l'instant ; App Store = chantier séparé.

## Prérequis (à fournir par Will, stockés dans GitHub Secrets via `bws`)

**macOS**

- `APPLE_CERTIFICATE` — Developer ID Application `.p12` en base64 (`openssl base64 -A -in cert.p12`).
- `APPLE_CERTIFICATE_PASSWORD` — mot de passe d'export du `.p12`.
- `KEYCHAIN_PASSWORD` — mot de passe arbitraire pour le keychain temporaire de CI.
- Notarisation — **au choix** :
  - `APPLE_ID` + `APPLE_PASSWORD` (mot de passe d'application) + `APPLE_TEAM_ID`, **ou**
  - `APPLE_API_KEY` + `APPLE_API_ISSUER` (+ `API_PRIVATE_KEYS_DIR`/`APPLE_API_KEY_PATH`).
- Identité : `APPLE_SIGNING_IDENTITY` (déduite de `APPLE_CERTIFICATE`, peut être forcée).

**Windows** — **au choix** :

- **OV/EV pfx** : `WINDOWS_CERTIFICATE` (base64 `.pfx`) + `WINDOWS_CERTIFICATE_PASSWORD`, puis
  `bundle.windows.certificateThumbprint` (+ `digestAlgorithm: sha256`, `timestampUrl`), **ou**
- **Azure Trusted Signing** : `bundle.windows.signCommand` avec `artifact-signing-cli`
  (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`).

> Renseigner les secrets dans `bws` puis les pousser via `gh secret set`. Ne jamais committer de
> certificat/mot de passe.

## Global Constraints

- Aucun secret dans le dépôt ; tout via GitHub Secrets.
- `release.yml` doit rester un gate release ; ne pas affaiblir les vérifications existantes.
- Conventional Commits ; PR `Closes #N` + `[skip release]` (désormais fiable : squash = PR_TITLE).
- Chaque job plateforme doit publier ses artefacts et être couvert par l'attestation de provenance.

## Review Focus

- Les paquets macOS sont **notariés** (Gatekeeper OK) et Windows signés (pas d'avertissement SmartScreen).
- Un échec de signature **échoue** le job (pas de paquet non signé publié silencieusement).
- Linux (deb/AppImage) inchangé.

---

### Task 1: macOS — build signé + notarié (Developer ID)

**Files:** `.github/workflows/release.yml` (nouveau job `build-macos`), éventuellement
`apps/desktop/src-tauri/Entitlements.plist` (durcissement/hardened runtime).

- [ ] **Step 1: Config bundle** — vérifier `bundle.macOS` (`minimumSystemVersion`, `entitlements`,
      `signingIdentity` déduite). Rien à committer si `APPLE_SIGNING_IDENTITY` est en env.
- [ ] **Step 2: Job `build-macos`** (matrice arch) : import keychain (voir doc Tauri
      `distribute/sign/macos`), puis
      `pnpm -F desktop tauri build --ci --bundles app,dmg --target <triple> --config ./src-tauri/tauri.conf.syntheo.json`
      avec `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`
      (ou API key), `KEYCHAIN_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `VITE_API_URL` factice.
- [ ] **Step 3: Artefacts** — collecter `*.dmg` (+ `*.app` zippé si utile), `sha256sum`, upload
      `syntheo-desktop-macos-<arch>`.
- [ ] **Step 4: Vérifier localement** (si un Mac est dispo) : `spctl -a -vvv -t install Syntheo.app`
      et `xcrun stapler validate Syntheo.dmg`.

### Task 2: Windows — build signé (OV/EV ou Azure Trusted Signing)

**Files:** `.github/workflows/release.yml` (nouveau job `build-windows`),
`apps/desktop/src-tauri/tauri.conf.syntheo.json` (bloc `bundle.windows` si thumbprint/OV).

- [ ] **Step 1: Import du certificat** — étape `Import-PfxCertificate` (doc Tauri
      `distribute/sign/windows`) ou `artifact-signing-cli` pour Azure.
- [ ] **Step 2: Job `build-windows`** : `tauri build --ci --bundles nsis,msi` (avec le même
      `--config`), `VITE_API_URL` factice.
- [ ] **Step 3: Artefacts** — collecter `*.msi`/`*-setup.exe`, `sha256sum`, upload
      `syntheo-desktop-windows`.
- [ ] **Step 4: Vérifier** : `Get-AuthenticodeSignature` sur l'installeur → `Status: Valid`.

### Task 3: Intégrer au pipeline de release

**Files:** `.github/workflows/release.yml`.

- [x] **Step 1 (Windows) :** `publish.needs += [build-windows]` ; téléchargement de l'artefact
      `syntheo-desktop-windows-unsigned`. *(macOS : à faire.)*
- [x] **Step 2 :** `attest-build-provenance.subject-path` étendu (`msi`/`exe`/`dmg`) ; l'upload
      `gh release create dist/*` publie déjà les nouveaux artefacts.
- [x] **Step 3 :** `notify-failure` étendu (statut du job `build-windows`).
- [ ] **Step 4:** run de validation `workflow_dispatch` en `dry_run: true`.

### Task 4: Documentation

- [ ] Mettre à jour `.superpowers/HANDOFF.md` (section 4) et `docs/` si une page
      d'installation mentionne les canaux mac/win.

## Décisions ouvertes (à trancher avec Will)

1. Notarisation Apple : **Apple ID + mot de passe d'app** (simple) ou **clé API** (recommandé CI) ?
2. Windows : **OV/EV pfx maison** ou **Azure Trusted Signing** (pas de certificat à gérer) ?
3. Architectures macOS : **universal** (un `.app`) ou **deux DMG** (arm64 + x64) ?
4. Publier aussi sur l'App Store / Microsoft Store plus tard ? (hors périmètre ici)
