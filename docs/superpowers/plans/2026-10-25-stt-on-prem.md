# STT on-premise uniquement (04b-1) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** l'app ne parle plus qu'aux protocoles STT standard des moteurs on-prem (OpenAI Realtime / `/v1/audio/transcriptions` et NVIDIA NIM WebSocket) ; les 33 adaptateurs STT cloud et le provider « custom » Deepgram-compatible disparaissent, et une URL on-prem inconnue est routée vers le protocole OpenAI avec le nom de modèle transmis tel quel.

**Architecture :** suppression des modules d'adaptateurs cloud dans `crates/owhisper-client`, réduction des enums `AdapterKind`, `Provider` (owhisper-client) et `BatchProvider` (listener2-core), puis des dispatchs qui les consomment (listener-core, listener2-core, plugins). Côté TS, la liste des providers STT et les tables qui en dépendent sont réduites. Deux corrections de comportement : le repli d'une URL inconnue passe de Deepgram à OpenAI, et le batch OpenAI n'écrase plus un nom de modèle inconnu (Voxtral, Whisper sur vLLM) par `gpt-transcribe` : ces modèles passent par `openai_compatible_batch` en verbatim. L'inférence embarquée (Argmax/Am, whisper.cpp, Soniqo, Apple Speech) et l'adaptateur `anarlog` (proxy `/stt` local) restent : ils relèvent du 04b-2.

**Tech Stack :** Rust 1.94 (owhisper-client, listener-core, listener2-core, plugins Tauri), TypeScript/React (apps/desktop), Vitest, wiremock (déjà en dev-dep d'owhisper-client).

**Spec :** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md`, « Phase 5 — Providers on-premise uniquement » (tableau des protocoles, « Retirés », « Suppression franche »).

## Global Constraints

- Protocoles conservés : OpenAI Realtime (`adapter/openai`, « rendu générique (URL et modèle libres) »), NVIDIA NIM WebSocket (`adapter/nvidia.rs`), OpenAI `/v1/audio/transcriptions` (`openai_compatible_batch.rs`).
- « L'utilisateur saisit une URL de base, une clé facultative et un modèle » : la clé est facultative pour OpenAI comme pour NVIDIA.
- Aucun hôte cloud par défaut : le provider `openai` n'a plus `https://api.openai.com/v1` comme URL implicite ; l'URL de base est requise.
- Suppression franche : modules, tests, fixtures et dépendances des adaptateurs retirés sont supprimés (pas de code commenté).
- Conservés pour le 04b-2 : `adapter/argmax`, `adapter/whispercpp`, `adapter/anarlog`, `deepgram_compat.rs`, `url_builder.rs`, `test_utils.rs` s'ils restent utilisés, les variantes `AdapterKind::{Argmax, Anarlog}`, `BatchProvider::{Argmax, WhisperLocal, Am, Soniqo, AppleSpeech, Anarlog}`, les providers TS `soniqo`, `apple_speech`, `local_file`.
- `plugins/*/js/bindings.gen.ts` : jamais régénérés dans le commit ; la seule modification admise est l'édition à la main de l'union `BatchProvider` de `plugins/transcription/js/bindings.gen.ts` pour refléter l'enum Rust.
- Tests et builds dans les conteneurs (`syntheo-dev:1`, wrapper `dk` pour Rust) ; dprint sur les fichiers modifiés ; textes UI nouveaux en anglais source Lingui (la traduction FR est un lot dédié).

## Review Focus

- Réglage enregistré avec un provider retiré (`current_stt_provider = "deepgram"`, `"custom"`, `"anarlog"`) : au démarrage la sélection est vidée, l'app ne plante pas et invite à choisir un provider → test `clears_removed_cloud_stt_provider` (Task 4).
- URL on-prem sans `?provider=` (ex. `http://192.168.1.87:8000/v1`) et URL avec `?provider=deepgram` résiduel : routées vers OpenAI, jamais vers un adaptateur disparu → tests Task 1.
- Import de fichier avec un modèle vLLM (`mistralai/Voxtral-Mini-3B-2507`) : la requête multipart porte ce nom exact, `response_format=verbose_json`, la langue → test wiremock Task 2.
- Clé d'API vide pour OpenAI on-prem : la connexion est construite (pas de blocage « clé requise ») → test Task 4.
- Dictée avec un provider désormais absent de `preview.rs` : pas de panique, repli sur l'enregistrement sans aperçu → couvert par les tests existants du plugin, relancés en Task 3.

---

### Task 1 : owhisper-client réduit aux protocoles on-prem, routage

**Files :**

- Delete : dans `crates/owhisper-client/src/adapter/` : `alebex.rs`, `amazon_bedrock.rs`, `gradium.rs`, `inworld.rs`, `modulate.rs`, `aquavoice/`, `assemblyai/`, `aws_transcribe/`, `azure_speech/`, `cartesia/`, `cohere/`, `dashscope/`, `deepgram/`, `elevenlabs/`, `fireworks/`, `gladia/`, `google_cloud/`, `google_generative_ai/`, `groq/`, `meta/`, `mistral/`, `nari/`, `openrouter/`, `pyannote/`, `revai/`, `siliconflow/`, `smallestai/`, `soniox/`, `speechmatics/`, `together/`, `wisprflow/`, `xai/`, `zai/` ; `src/polling.rs` ; dans `streaming_providers_tests.rs` les tests inworld/gradium/modulate/alebex ; `crates/soniox/` ; fixtures `crates/data/src/{english_1/deepgram.json,english_1/soniox.json,korean_1/soniox.json}` et leurs constantes.
- Modify : `adapter/mod.rs` (modules, `AdapterKind` = `OpenAI`, `Nvidia`, `Argmax`, `Anarlog`, et toutes ses fonctions), `providers.rs` (`Provider` réduit à `OpenAI`), `lib.rs` (ré-exports), `batch.rs` et `live.rs` (paramètre générique par défaut `OpenAIAdapter` au lieu de `DeepgramAdapter`, `impl ListenClient<OpenAIAdapter>::builder()`), `openai_compatible_batch.rs` (plus de cas `openrouter`), `adapter/tests.rs`, `tests/provider_{batch,live}_e2e.rs` (entrées OpenAI seulement), `Cargo.toml` (dépendances `soniox`, dev-dep `deepgram`, `tempfile` si plus utilisé), `Cargo.toml` racine (entrées `soniox`, `deepgram` si plus aucun usage, y compris le test `ensure_types` de `owhisper-interface`).

**Interfaces :**

- Produces : `AdapterKind::{OpenAI, Nvidia, Argmax, Anarlog}` ; `AdapterKind::from_url_and_languages(base_url: &str, languages: &[Language], model: Option<&str>) -> AdapterKind` (signature inchangée) ; `Provider::OpenAI` seul ; `ListenClient::builder()` / `BatchClient::builder()` construits sur `OpenAIAdapter` par défaut.

- [ ] **Step 1 : tests qui échouent** — dans `adapter/tests.rs` (remplacent les cas cloud de `test_adapter_kind_from_url_and_languages`) :
  - `unknown_on_prem_host_falls_back_to_openai` : `from_url_and_languages("http://192.168.1.87:8000/v1", &[], None) == AdapterKind::OpenAI` et idem pour `http://localhost:9000/v1/realtime`.
  - `provider_query_selects_openai_or_nvidia` : `"https://asr.example/v1/realtime?provider=nvidia"` → `Nvidia` ; `"https://asr.example/v1?provider=openai"` → `OpenAI`.
  - `removed_provider_query_falls_back_to_openai` : `"https://asr.example/v1?provider=deepgram"` → `OpenAI`.
  - Le test existant qui affirme le repli Deepgram (« Other local endpoints are custom Deepgram-compatible providers ») est supprimé.
- [ ] **Step 2 : vérifier l'échec** — `cargo test -p owhisper-client --lib adapter::tests` → les trois tests échouent (repli Deepgram, `openai` absent de la liste `?provider=`).
- [ ] **Step 3 : supprimer et réduire** — suppression des modules listés ; `from_url_and_languages` : liste `?provider=` = `Nvidia | OpenAI`, détections Argmax/Anarlog existantes conservées, repli final `Self::OpenAI` ; fonctions `batch_upload_limit`, `has_live_mode`, `language_support_*`, `recommended_model_*`, `openai_batch_max_duration`, `documented_language_codes_*` réduites aux variantes restantes ; `Provider` réduit à `OpenAI` avec ses méthodes ; génériques par défaut sur `OpenAIAdapter`.
- [ ] **Step 4 : vérifier** — `cargo test --locked -p owhisper-client` → PASS ; `cargo check --workspace --exclude shortcut-macos --exclude tcc --all-targets --locked` compile au moins owhisper-client (les consommateurs sont adaptés en Task 3 : la Task 1 et la Task 3 peuvent partager un commit si le workspace ne compile pas entre les deux — ruling à consigner).
- [ ] **Step 5 : commit** — `feat(stt): owhisper-client réduit aux protocoles on-prem`.

### Task 2 : batch OpenAI avec un nom de modèle on-prem

**Files :**

- Modify : `crates/owhisper-client/src/adapter/openai/mod.rs` (`resolve_batch_model`), `adapter/openai/batch.rs` (aiguillage vers `openai_compatible_batch` pour un modèle inconnu), `adapter/openai_compatible_batch.rs` si besoin d'exposer la config
- Test : `adapter/openai/batch.rs` (module de tests), `adapter/openai/mod.rs`

**Interfaces :**

- Consumes : `openai_compatible_batch::transcribe(client, api_base, api_key, params, file_path, OpenAICompatibleBatchConfig)`.
- Produces : `OpenAIAdapter::resolve_batch_model(model: Option<&str>) -> Option<AudioModel>` (`None` = modèle on-prem inconnu, à transmettre tel quel ; un méta-modèle `cloud`/`auto` ou l'absence de modèle donne `Some(default)`).

- [ ] **Step 1 : tests qui échouent**
  - `custom_batch_model_is_sent_verbatim` (wiremock) : `transcribe_file` avec `api_base = <mock>/v1`, `model = "mistralai/Voxtral-Mini-3B-2507"`, langue `fr` → une seule requête `POST /v1/audio/transcriptions` dont le corps multipart contient `name="model"` suivi de `mistralai/Voxtral-Mini-3B-2507`, `name="response_format"` + `verbose_json`, `name="language"` + `fr` ; la réponse `{"text":"bonjour","words":[{"word":"bonjour","start":0.0,"end":0.5}]}` donne un transcript « bonjour ».
  - `resolve_batch_model_keeps_unknown_models` : `resolve_batch_model(Some("whisper-large-v3")) == None`, `resolve_batch_model(Some("whisper-1")) == Some(AudioModel::Whisper1)`, `resolve_batch_model(Some("auto")) == Some(default)` ; remplace `resolve_batch_model_defaults_to_gpt_transcribe`.
  - `progressive_batch_rejects_custom_models` : `supports_progressive_batch_model(Some("whisper-large-v3")) == false`.
- [ ] **Step 2 : vérifier l'échec** — `cargo test -p owhisper-client --lib openai` → FAIL (le modèle envoyé est `gpt-transcribe`).
- [ ] **Step 3 : implémenter** — `resolve_batch_model` renvoie `Option<AudioModel>` ; dans le batch, `None` → `openai_compatible_batch::transcribe` avec `provider: "openai"`, `transcription_path: "audio/transcriptions"`, `response_format: Some("verbose_json")`, `timestamp_field: Some("timestamp_granularities[]")`, `include_language: true`, `default_model` = le modèle demandé ; `openai_batch_max_duration` d'un modèle inconnu = la limite de `whisper-1`.
- [ ] **Step 4 : vérifier** — `cargo test --locked -p owhisper-client` → PASS.
- [ ] **Step 5 : commit** — `fix(stt): le batch OpenAI transmet tel quel un nom de modèle on-prem`.

### Task 3 : consommateurs Rust (listener-core, listener2-core, plugins)

**Files :**

- Modify : `crates/listener-core/src/actors/listener/adapters.rs` (imports, `spawn_rx_task` : cas DeepgramFlux et DashScopeStreaming retirés, `dispatch_realtime!` réduit à `OpenAI`, `Nvidia`, `Argmax`, `Anarlog`, liste batch-only vide ou supprimée), `actors/session/types.rs` (choix live/batch : branches ElevenLabs, GoogleGenerativeAi retirées ; tests sur URL deepgram → URL on-prem), `live_transcript/normalizer.rs` (cas `nari`), `actors/session/supervisor.rs` et `live_transcript/tests.rs` (données de test soniox/deepgram → openai/nvidia) ; `crates/listener2-core/src/batch/mod.rs` (`BatchProvider` = `OpenAI`, `Argmax`, `WhisperLocal`, `Am`, `Soniqo`, `AppleSpeech`, `Anarlog` ; `to_adapter_kind`, `run_batch_inner`, `resolve_batch_adapter_kind` sans AmazonBedrock), `batch/simple/direct.rs` (`dispatch_batch!` réduit, Anarlog conservé), `batch/simple/google_cloud.rs` (supprimé), `src/lib.rs` (`suggest_providers_for_languages_*` = providers restants), tests et fixtures Deepgram de `consolidate.rs`, `diarize.rs`, `progressive/actor.rs` (provider de fixture → `openai`) ; `plugins/dictation/src/preview.rs` (arms cloud retirés), `plugins/transcription/src/api.rs` et `batch_transcript.rs` (données de test), `plugins/transcription/js/bindings.gen.ts` (union `BatchProvider` éditée à la main), `plugins/store2/src/commands.rs` (données de test `deepgram` → `openai`), `plugins/listener2/src/{commands.rs,ext.rs}` si elles nomment des providers retirés.

**Interfaces :**

- Consumes : `AdapterKind` et `Provider` de la Task 1.
- Produces : `BatchProvider` (serde/strum, chaînes inchangées pour les variantes conservées : `"openai"`, `"argmax"`, `"whispercpp"`, `"am"`, `"soniqo"`, `"apple-speech"`/existant, `"anarlog"` + alias `"hyprnote"`).

- [ ] **Step 1 : test qui échoue** — créer `apps/desktop/src/stt-on-prem.test.ts` (garde-fou, lu par la CI Vitest) :
  - `it("keeps_only_on_prem_stt_adapters")` : les entrées de `crates/owhisper-client/src/adapter/` sont exactement `anarlog`, `argmax`, `deepgram_compat.rs`, `http.rs`, `language.rs`, `mod.rs`, `nvidia.rs`, `openai`, `openai_compatible_batch.rs`, `owhisper.rs`, `parsing.rs`, `segment.rs`, `streaming_providers_tests.rs`, `tests.rs`, `url_builder.rs`, `whispercpp` (liste ajustée par ruling si un module commun manque).
  - `it("rust_consumers_name_no_cloud_stt_provider")` : aucun de `crates/listener-core/src/actors/listener/adapters.rs`, `crates/listener2-core/src/batch/mod.rs`, `crates/listener2-core/src/batch/simple/direct.rs`, `crates/listener2-core/src/lib.rs`, `plugins/dictation/src/preview.rs`, `crates/owhisper-client/src/providers.rs` ne matche `/\b(deepgram|assemblyai|soniox|speechmatics|gladia|elevenlabs|cartesia|fireworks|dashscope|groq|azure|google_cloud|aws_transcribe|amazon_bedrock|revai|inworld|gradium|modulate|alebex|wisprflow|smallestai|aquavoice|cohere)\b/i`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/stt-on-prem.test.ts` → FAIL tant que les Tasks 1 et 3 ne sont pas faites (si la Task 1 est déjà commitée, seul le second test échoue).
- [ ] **Step 3 : adapter** les fichiers listés.
- [ ] **Step 4 : vérifier** — garde-fou PASS ; `cargo check --workspace --exclude shortcut-macos --exclude tcc --all-targets --locked` → PASS ; `cargo test --locked -p template-app -p db-app -p owhisper-client -p listener-core -p storage -p listener2-core -p tauri-plugin-transcription -p tauri-plugin-dictation -p tauri-plugin-store2` → PASS (hors test instable connu `slow_chunk_sync_…`) ; `cargo clippy` CI → plus aucune erreur dans les adaptateurs supprimés.
- [ ] **Step 5 : commit** — `feat(stt): listener et batch sans adaptateurs cloud`.

### Task 4 : réglages STT côté desktop

**Files :**

- Modify : `apps/desktop/src/settings/ai/stt/shared.tsx` (`_PROVIDERS` = `soniqo`, `apple_speech`, `local_file`, `openai`, `nvidia` ; `openai` : nom « OpenAI-compatible », description « OpenAI Realtime and /v1/audio/transcriptions (vLLM, speaches, faster-whisper-server) », `baseUrl` absent, `requirements` = `base_url` seulement, `models: []` ; `PROVIDER_ORDER` réduit), `settings/ai/stt/configure.tsx` (descriptions par provider), `settings/ai/stt/health.tsx` (vérification Deepgram retirée ; fichier supprimé s'il ne sert qu'à elle), `settings/ai/stt/selection.ts` (modèle libre accepté pour `openai` comme `nvidia`), `stt/useSTTConnection.ts` (`?provider=` posé pour `openai` et `nvidia` ; clé vide acceptée pour les deux), `stt/useRunBatch.ts` (`DIRECT_BATCH_PROVIDERS` et `getBatchProvider` : `openai` → `"openai"`, `nvidia` → `null`, locaux inchangés), `stt/capabilities.ts` (modes par provider restants ; `openai` avec un modèle libre = temps réel + batch), `stt/model-selection.ts` (`DEFAULT_EXTERNAL_STT_MODELS` réduit ; `normalizeStoredSttSelection` vide un provider retiré), `packages/provider-validation/src/index.ts` (sondes des providers retirés supprimées ; `openai` sans clé accepté), `settings/ai/shared/index.tsx` (icône soniox), tests associés (cas cloud supprimés ou portés sur `openai`/`nvidia`).

**Interfaces :**

- Consumes : chaînes `BatchProvider` de la Task 3.
- Produces : `ProviderId` STT = `"soniqo" | "apple_speech" | "local_file" | "openai" | "nvidia"`.

- [ ] **Step 1 : tests qui échouent**
  - `stt-on-prem.test.ts` : `it("stt_settings_offer_only_on_prem_protocols")` : `PROVIDERS.map(p => p.id).sort()` vaut `["apple_speech", "local_file", "nvidia", "openai", "soniqo"]` et l'entrée `openai` n'a pas de `baseUrl`.
  - `model-selection.test.ts` (ou le fichier de test existant de `normalizeStoredSttSelection`) : `clears_removed_cloud_stt_provider` : `{ current_stt_provider: "deepgram", current_stt_model: "nova-3" }` → provider et modèle vides ; idem `"custom"`.
  - `useSTTConnection.test.ts` : `openai_connection_accepts_empty_key_and_marks_provider` : provider `openai`, `base_url = "http://192.168.1.87:8000/v1"`, clé vide → connexion non nulle dont l'URL porte `provider=openai`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/stt-on-prem.test.ts src/stt` → FAIL.
- [ ] **Step 3 : implémenter** les modifications listées.
- [ ] **Step 4 : vérifier** — `pnpm -F desktop test` → PASS ; `pnpm -F desktop typecheck` → PASS ; `pnpm -F @anlg/provider-validation test` (ou typecheck s'il n'a pas de tests) → PASS ; `pnpm lint:eslint --max-warnings=0` sur les fichiers modifiés.
- [ ] **Step 5 : commit** — `feat(stt): réglages réduits aux protocoles on-prem`.

### Task 5 : documentation

**Files :**

- Modify : `docs/conformite/rgpd.md` (état en tête : les providers STT cloud sont retirés ; restent les providers LLM cloud jusqu'au 04b-3 ; flux réseau : STT = endpoints configurés seulement), `NOTICE.md` (adaptateurs STT cloud retirés)
- Test : `apps/desktop/src/docs-rgpd.test.ts`

- [ ] **Step 1 : test qui échoue** — `docs-rgpd.test.ts` : `it("rgpd_lists_stt_as_on_prem_only")` : `rgpd.md` ne contient plus `Deepgram` et contient `04b-3`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/docs-rgpd.test.ts` → FAIL.
- [ ] **Step 3 : rédiger.**
- [ ] **Step 4 : vérifier** — même commande → PASS ; dprint sur les deux fichiers.
- [ ] **Step 5 : commit** — `docs: STT on-prem uniquement dans la note RGPD et NOTICE`.
