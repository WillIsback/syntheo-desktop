# Identité Syntheo et débranchement de Fastrepl — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'app se construit, s'installe et tourne sous l'identité Syntheo (nom, identifiants, dossier de données, icônes), sans paywall et sans télémétrie : chantiers 01, 02, 03 et 04 du plan de migration.

**Architecture:** Une crate `brand` porte les constantes d'identité côté Rust ; les endroits codés en dur (bundle ids, nom produit, dossier de données) la consomment. Le paywall est neutralisé par un fournisseur de facturation local et statique qui remplace `BillingProvider`. La télémétrie (PostHog Rust, Sentry Rust et JS) est désactivée à la source : plus aucune lecture de clé ni de DSN. Les suppressions complètes (auth, sync, plugins analytics/sentry) relèvent du chantier 04d, plan séparé.

**Tech Stack:** Rust 1.94 (workspace Cargo, Tauri 2.11), TypeScript/React 19, Vitest 5, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (sections « Projet, identité et dépôt », tableau des chantiers 01 à 04, Phase 2).

## Global Constraints

- Identifiant stable : `fr.willisback.syntheo` ; dev : `fr.willisback.syntheo.dev`.
- Nom produit : `Syntheo` (dev : `Syntheo Dev`) ; binaire : `syntheo` (dev : `syntheo-dev`) ; schéma deep-link : `syntheo` (dev : `syntheo-dev`).
- Dossier de données en release : `<data_dir>/syntheo`, jamais `anarlog` ni `hyprnote` (pas de migration depuis Anarlog).
- Updater désactivé ; seules les configurations Tauri `tauri.conf.json` (dev) et `tauri.conf.syntheo.json` (release) subsistent.
- Aucune télémétrie, aucun compte requis, aucune fonctionnalité verrouillée « Pro ».
- Une PR par tâche, titre Conventional Commits, corps avec `Closes #N` (issue créée au début de la tâche) ; gates de PR au vert avant fusion (auto-merge).
- Texte d'interface en français quand il est touché ; les chaînes Lingui restent au chantier 06.

## Review Focus

- Une installation d'Anarlog existe sur le même poste (`~/.local/share/anarlog` ou `hyprnote` peuplé) : Syntheo doit utiliser `syntheo` et ne jamais lire ces dossiers → test `resolve_app_folder_ignores_existing_anarlog_data` (Task 1).
- Build de dev à côté d'un Anarlog de dev (`com.hyprnote.dev`) : dossiers et canal distincts → test `get_channel_maps_syntheo_identifiers` (Task 1).
- Quelqu'un construit avec `POSTHOG_API_KEY` ou `SENTRY_DSN` définis dans l'environnement : aucune télémétrie ne doit s'activer → test `default_client_has_no_remote_sink` + vérification `rg` (Task 4).
- Utilisateur hors ligne, sans compte : les réglages « Pro » (dictée, dictionnaire, automatisations) sont utilisables → test `pro_settings_are_usable_without_session` (Task 3).
- Lien `anarlog://` ouvert alors que les deux apps sont installées : il ne doit pas viser Syntheo → vérification des schémas (Task 2).

---

### Task 1: Crate `brand` et identifiants (chantier 01)

**Files:**

- Create: `crates/brand/Cargo.toml`, `crates/brand/src/lib.rs`
- Modify: `Cargo.toml` (membres + `[workspace.dependencies] brand = { path = "crates/brand" }`)
- Modify: `crates/storage/src/global.rs:3-31` et ses tests (l. 40+)
- Modify: `plugins/tray/src/menu_items/tray_version.rs:11-23`
- Modify (remplacer les bundle ids et noms Anarlog stables/dev par les constantes) : `apps/desktop/src-tauri/src/{startup.rs,embedded_cli.rs,db.rs,lib.rs,commands.rs}`, `plugins/{store2,detect,tracing,sidecar2,js}/src/**`, `crates/detect/src/list/mod.rs`, `crates/notification-linux/src/{ui.rs,icon.rs}`, `apps/desktop/src/shared/utils.ts`, `apps/desktop/src/shared/theme/provider.tsx`, `apps/desktop/src/settings/appearance/app-icon.tsx`
- Test: `crates/storage/src/global.rs` (module tests), `plugins/tray/src/menu_items/tray_version.rs` (nouveau module tests)

**Interfaces:**

- Produces (`brand`) : `pub const PRODUCT_NAME: &str = "Syntheo";`, `pub const STABLE_BUNDLE_ID: &str = "fr.willisback.syntheo";`, `pub const DEV_BUNDLE_ID: &str = "fr.willisback.syntheo.dev";`, `pub const APP_DATA_FOLDER: &str = "syntheo";`, `pub const CLI_COMMAND: &str = "syntheo";`. Côté TS, `apps/desktop/src/shared/utils.ts` expose les mêmes valeurs d'identifiant (constantes existantes renommées, pas de nouveau module).

- [ ] **Step 1: Écrire les tests qui échouent**

```rust
// crates/storage/src/global.rs
#[test]
fn resolve_app_folder_uses_syntheo_for_release() {
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(
        resolve_app_folder(temp.path(), brand::STABLE_BUNDLE_ID, false),
        "syntheo"
    );
}
#[test]
fn resolve_app_folder_ignores_existing_anarlog_data() {
    let temp = tempfile::tempdir().unwrap();
    for legacy in ["anarlog", "hyprnote"] {
        std::fs::create_dir_all(temp.path().join(legacy)).unwrap();
        std::fs::write(temp.path().join(legacy).join("app.db"), b"x").unwrap();
    }
    assert_eq!(
        resolve_app_folder(temp.path(), brand::STABLE_BUNDLE_ID, false),
        "syntheo"
    );
}
#[test]
fn resolve_app_folder_uses_bundle_id_in_debug() {
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(
        resolve_app_folder(temp.path(), brand::DEV_BUNDLE_ID, true),
        brand::DEV_BUNDLE_ID
    );
}

// plugins/tray/src/menu_items/tray_version.rs
#[test]
fn get_channel_maps_syntheo_identifiers() {
    assert_eq!(
        TrayVersion::get_channel("fr.willisback.syntheo", "Syntheo"),
        "stable"
    );
    assert_eq!(
        TrayVersion::get_channel("fr.willisback.syntheo.dev", "Syntheo Dev"),
        "dev"
    );
    assert_eq!(
        TrayVersion::get_channel("com.hyprnote.stable", "Anarlog"),
        "dev"
    );
}
```

Les trois anciens tests `resolve_app_folder_*` (anarlog/hyprnote) sont supprimés.

- [ ] **Step 2: Vérifier l'échec**

Run: `cargo test --locked -p storage -p tauri-plugin-anlg-tray`
Expected: FAIL (`brand` introuvable, puis valeurs `anarlog`/`stable` attendues différentes).

- [ ] **Step 3: Implémenter**

Créer la crate `brand` (`license = "MIT"`, `edition = "2024"`, sans dépendance). Dans `global.rs` : `resolve_app_folder` renvoie `bundle_id` en debug (comportement conservé), sinon `brand::APP_DATA_FOLDER` ; suppression de `LEGACY_RELEASE_APP_FOLDER`, `RELEASE_APP_FOLDER` et de la branche legacy (`has_app_data` supprimé s'il devient inutilisé). `get_channel` : `STABLE_BUNDLE_ID` → `"stable"`, `DEV_BUNDLE_ID` → `"dev"`, tout le reste → `"dev"`. Dans les autres fichiers listés, remplacer chaque identifiant stable (`com.hyprnote.stable`, `com.hyprnote.Hyprnote`, `so.anarlog.Anarlog`) par `brand::STABLE_BUNDLE_ID`, chaque `com.hyprnote.dev` par `brand::DEV_BUNDLE_ID`, et les noms `"Anarlog"` des messages Rust par `brand::PRODUCT_NAME` (en `format!` si besoin). Les identifiants staging/nightly/app-store restent tels quels quand ils servent à reconnaître d'autres apps ; sinon leurs branches sont supprimées. `crates/detect` et `plugins/detect` : la liste d'exclusion « soi-même » contient les deux identifiants Syntheo.

- [ ] **Step 4: Vérifier le succès**

Run: `cargo test --locked -p storage -p tauri-plugin-anlg-tray -p detect -p tauri-plugin-detect` puis `rg -n 'com\.hyprnote\.(stable|dev|Hyprnote)|so\.anarlog\.Anarlog' apps plugins crates --glob '!**/tauri.conf.*.json'`
Expected: tests PASS ; `rg` ne renvoie que des lignes de tests supprimés ou rien.

- [ ] **Step 5: Commit et PR**

```bash
git commit -m "feat(brand): identifiants et dossier de données Syntheo"
```

PR `feat(brand): identifiants et dossier de données Syntheo`, `Closes #N`.

---

### Task 2: Configuration Tauri, icônes et titres (chantier 02)

**Files:**

- Modify: `apps/desktop/src-tauri/tauri.conf.json` (identité dev, `createUpdaterArtifacts: false`, suppression de `plugins.updater.pubkey`/`endpoints`)
- Modify: `apps/desktop/src-tauri/tauri.conf.syntheo.json` (icônes `icons/syntheo/*`)
- Delete: `apps/desktop/src-tauri/tauri.conf.{stable,staging,nightly,flatpak,app-store}.json` et leurs variantes `*-macos.json`
- Create: `apps/desktop/src-tauri/icons/syntheo/` (généré)
- Modify: `apps/desktop/index.html:9,152`, `plugins/windows/src/window/v1.rs:235`, `plugins/windows/src/window/floating_bar.rs:420`
- Test: `apps/desktop/src-tauri/tests/config_identity.rs` (nouveau, lit les JSON)

**Interfaces:**

- Consumes: `brand::PRODUCT_NAME` (Task 1) pour les titres de fenêtre.

- [ ] **Step 1: Écrire le test qui échoue** (`config_identity.rs`, parse avec `serde_json`)

```rust
#[test]
fn syntheo_configs_have_syntheo_identity() {
    let dev = read("tauri.conf.json");
    assert_eq!(dev["identifier"], "fr.willisback.syntheo.dev");
    assert_eq!(dev["productName"], "Syntheo Dev");
    assert_eq!(dev["mainBinaryName"], "syntheo-dev");
    assert_eq!(
        dev["plugins"]["deep-link"]["desktop"]["schemes"],
        serde_json::json!(["syntheo-dev"])
    );
    assert_eq!(dev["bundle"]["createUpdaterArtifacts"], false);
    let rel = read("tauri.conf.syntheo.json");
    assert_eq!(rel["identifier"], "fr.willisback.syntheo");
    assert_eq!(
        rel["plugins"]["deep-link"]["desktop"]["schemes"],
        serde_json::json!(["syntheo"])
    );
    assert!(
        rel["bundle"]["icon"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p.as_str().unwrap().starts_with("icons/syntheo/"))
    );
}
#[test]
fn no_fastrepl_channel_configs_remain() {
    for f in ["stable", "staging", "nightly", "flatpak", "app-store"] {
        assert!(!std::path::Path::new(&format!("tauri.conf.{f}.json")).exists());
    }
}
```

- [ ] **Step 2: Vérifier l'échec** — Run: `cargo test --locked -p desktop --test config_identity` — Expected: FAIL.

- [ ] **Step 3: Implémenter.** Icônes générées depuis le logo de syntheo-web : `pnpm -F desktop tauri icon /home/will/work/syntheo/public/favicon/icon.svg -o src-tauri/icons/syntheo` (copier le SVG dans `apps/desktop/src-tauri/icons/syntheo/source.svg` pour la reproductibilité). Titres : `index.html` → `Syntheo` et « Chargement de Syntheo… plus long que prévu. » ; fenêtres → `brand::PRODUCT_NAME`. Supprimer les références restantes aux configs supprimées (`rg 'tauri.conf\.(stable|staging|nightly|flatpak|app-store)'`).

- [ ] **Step 4: Vérifier** — Run: `cargo test --locked -p desktop --test config_identity` et `rg -n 'tauri\.conf\.(stable|staging|nightly|flatpak|app-store)' --hidden -g '!target'` — Expected: PASS ; `rg` vide.

- [ ] **Step 5: Commit et PR** — `feat(brand): configuration Tauri, icônes et titres Syntheo`, `Closes #N`.

---

### Task 3: Fonctionnalités sans paywall (chantier 03)

**Files:**

- Create: `apps/desktop/src/auth/local-billing.tsx`
- Modify: `apps/desktop/src/shared/main-app-layout.tsx:17,40-43` (et son test, l. 34-35)
- Delete: `apps/desktop/src/auth/billing.tsx`, `apps/desktop/src/auth/billing.test.tsx` s'ils n'ont plus d'importeur (sinon ne retirer que `BillingProvider`)
- Test: `apps/desktop/src/auth/local-billing.test.tsx`

**Interfaces:**

- Consumes: `BillingContext`, `BillingAccess` (`apps/desktop/src/auth/billing-context.ts`, inchangé).
- Produces: `export const UNLOCKED_BILLING: BillingAccess` et `export function LocalBillingProvider({ children }: { children: ReactNode })`.

- [ ] **Step 1: Écrire les tests qui échouent**

```tsx
it("provides an unlocked pro plan without any session", () => {
  const seen = renderWithProvider(() => useBillingAccess());
  expect(seen).toMatchObject({ isPro: true, isPaid: true, plan: "pro", isReady: true, isTrialing: false });
  expect(seen.canStartTrial).toEqual({ data: false, isPending: false });
});
it("pro_settings_are_usable_without_session", () => {
  render(<LocalBillingProvider><PlanGate plan="pro" allowed={useBillingAccess().isPro}>
    <button type="button">Activer</button></PlanGate></LocalBillingProvider>);
  // aucun wrapper cursor-not-allowed, aucun toast « Anarlog Pro »
});
```

(`renderWithProvider` : helper local du fichier de test ; `PlanGate` réel depuis `~/settings/plan-gate`, le hook appelé dans un petit composant.)

- [ ] **Step 2: Vérifier l'échec** — Run: `pnpm -F desktop test src/auth/local-billing.test.tsx` — Expected: FAIL (module absent).

- [ ] **Step 3: Implémenter.** `UNLOCKED_BILLING` : `entitlements: ["hyprnote_pro"]`, `subscriptionStatus: null`, `isPro: true`, `isLite: false`, `isPaid: true`, `isTrialing: false`, `isPaused: false`, `hasPaymentMethod: false`, `trialEnd: null`, `trialDaysRemaining: null`, `cancelAtPeriodEnd: false`, `currentPeriodEnd: null`, `plan: "pro"`, `isReady: true`, `canStartTrial: { data: false, isPending: false }`, `upgradeToPro: () => {}`, `isUpgradingToPro: false`. Le fournisseur ne fait aucune requête. `MainAppLayout` utilise `LocalBillingProvider` à la place de `BillingProvider`.

- [ ] **Step 4: Vérifier** — Run: `pnpm -F desktop test src/auth src/shared/main-app-layout.test.tsx src/settings/plan-gate.test.tsx` puis `pnpm -F desktop typecheck` — Expected: PASS.

- [ ] **Step 5: Commit et PR** — `feat(billing): toutes les fonctionnalités sans abonnement`, `Closes #N`.

---

### Task 4: Télémétrie désactivée (chantier 04)

**Files:**

- Modify: `crates/analytics/src/lib.rs` (méthode `has_remote_sink`, test)
- Modify: `plugins/analytics/src/lib.rs:61-81` (plus de lecture de `POSTHOG_API_KEY`)
- Modify: `apps/desktop/src-tauri/src/lib.rs:185-220` (plus de `SENTRY_DSN` ni `ANARLOG_DISABLE_SENTRY` : pas d'init Sentry)
- Modify: `apps/desktop/src/env.ts:18-20` (retrait de `VITE_SENTRY_DSN`, `VITE_POSTHOG_API_KEY`, `VITE_POSTHOG_HOST`), `apps/desktop/src/error-reporting.ts:216+` (`initializeErrorReporting` sans `Sentry.init`)
- Modify: `CONTRIBUTING.md` (bloc Linux sans `POSTHOG_API_KEY=phc_disabled`), `.github/workflows/release.yml` (env `POSTHOG_API_KEY` retiré)
- Test: `crates/analytics/src/lib.rs` (module tests), `apps/desktop/src/error-reporting.test.ts`

**Interfaces:**

- Produces: `impl AnalyticsClient { pub fn has_remote_sink(&self) -> bool }` (vrai si PostHog configuré).

- [ ] **Step 1: Écrire les tests qui échouent**

```rust
#[test]
fn default_client_has_no_remote_sink() {
    assert!(!AnalyticsClientBuilder::default().build().has_remote_sink());
}
```

```ts
it("never initializes Sentry", () => {
  initializeErrorReporting();
  expect(sentryInit).not.toHaveBeenCalled(); // mock de @sentry/* déjà présent dans le fichier
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `cargo test --locked -p analytics` et `pnpm -F desktop test src/error-reporting.test.ts` — Expected: FAIL (`has_remote_sink` absent ; `Sentry.init` appelé si le test fournit un DSN).

- [ ] **Step 3: Implémenter.** Le plugin construit `AnalyticsClientBuilder::default().build()` sans clé ; Sentry Rust : la variable `dsn` disparaît et le client n'est jamais créé (les appels conditionnels `if let Some(client)` restent valides avec `None`, ou sont supprimés) ; `initializeErrorReporting` devient un no-op documenté (« télémétrie retirée, voir NOTICE.md »).

- [ ] **Step 4: Vérifier**

Run: `cargo test --locked -p analytics`, `pnpm -F desktop test src/error-reporting.test.ts`, `pnpm -F desktop typecheck`, puis `rg -n 'POSTHOG_API_KEY|SENTRY_DSN|VITE_POSTHOG|VITE_SENTRY' apps plugins crates CONTRIBUTING.md .github`
Expected: PASS ; `rg` vide.

- [ ] **Step 5: Commit et PR** — `feat(privacy): télémétrie désactivée (PostHog, Sentry)`, `Closes #N`. Après fusion : lancer `ci-install` à la demande (`gh workflow run ci-install.yml`) pour valider le build release sans clé factice.
