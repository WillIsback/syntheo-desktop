# Retrait de l'authentification et des fonctions cloud — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Syntheo Desktop fonctionne entièrement sans compte ni session : plus de Supabase, de plugin `auth`, d'étape « compte », ni de fonction cloud qui en dépendait. Le RGPD est documenté dans `docs/conformite/rgpd.md`.

**Architecture:** On supprime d'abord les feuilles (onboarding, réglages, invites de connexion), puis les arbres de fonctions purement cloud qui ne font que consommer la session, puis on rend explicitement locales les fonctions conservées (LLM, STT, dictée, identité du propriétaire). On supprime ensuite `auth/` et `AuthProvider`, et enfin le côté Rust (plugin `auth`, `access_token()` des plugins calendar et todo, commande `auth` du CLI). Les crates Rust de cloudsync et db-sync restent pour le chantier 04d suivant : sans `AuthProvider`, cloudsync n'est jamais configuré.

**Tech Stack:** React 19 / TypeScript / Vitest 5 (apps/desktop), Rust 1.94 (plugins, apps/cli), Lingui 6.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (sections « Intégrations cloud hors IA : retirées », « RGPD : conformité documentée », chantier 04d).

## Global Constraints

- Aucune fonctionnalité conservée ne dépend d'une session : test « sans session » pour chaque fonction locale touchée.
- Ne jamais réintroduire de compte, de télémétrie ni d'appel à `anarlog.so` / `api.anarlog.so` / Supabase.
- **Conserver** : `lock/*` et `local-auth` (déverrouillage local), `plugins/fs-sync` et `crates/fs-sync-core` (stockage local), Apple Calendar (local), le variant deep-link `/auth/callback` et le serveur de callback (utilisés par l'OAuth d'abonnement ChatGPT et la démo d'accueil : seule la branche jetons Supabase part), `billing-context.ts` et `local-billing.tsx` (déplacés dans `~/billing/`).
- Ne pas lire `session` avec une valeur de remplacement : supprimer la lecture (une valeur `null` affiche des invites « Se connecter », `undefined` bloque des écrans en chargement).
- Identité du propriétaire : `useOwnerUserId()` / `DEFAULT_USER_ID`, cohérent avec `session/queries/creation.ts`.
- Catalogues Lingui régénérés par `lingui extract`, jamais édités à la main.
- Une PR pour tout le lot, une issue par tâche, titre Conventional Commits avec `[skip release]` ; gates de PR au vert.

## Review Focus

- Démarrage à froid sans aucune donnée : l'onboarding va jusqu'au bout sans écran de connexion → test `onboarding_never_shows_login` (Task 1).
- Profil local (nom, poste) toujours éditable après suppression de l'écran Compte → test `account_profile_is_reachable_from_general` (Task 2).
- Lancement d'une transcription et d'un résumé avec un provider local alors que rien n'est configuré côté cloud : aucune requête de jeton, aucune invite → tests `stt_connection_without_session` et `llm_connection_without_session` (Task 4).
- Un ancien onglet de réglages persistant (`account`, `billing`, `team`, `sync`, `referrals`) restauré au démarrage : redirige vers `general`, pas d'écran vide → test `legacy_settings_tabs_normalize_to_general` (Task 2).
- Lien `syntheo://auth/callback` avec des jetons Supabase : ignoré sans erreur, alors que l'OAuth ChatGPT continue de fonctionner → test `auth_callback_tokens_are_ignored_chatgpt_oauth_kept` (Task 5).

## Cartographie (référence pour toutes les tâches)

- Montage unique : `apps/desktop/src/shared/main-app-layout.tsx` (`AuthProvider`, `MeetingImportSync`, `EnterpriseCaptureSync`, `WorkspaceInvitationToasts`, `SharedWorkspaceMirror`) ; cycles de vie cloud dans `apps/desktop/src/main/lifecycle.tsx:57-64`.
- Fonctions purement cloud (supprimées) : `session-sharing/`, `shared-notes/`, `sidebar/shared-notes.tsx`, `resource-sharing/`, `cloud-api/`, `attachment-sync/`, `enterprise-capture/`, `settings/team/`, `settings/sync/`, `settings/referrals.tsx`, `settings/general/{account,billing,default-share-access,primary-recording-device,e2ee-setup}.tsx`, `settings/developers/cloud-api.tsx`, `billing/`, `onboarding/account/`, `shared/{trial-start,billing}.ts`, `auth/cloudsync*`, `auth/{sync-devices,automatic-device-enrollment,automatic-sync-identity,connect-local-library-dialog,cloudsync-keychain-repair,useConnections}*`, `crm/enrich-contact.tsx`, `settings/crm/`, `imports/` (parties cloud), `services/meeting-import-sync.tsx`, `settings/todo/`, chemins Nango du calendrier (`calendar/components/oauth/`, parties cloud de `calendar/components/{sidebar,calendar-view}.tsx`, fournisseurs Google/Outlook de `onboarding/calendar.tsx`), intégrations cloud des automatisations (`settings/automations/{starter-config,google-drive-config}.tsx`, `requireSupabaseSession` d'`automations/engine.ts`), recherche web du chat (`chat/tools/web-search.ts`), invites de connexion (`sidebar/toast/registry.tsx:142-161`, `session/components/note-input/enhanced/enhance-error.tsx:25-29`), `devtools-bar` `PlanBadge` et actions d'essai.
- Fonctions locales à rendre indépendantes de la session : `dictation/lifecycle.tsx`, `stt/{useSTTConnection,useRunBatch,capture-lifecycle,recording-import,primary-device}`, `ai/hooks/useLLMConnection.ts`, `settings/ai/llm/select.tsx`, identité propriétaire (`contacts/{details,index}.tsx`, `sidebar/contacts.tsx`, `settings/general/account-profile.tsx`, `settings/stats/{queries,badge-collection}`), `folders/{sidebar,folder-editor}.tsx`, `sidebar/timeline/index.tsx`, `shared/open-note-dialog.tsx`, `export-modal.tsx`, `session/hooks/useDeleteSession.ts`, `contacts/profile-photo.tsx`, `chat/context/entities.ts` (type `AccountInfo`).
- Rust : `apps/desktop/src-tauri/src/lib.rs:252` (enregistrement) et `:481-485` (`clear_auth`), `capabilities/default.json:34`, `plugins/calendar/src/commands.rs` et `plugins/todo/src/commands.rs` (`access_token()`), `apps/cli` (`auth login/logout`, `cloud.rs`, source `Cloud` de `meetings`), workspace `Cargo.toml` (`tauri-plugin-auth`, `anlg-supabase-auth`).

---

### Task 1: Onboarding sans compte

**Files:**

- Modify: `apps/desktop/src/onboarding/config.tsx` (retirer le pas `"login"` du type et des tableaux), `apps/desktop/src/onboarding/index.tsx` (section « Créer un compte », `useAuth`, `didSkipLogin`, `handleCalendarSignIn`), `apps/desktop/src/onboarding/calendar.tsx` (ne garder que `AppleCalendarProvider` ; l'étape calendrier n'apparaît que sur macOS)
- Delete: `apps/desktop/src/onboarding/account/`, `apps/desktop/src/shared/{trial-start,billing}.ts` (+ tests)
- Test: `apps/desktop/src/onboarding/config.test.ts` (nouveau ou existant), `apps/desktop/src/onboarding/index.test.tsx`

**Interfaces:**

- Produces: `STEPS_MACOS = ["permissions", "calendar", "imports", "final"]`, `STEPS_OTHER = ["imports", "final"]` (le pas `imports` ne garde que les imports de fichiers locaux, cf. Task 3).

- [ ] **Step 1: Tests qui échouent** — `onboarding_never_shows_login` : `expect(STEPS_MACOS).not.toContain("login")`, `expect(STEPS_OTHER).not.toContain("login")`, et le rendu de l'onboarding complet (mocks permissions et calendrier) ne contient ni « Créer un compte » ni « Se connecter » (`queryByText(/compte|connecter|sign in/i)` nul).
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F desktop test src/onboarding` → FAIL.
- [ ] **Step 3: Implémenter** selon Files.
- [ ] **Step 4: Vérifier** — `pnpm -F desktop test src/onboarding && pnpm -F desktop typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(onboarding): parcours sans compte`.

### Task 2: Réglages sans compte, équipe ni abonnement

**Files:**

- Create: `apps/desktop/src/settings/general/profile.tsx` (déplacement d'`AccountProfile` depuis `account-profile.tsx`, monté dans `settings/general/index.tsx`)
- Modify: `apps/desktop/src/settings/index.tsx` (cas `account`, `billing`, `referrals`, `sync`, `team` retirés ; `developers` sans `cloud-api`), `apps/desktop/src/sidebar/settings-nav-groups.ts` (entrées correspondantes et CRM), `apps/desktop/src/store/zustand/tabs/schema.ts` (union `SettingsTab` + `normalizeSettingsTab`), `apps/desktop/src/settings/general/meeting-settings.tsx`, appelants de navigation (`config-error.tsx:30` → `ai`, `services/event-listeners.tsx:655` supprimé)
- Delete: `settings/general/{account,billing,default-share-access,primary-recording-device,e2ee-setup}.tsx`, `settings/{referrals.tsx,sync/,team/,crm/}`, `settings/developers/cloud-api.tsx` (+ tests)
- Test: `apps/desktop/src/store/zustand/tabs/basic.test.ts`, `apps/desktop/src/settings/general/index.test.tsx`

**Interfaces:**

- Produces: `normalizeSettingsTab(tab: string): SettingsTab` renvoie `"general"` pour `"account" | "billing" | "referrals" | "team" | "sync" | "crm"`.

- [ ] **Step 1: Tests qui échouent** — `legacy_settings_tabs_normalize_to_general` : pour chaque ancien onglet, `normalizeSettingsTab(t) === "general"` ; `account_profile_is_reachable_from_general` : le rendu de l'onglet Général contient les champs du profil local (nom, poste) et l'enregistrement appelle `savePersonalContact`.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F desktop test src/store/zustand/tabs src/settings/general` → FAIL.
- [ ] **Step 3: Implémenter** selon Files.
- [ ] **Step 4: Vérifier** — mêmes tests + `pnpm -F desktop typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(settings): réglages sans compte ni équipe`.

### Task 3: Suppression des fonctions cloud

**Files:** tous les chemins « supprimés » de la Cartographie, et leurs points de montage (`main-app-layout.tsx`, `main/lifecycle.tsx`, `sidebar/*`, entrées de menus, routes `routes/app/instruction.tsx` pour les parties essai/abonnement). Les fichiers mixtes (calendrier, imports, automatisations, profil photo, dossiers, export) ne perdent que leurs chemins cloud.

- Test: les tests listés pour ces fonctions sont supprimés avec elles ; les tests des fichiers mixtes sont mis à jour.

**Interfaces:**

- Produces: plus aucun import de `~/session-sharing`, `~/shared-notes`, `~/resource-sharing`, `~/cloud-api`, `~/attachment-sync`, `~/enterprise-capture`, `~/settings/team`, `~/auth/cloudsync*` hors de ces dossiers.

- [ ] **Step 1: Test garde-fou qui échoue** — `apps/desktop/src/no-cloud-imports.test.ts` : parcourt `apps/desktop/src/**/*.{ts,tsx}` (hors `*.test.*`) et échoue si un fichier importe l'un des modules ci-dessus ou contient `anarlog.so`, `useConnections`, `requireTeamContext`, `useAuthedApiClient`.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F desktop test src/no-cloud-imports.test.ts` → FAIL (liste des fichiers fautifs).
- [ ] **Step 3: Implémenter** : supprimer les arbres, démonter, retirer les chemins cloud des fichiers mixtes. Commit intermédiaire par domaine autorisé (partage, synchronisation, intégrations) tant que la suite reste verte.
- [ ] **Step 4: Vérifier** — `pnpm -F desktop test && pnpm -F desktop typecheck && pnpm exec oxlint --quiet apps/desktop/src/` → PASS (hors le test instable connu `src/stt/primary-device.test.tsx` s'il échoue sous charge : relancer seul).
- [ ] **Step 5: Commit** — `feat(cloud): suppression des fonctions cloud (partage, synchronisation, équipes, intégrations)`.

### Task 4: Fonctions locales sans session

**Files:**

- Modify: `stt/useSTTConnection.ts`, `stt/useRunBatch.ts`, `stt/capture-lifecycle.ts`, `stt/recording-import.tsx`, `stt/primary-device.tsx` (présence multi-appareils retirée), `ai/hooks/useLLMConnection.ts`, `settings/ai/llm/select.tsx`, `dictation/lifecycle.tsx`, fichiers d'identité propriétaire de la Cartographie, `chat/context/entities.ts`, `main/lifecycle.tsx` (plus de `getAuthHeaders`)
- Move: `auth/billing-context.ts` → `billing/billing-context.ts`, `auth/local-billing.tsx` (+ test) → `billing/local-billing.tsx` ; type `BillingInfo` défini localement (plus d'import `@anlg/supabase`)
- Test: tests existants de ces fichiers mis à jour (plus de mock `~/auth`) + nouveaux tests ci-dessous

**Interfaces:**

- Consumes: rien de Task 3 hormis l'absence des modules cloud.
- Produces: aucun de ces fichiers n'importe `~/auth`.

- [ ] **Step 1: Tests qui échouent** — `stt_connection_without_session` : `useSTTConnection` avec un provider custom résout la connexion sans jamais appeler un getter de jeton ; `llm_connection_without_session` : `useLLMConnection` avec le provider `custom` renvoie un modèle utilisable et `isAuthenticated` n'existe plus dans le statut ; `run_batch_uses_local_provider_without_cloud_session` : `useRunBatch` n'évalue plus `requiresCloudSession`. Ces tests n'installent aucun mock de `~/auth`.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F desktop test src/stt src/ai src/dictation` → FAIL.
- [ ] **Step 3: Implémenter** : retirer les branches `isCloudModel` / provider `"anarlog"` liées à la session, remplacer `session?.user.id ?? …` par `useOwnerUserId()` / `DEFAULT_USER_ID`, inliner `AccountInfo` ou retirer le variant `account`.
- [ ] **Step 4: Vérifier** — `pnpm -F desktop test && pnpm -F desktop typecheck` → PASS ; `rg -n 'from "~/auth' apps/desktop/src -g '!**/*.test.*'` ne renvoie que `auth/` lui-même.
- [ ] **Step 5: Commit** — `refactor(local): fonctions locales indépendantes de toute session`.

### Task 5: Suppression d'`auth/`, d'`AuthProvider` et des deep-links de connexion

**Files:**

- Delete: `apps/desktop/src/auth/` (après Task 4, il ne reste que le cœur auth) et ses tests
- Modify: `shared/main-app-layout.tsx` (plus d'`AuthProvider`), `shared/hooks/useDeeplinkHandler.ts` (branche jetons de `/auth/callback` et `/billing/refresh` retirées ; l'OAuth ChatGPT reste), `shared/utils.ts` (`/auth`, `/app/account`, `/app/checkout`… retirés de `DesktopFlowPath`, plus de `desktop_state`), `apps/desktop/package.json` (`@anlg/plugin-auth`, `@supabase/supabase-js`, `@anlg/supabase`, `@anlg/pricing` retirés ; `.env.supabase` retiré des scripts `tauri`), `apps/desktop/src/env.ts` (`VITE_SUPABASE_*`, `VITE_API_URL`, `VITE_APP_URL` s'ils n'ont plus d'usage), `error-reporting.ts` (`initializeErrorReporting` et son appel supprimés : constat SonarCloud S1186)
- Test: `shared/hooks/useDeeplinkHandler.test.ts`, `shared/utils.test.ts`

- [ ] **Step 1: Test qui échoue** — `auth_callback_tokens_are_ignored_chatgpt_oauth_kept` : un deep-link `/auth/callback?access_token=…&refresh_token=…` ne déclenche aucun appel et ne lève rien ; le flux OAuth d'abonnement ChatGPT (`settings/ai/llm/subscriptions`) reçoit toujours son `code`/`state`.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F desktop test src/shared` → FAIL.
- [ ] **Step 3: Implémenter** selon Files ; `pnpm install` pour mettre à jour le lockfile.
- [ ] **Step 4: Vérifier** — `pnpm -F desktop test && pnpm -F desktop typecheck` et `rg -n 'supabase|plugin-auth|useAuth\(' apps/desktop/src -g '!**/*.test.*'` → vide.
- [ ] **Step 5: Commit** — `feat(auth): suppression de l'authentification`.

### Task 6: Rust — plugin auth, calendrier, todo, CLI

**Files:**

- Modify: `apps/desktop/src-tauri/src/lib.rs` (`.plugin(tauri_plugin_auth::init())` et `clear_auth` retirés), `apps/desktop/src-tauri/Cargo.toml`, `capabilities/default.json` (`auth:default` retiré, `local-auth:default` conservé), `plugins/calendar/src/commands.rs` (commandes cloud retirées, Apple Calendar conservé), `plugins/todo/` (supprimé s'il n'a plus de commande locale), workspace `Cargo.toml` et `bacon.toml`, `apps/cli` (sous-commande `auth`, `cloud.rs`, source `Cloud` et repli cloud de `meetings` retirés : base locale absente → erreur explicite)
- Delete: `plugins/auth`, `crates/supabase-auth`
- Test: `apps/cli/src/commands/meetings.rs` (test nouveau), tests des plugins concernés

- [ ] **Step 1: Test qui échoue** — `meetings_without_local_database_reports_missing_database` : sans base locale, la commande renvoie une erreur « base Syntheo introuvable » et n'instancie aucun client cloud.
- [ ] **Step 2: Vérifier l'échec** — `cargo test --locked -p anarlog-cli meetings` → FAIL.
- [ ] **Step 3: Implémenter** selon Files ; régénérer les schémas `gen/schemas` (build) et mettre à jour `Cargo.lock`.
- [ ] **Step 4: Vérifier** — `cargo test --locked -p anarlog-cli -p tauri-plugin-calendar && cargo check --locked -p desktop` (conteneur `syntheo-dev`) → PASS ; `rg -n 'tauri-plugin-auth|supabase-auth|AuthPluginExt' -g '!target' .` → vide.
- [ ] **Step 5: Commit** — `feat(auth): suppression du plugin auth et des commandes cloud Rust`.

### Task 7: Conformité RGPD, catalogues et finitions

**Files:**

- Create: `docs/conformite/rgpd.md` (contenu décidé dans la spec, section « RGPD » : inventaire des données, flux réseau, garanties techniques, responsabilités de l'utilisateur ; l'état réel est indiqué : l'audio est encore écrit sur disque jusqu'au chantier 04c, et les intégrations restantes listées), `.sonarcloud.properties` (`sonar.cpd.exclusions=**/*.test.*,**/tests/**`)
- Modify: catalogues Lingui (`pnpm -F desktop exec lingui extract`), `NOTICE.md` (liste des retraits), `README.md` (lien vers `docs/conformite/rgpd.md`)
- Test: `apps/desktop/src/no-cloud-imports.test.ts` (Task 3) reste vert

- [ ] **Step 1: Test qui échoue** — `docs_rgpd_is_referenced` : un test Vitest lit `README.md` et `docs/conformite/rgpd.md` et vérifie la présence des sections « Données stockées », « Flux réseau », « Garanties techniques », « Responsabilités de l'utilisateur » et du lien depuis le README.
- [ ] **Step 2: Vérifier l'échec** — `pnpm -F desktop test src/docs-rgpd.test.ts` → FAIL.
- [ ] **Step 3: Implémenter** selon Files.
- [ ] **Step 4: Vérifier** — `pnpm -F desktop test && pnpm -F desktop typecheck` → PASS ; `dprint check` des fichiers modifiés.
- [ ] **Step 5: Commit** — `docs(rgpd): conformité documentée` puis PR du lot.
