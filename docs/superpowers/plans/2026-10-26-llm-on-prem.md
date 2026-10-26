# Providers LLM on-prem et préréglages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire les providers LLM au seul `custom` (OpenAI-compatible on-prem), fournir les préréglages on-premise de la spec (vLLM du DGX, Nemotron ASR NIM) et retirer le code, les plugins et les dépendances qui ne servaient qu'aux LLM cloud.

**Architecture:** Côté TS, `settings/ai/llm/shared.tsx` ne déclare plus que `custom`, `useLLMConnection` ne construit plus qu'un modèle `createOpenAICompatible`, une sélection héritée est normalisée au démarrage comme la sélection STT. La vérification des identifiants d'un LLM `custom` interroge `/models` sans contre-épreuve par clé invalide, et la clé devient facultative. Côté Rust, le plugin `bedrock`, la crate `openrouter` et l'évaluation de templates via OpenRouter disparaissent ; les réglages gérés (managed settings) visent les providers STT réels.

**Tech Stack:** React 19, TypeScript, Vitest, AI SDK (`ai`, `@ai-sdk/openai-compatible`), Tauri 2, Rust 1.94.

**Spec:** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` (Phase 5 « Providers », lignes 160-185)

## Global Constraints

- « `settings/ai/llm/shared.tsx` est réduit au provider `custom`. Sont retirés les 33 autres (`anarlog`, claude, chatgpt, copilot, openrouter, groq, mistral, `apple_foundation`…) et leurs dépendances `@ai-sdk/*`. »
- Conservés : `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/react`.
- Préréglages « modifiables, clés saisies dans l'app, **jamais compilées** dans le binaire » :
  - STT « Nemotron ASR (NIM, WebSocket) » → `https://spark-787d-1.tail6cba9f.ts.net/v1/realtime` ; « Voxtral Realtime (vLLM) » → URL à renseigner ;
  - LLM « vLLM » → `https://spark-787d-1.tail6cba9f.ts.net/v1`, modèle non épinglé, lu dans `/v1/models`.
- Aucun cloud, aucune télémétrie, aucun en-tête d'empreinte d'appareil vers un endpoint.
- HTTP clair accepté seulement vers un hôte privé (`isPrivateHost`), HTTPS ailleurs.
- Interface en français pour les textes nouveaux ; les catalogues i18n générés ne sont pas édités à la main.

## Review Focus

- Une sélection LLM héritée (`anarlog`, `openai`, `ollama`, `apple_foundation`…) au premier lancement : elle est vidée, l'utilisateur voit l'invite « modèle de langage requis », et rien n'appelle un provider inexistant (test `normalizes_a_legacy_llm_selection`, Task 1).
- Un vLLM lancé sans `--api-key` (clé vide, LAN) : la configuration s'enregistre et la liste des modèles se remplit (test `custom_llm_without_key_lists_models`, Task 2).
- Un vLLM avec clé qui accepte aussi une clé invalide sur `/models` : on accepte l'endpoint, sans le message « doesn't support API key verification » (test `custom_llm_skips_control_key_probe`, Task 2).
- Un modèle servi au nom inhabituel (`nvidia/Qwen3.8-Flash-Next-FP4-Local`) : il reste dans la liste, pas filtré comme « ancien modèle OpenAI » (test `custom_llm_lists_every_served_model`, Task 2).
- Un fichier `managed_settings.json` qui fige le STT sur `nvidia` : il est accepté, alors qu'un provider retiré (`custom` pour le STT) est refusé (test `managed_settings_accept_on_prem_stt_providers`, Task 3).

---

### Task 1: LLM réduit au provider `custom`

**Files:**
- Modify: `apps/desktop/src/settings/ai/llm/shared.tsx`, `select.tsx`, `configure.tsx`, `selection.ts`, `index.tsx`
- Delete: `apps/desktop/src/settings/ai/llm/subscriptions/`, `apps/desktop/src/ai/traced-fetch.ts`, `apps/desktop/src/settings/ai/shared/anarlog-pro-models.ts`, les `list-*.ts` des providers retirés (anthropic, azure-ai, azure-openai, cloudflare-workers-ai, google, lmstudio, mistral, ollama, openrouter, unsloth, venice) et `local-provider-availability.ts`, `apps/desktop/src/shared/config/configure-paid-settings.ts` (et leurs tests)
- Modify: `apps/desktop/src/ai/hooks/useLLMConnection.ts`, `ai/reasoning-effort.ts`, `settings/ai/shared/{model-capabilities,model-display,sort-providers}.ts`, `ai/tasks.ts` (`LOCAL_MODEL_PROVIDERS` → `custom`), `error-source.ts`, `enhance-workflow.ts`, `session/enhance-config.ts`, `sidebar/toast` (`hasProLlmConfigured`), `shared/utils.ts` (constantes d'en-tête d'empreinte), `settings/queries.ts`
- Modify: `apps/desktop/package.json` (retirer `@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/google`, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`, `ollama`), `pnpm-lock.yaml`
- Create: `apps/desktop/src/llm-on-prem.test.ts`

**Interfaces:**
- Produces: `PROVIDERS` (LLM) = `[{ id: "custom", … }]` ; `normalizeStoredLlmSelection(provider: string, model: string): { provider: string; model: string }` dans `settings/queries.ts` (provider ≠ `custom` → `{ provider: "", model: "" }`) ; `useLanguageModel(): LanguageModelV3 | null` (paramètre `task` retiré).

- [ ] **Step 1: Écrire les tests qui échouent** dans `llm-on-prem.test.ts` :
  - `llm_settings_offer_only_custom` : `PROVIDERS.map((p) => p.id)` égale `["custom"]` ;
  - `desktop_declares_no_cloud_llm_sdk` : `package.json` ne contient aucun de `@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/google`, `@ai-sdk/openai"`, `@openrouter/ai-sdk-provider`, `"ollama"` ;
  - `no_device_fingerprint_header` : aucun fichier `.ts/.tsx` hors tests de `apps/desktop/src` ne contient `x-device-fingerprint` ni `getFingerprint` ;
  - `normalizes_a_legacy_llm_selection` : `normalizeStoredLlmSelection("anarlog", "auto")` → `{ provider: "", model: "" }`, et `("custom", "qwen")` est inchangé.
- [ ] **Step 2:** `pnpm exec vitest run src/llm-on-prem.test.ts` → 4 échecs.
- [ ] **Step 3:** Réduire `shared.tsx`, `useLLMConnection.createProviderModel` (seul `createOpenAICompatible` via `providerFetch`, `wrapWithThinkingMiddleware` conservé), supprimer les fichiers listés et leurs branches, appeler `normalizeStoredLlmSelection` au chargement des réglages comme `normalizeStoredSttSelection`, retirer les dépendances et régénérer le lockfile (`pnpm install`).
- [ ] **Step 4:** Les tests de la Step 1 passent ; `vitest run`, `tsc --noEmit`, `eslint`, `pnpm install --frozen-lockfile` verts.
- [ ] **Step 5:** Commit `feat(llm): un seul provider LLM, OpenAI-compatible on-prem`.

### Task 2: Préréglages et vérification d'un endpoint on-prem

**Files:**
- Modify: `apps/desktop/src/settings/ai/llm/shared.tsx` (entrée `custom`), `apps/desktop/src/settings/ai/stt/shared.tsx` (préréglages), `packages/store/src/…` (`aiProviderSchema` : clé LLM facultative), `packages/provider-validation/src/index.ts`, `apps/desktop/src/settings/ai/shared/list-openai.ts` (ou nouvel `list-custom.ts`)
- Test: `packages/provider-validation/src/index.test.mjs`, `apps/desktop/src/llm-on-prem.test.ts`, `apps/desktop/src/stt-on-prem.test.ts`

**Interfaces:**
- Consumes: `PROVIDERS` (Task 1).
- Produces: `LLM_VLLM_PRESET_URL = "https://spark-787d-1.tail6cba9f.ts.net/v1"` et `STT_NIM_PRESET_URL = "https://spark-787d-1.tail6cba9f.ts.net/v1/realtime"` exportées de leurs `shared.tsx` ; `usesDeferredProviderAuthentication` inchangé.

- [ ] **Step 1: Tests qui échouent :**
  - `custom_llm_preset_points_at_the_dgx_vllm` : l'entrée `custom` a `baseUrl === LLM_VLLM_PRESET_URL`, `displayName === "vLLM (OpenAI-compatible)"`, et `requirements` ne demande que `base_url` ;
  - `stt_presets_follow_the_spec` : `nvidia.baseUrl === STT_NIM_PRESET_URL`, `nvidia.displayName` contient « Nemotron ASR », `openai.baseUrl` est `undefined` (URL à renseigner) ;
  - `custom_llm_without_key_lists_models` (provider-validation) : clé vide, `/models` renvoie `{ data: [{ id: "m" }] }` → résolu, une seule requête, sans en-tête `Authorization` ;
  - `custom_llm_skips_control_key_probe` : clé fournie, `/models` répond 200 → une seule requête (pas de contre-épreuve) ;
  - `custom_llm_lists_every_served_model` : la liste des modèles `custom` garde `nvidia/Qwen3.8-Flash-Next-FP4-Local` et `gpt-3.5-turbo`.
- [ ] **Step 2:** Lancer les tests → échecs attendus.
- [ ] **Step 3:** Implémenter : préréglages ; `aiProviderSchema` accepte une clé LLM vide (même règle que le STT on-prem) ; `credentialRequest` réduit à `GET {base}/models`, en-tête `Authorization` seulement si clé non vide, `checkAuthentication = false` pour `custom` ; texte de clé factice sans « anarlog » ; listing `custom` sans filtre d'anciens modèles.
- [ ] **Step 4:** Tests verts, suite complète (`vitest run` desktop, `node --test` du package).
- [ ] **Step 5:** Commit `feat(providers): préréglages on-prem (vLLM, Nemotron ASR) et vérification sans clé`.

### Task 3: Rust — plugins et crates des LLM cloud, réglages gérés

**Files:**
- Delete: `plugins/bedrock/`, `crates/openrouter/`, `crates/template-eval/`, `crates/template-app/tests/llm_eval/`
- Modify: `Cargo.toml` (membres et dépendances workspace), `apps/desktop/src-tauri/{Cargo.toml,src/lib.rs,capabilities/default.json}`, `crates/template-app/Cargo.toml` (`[[test]] llm_eval`, dev-dep), `plugins/misc` (commande `get_fingerprint` retirée si plus aucun consommateur), `plugins/settings/src/state.rs` (`normalize_legacy_names` des providers LLM), `crates/db-app/src/managed_settings.rs`, `Cargo.lock`, `apps/desktop/package.json` (paquet JS du plugin bedrock s'il existe)
- Test: `crates/db-app/src/managed_settings.rs` (tests), `apps/desktop/src/llm-on-prem.test.ts`

- [ ] **Step 1: Tests qui échouent :**
  - `managed_settings_accept_on_prem_stt_providers` (Rust) : `current_stt_provider` = `"nvidia"` et `"openai"` acceptés avec un bloc `stt:nvidia` / `stt:openai` ; `"custom"` refusé ;
  - `removes_cloud_llm_crates` (Vitest, `it.each`) : `plugins/bedrock`, `crates/openrouter`, `crates/template-eval` n'existent plus et `Cargo.toml` ne les nomme pas.
- [ ] **Step 2:** Lancer → échecs attendus.
- [ ] **Step 3:** Supprimer et mettre à jour les manifestes ; `cargo update -w`.
- [ ] **Step 4:** `cargo check --workspace --exclude shortcut-macos --exclude tcc --all-targets --locked`, `cargo test -p db-app -p tauri-plugin-settings -p template-app --locked`, clippy CI, Vitest garde-fous verts.
- [ ] **Step 5:** Commit `feat(llm): retirer bedrock, openrouter et l'évaluation cloud des templates`.

### Task 4: Documentation

**Files:**
- Modify: `docs/conformite/rgpd.md` (flux LLM : uniquement l'endpoint configuré ; plus d'en-tête d'empreinte), `NOTICE.md` (providers LLM retirés), `apps/desktop/src/env.ts` (`VITE_AI_API_URL` s'il n'a plus de lecteur)
- Test: `apps/desktop/src/docs-rgpd.test.ts`

- [ ] **Step 1:** Test `rgpd_lists_only_the_configured_llm_endpoint` : `rgpd.md` ne cite ni `openrouter` ni `anthropic`, et contient « endpoint LLM configuré ».
- [ ] **Step 2:** Échec attendu.
- [ ] **Step 3:** Mettre à jour les documents.
- [ ] **Step 4:** Test vert, suite complète.
- [ ] **Step 5:** Commit `docs: providers LLM on-prem dans la note RGPD et NOTICE`.
