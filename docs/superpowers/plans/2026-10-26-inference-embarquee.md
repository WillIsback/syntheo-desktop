# Retrait de l'inférence embarquée (04b-2) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** l'application ne fait plus aucune inférence sur le poste. La transcription passe uniquement par les endpoints on-prem (protocole OpenAI, NVIDIA NIM) et aucun modèle n'est téléchargé. Sont retirés : les moteurs STT locaux (whisper.cpp, Soniqo, Apple Speech, Argmax/`am`, proxy `/stt` local et adaptateur `anarlog`), le LLM embarqué Apple Foundation, la diarisation pyannote locale et les empreintes vocales.

**Architecture :** suppression des plugins `local-stt` et `local-llm` et des crates qu'ils sont seuls à utiliser. Dans `owhisper-client`, `AdapterKind` se réduit à `OpenAI` et `Nvidia`. Dans listener-core, listener2-core et les plugins `transcription` et `dictation`, les chemins locaux disparaissent : sessions Soniqo et Apple Speech, batch local, diarisation locale, consolidation par empreintes vocales qui relit l'audio. Côté desktop, les réglages STT ne proposent plus que les deux protocoles on-prem. L'interface de téléchargement de modèles, les notifications de progression, la recommandation de modèle sur l'appareil et le provider LLM `apple_foundation` sont retirés.

**Tech Stack :** Rust 1.94 (workspace Cargo, plugins Tauri), TypeScript/React (apps/desktop), Vitest.

**Spec :** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md` : Phase 5, « Retirés » : « Inférence embarquée (`local-stt`, whisper.cpp, Soniqo, Apple Speech, `local-llm-core`) : retirée. Tout passe par une API » ; Règle audio, point 6 : « pyannote local est donc **retiré** » ; « Mes choix » : diarisation post-session retirée, seule la diarisation à la volée reste.

## Global Constraints

- Suppression franche : modules, tests, fixtures et dépendances retirés (pas de code commenté, pas de feature flag).
- **Conservés** :
  - `crates/aec` (annulation d'écho de la capture live) ;
  - `crates/vad`, avec la seule feature `earshot` (masque VAD de la capture) ;
  - `crates/onnx` (utilisé par `aec`) ;
  - `crates/download-interface` (utilisé par `crates/file`) ;
  - `crates/data` (fixtures) ;
  - `crates/audio-mock` ;
  - `openai-transcription` et `owhisper-interface` ;
  - la diarisation renvoyée par le serveur STT et la séparation micro/système ;
  - les intégrations Apple locales (EventKit).
- Les crates à retirer sont ceux que plus aucun membre restant n'utilise après suppression des plugins, vérifié par `reach.py` (ou `cargo metadata`). Parmi eux : `local-stt-core`, `local-llm-core`, `local-model`, `model-downloader`, `model-manager`, `gguf`, `lmstudio` (scanner de fichiers GGUF), `transcribe-whisper-local`, `whisper-local`, `whisper-local-model`, `transcribe-soniqo`, `transcribe-speechanalyzer`, `am`, `pyannote-local`, `embedding`, `voiceprint`, `audio-chunking` et, s'il n'est plus atteint, `transcribe-core`. `crates/whisper` (simple énumération de langues) est conservé tant que `crates/language` l'utilise.
- Les providers LLM `lmstudio`, `ollama` et `unsloth` sont des clients HTTP vers des serveurs locaux : ils relèvent du 04b-3 et restent ici.
- `plugins/*/js/bindings.gen.ts` : seule l'union `BatchProvider` de `plugins/transcription` est éditée à la main ; les bindings des plugins supprimés partent avec eux.
- Tests et builds dans les conteneurs ; dprint sur les fichiers modifiés ; textes UI nouveaux en anglais source Lingui.

## Review Focus

- **Réglage enregistré sur un modèle local** (`soniqo`, `apple_speech`, `local_file`, `anarlog` + `soniqo-*`/`apple-speech`/`am-*`, `local_stt_model_path`) : la sélection est vidée au démarrage, sans plantage, et l'app invite à choisir un endpoint → test `clears_local_stt_selection` (Task 3).
- **Session en cours ou relancée** dont le contexte de batch persisté nomme `soniqo`/`whispercpp`/`am` : désérialisation en erreur propre, sans panique, et pas de repli local automatique → test listener2/transcription (Task 2).
- **Fichiers de modèles déjà téléchargés** dans `<data>/models/stt|llm` par une version antérieure : jamais relus ni chargés. Leur suppression reste à l'utilisateur et doit être documentée dans `rgpd.md` → test doc (Task 4).
- **Capture live sans aucun repli local** : quand l'endpoint STT est injoignable, aucune proposition de Soniqo ni de modèle local (`getBatchFallbackTarget`) → test Task 3.
- **Dictée** : sans provider on-prem configuré, la dictée refuse proprement au lieu de démarrer un serveur local → test Task 3 (dictation lifecycle).

---

### Task 1 : Rust — plugins et crates d'inférence embarquée

**Files :**

- Delete :
  - `plugins/local-stt/`, `plugins/local-llm/` ;
  - les crates listés dans les Global Constraints, une fois confirmés non atteints ;
  - dans `crates/owhisper-client` : `adapter/argmax/`, `adapter/whispercpp/`, `adapter/anarlog/`, `adapter/deepgram_compat/`, `adapter/url_builder.rs`, `adapter/owhisper.rs`, `local_soniqo_live.rs`, `local_apple_speech_live.rs` ;
  - dans `crates/listener2-core` : `batch/simple/local.rs`, `batch/diarize.rs`, `batch/consolidate.rs` (consolidation par empreintes vocales) ;
  - dans `plugins/transcription` : `src/voiceprint.rs`.
- Modify :
  - `Cargo.toml` racine : membres et entrées `[workspace.dependencies]`, dépendances externes devenues orphelines par ce lot ;
  - `crates/owhisper-client` : `Cargo.toml` (feature `local`, dépendance `anlg-am`), `src/lib.rs`, `src/adapter/mod.rs` (`AdapterKind` = `OpenAI`, `Nvidia` ; plus de détection du proxy Anarlog ni d'Argmax ; `documented_language_codes_*` = langues Whisper), `src/batch.rs` et `src/live.rs` (branches `is_anarlog_proxy`), tests qui utilisent `AnarlogAdapter` comme fixture (portés sur `OpenAIAdapter`/`NvidiaAdapter`) ;
  - `crates/listener-core` : `Cargo.toml` (deps soniqo/speechanalyzer, feature `local`), `actors/listener/adapters.rs` (dispatch réduit à `OpenAI`/`Nvidia`, fonctions de spawn Soniqo/Apple supprimées), `actors/session/types.rs` (`uses_local_*` et règles locales du choix live/batch), `actors/session/supervisor.rs`, `live_transcript.rs` et `live_transcript/normalizer.rs` (normaliseurs Soniqo et Apple Speech), tests ;
  - `crates/listener2-core` : `Cargo.toml`, `batch/mod.rs` (`BatchProvider` = `OpenAI` seul ; plus de diarisation locale ni de consolidation), `batch/progressive/{mod.rs,bootstrap.rs}` (branches Argmax/WhisperCpp ; `actor.rs` et `segmented.rs` conservés), `batch/simple.rs`, `batch/simple/direct.rs` (`run_anarlog_batch`), `src/lib.rs` (langues soniqo/apple), `test_fixtures.rs` et `simple/tests.rs` (constante `TARGET_SAMPLE_RATE` locale si `transcribe-core` part) ;
  - `plugins/transcription` : `Cargo.toml`, `src/lib.rs` et `build.rs` (commandes voiceprint), `src/error.rs` (`LocalSttError`), `src/listener2/ext.rs` (attente native Soniqo/Apple, `known_speakers`, délai d'inactivité), `src/audio_retention.rs` (nettoyage voiceprint), `src/listener/runtime.rs` (`persist_mic_isolation` si lié aux empreintes), `js/bindings.gen.ts` (union `BatchProvider`, commandes voiceprint) ;
  - `plugins/dictation/src/preview.rs` (arms `anarlog` et `argmax`) ;
  - `apps/desktop/src-tauri` : `Cargo.toml` (`tauri-plugin-local-llm`, `tauri-plugin-local-stt`, cible macOS aarch64), `src/lib.rs` (enregistrement des deux plugins, bloc mort `local_llm().start_server()`, superviseur racine s'il n'a plus d'enfant), `src/supervisor.rs` (supprimé dans ce cas), `capabilities/default.json` (`local-llm:default`, `local-stt:default`) ;
  - `crates/vad/Cargo.toml` (feature `silero-onnx` si plus utilisée).
- Test : `apps/desktop/src/stt-on-prem.test.ts`

**Interfaces :**

- Produces : `AdapterKind::{OpenAI, Nvidia}` ; `BatchProvider::OpenAI` (sérialisé `"openai"`) ; plus aucune commande Tauri `local-stt:*`, `local-llm:*` ni `*voiceprint*`.

- [ ] **Step 1 : tests qui échouent** — dans `stt-on-prem.test.ts` :
  - `keeps_only_on_prem_stt_adapters` attend désormais exactement `http.rs`, `language.rs`, `mod.rs`, `nvidia.rs`, `openai`, `openai_compatible_batch.rs`, `parsing.rs`, `segment.rs`, `streaming_providers_tests.rs`, `tests.rs`.
  - `it("removes_embedded_inference")` : `plugins/local-stt`, `plugins/local-llm`, `crates/transcribe-soniqo`, `crates/transcribe-speechanalyzer`, `crates/whisper-local`, `crates/pyannote-local`, `crates/voiceprint`, `crates/embedding`, `crates/local-model`, `crates/model-downloader` n'existent plus.
  - `it("rust_consumers_name_no_local_engine")` : aucun de `crates/listener-core/src/actors/listener/adapters.rs`, `crates/listener2-core/src/batch/mod.rs`, `plugins/dictation/src/preview.rs`, `apps/desktop/src-tauri/src/lib.rs` ne matche `/soniqo|speechanalyzer|apple_speech|whisper_?cpp|argmax|local_stt|local_llm|voiceprint|pyannote/i`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/stt-on-prem.test.ts` → FAIL sur les trois tests.
- [ ] **Step 3 : supprimer et adapter** les fichiers listés. Régénérer `Cargo.lock`.
- [ ] **Step 4 : vérifier** :
  - garde-fou → PASS ;
  - `cargo check --workspace --all-targets --locked` (hors crates macOS seulement s'il en reste) → PASS ;
  - `cargo check -p desktop --all-targets --features dev,devtools,direct-distribution,automation --locked` → PASS ;
  - `cargo test --locked -p template-app -p db-app -p owhisper-client -p listener-core -p storage -p listener2-core -p tauri-plugin-transcription -p tauri-plugin-dictation` → PASS (hors test instable connu) ;
  - `reach.py` : non atteints = `audio-mock`, `chrome-native-host`, `tcc`, `xtask` seulement.
- [ ] **Step 5 : commit** — `feat(local-inference): retrait des moteurs STT et LLM embarqués`.

### Task 2 : contexte batch persisté et reprise

**Files :**

- Modify : `plugins/transcription/src/listener2/ext.rs` ou le module qui désérialise les sessions de transcription persistées
- Test : même module

- [ ] **Step 1 : test qui échoue** — `restored_session_with_local_provider_fails_cleanly` : un JSON de session persistée avec `"provider": "soniqo"` (et un second avec `"whispercpp"`) est rejeté par une erreur typée, ou ignoré avec un journal, sans panique et sans lancer de transcription. Le test vérifie le chemin réel de reprise (`list_transcription_sessions` ou équivalent), pas seulement serde.
- [ ] **Step 2 : vérifier l'échec**, ou constater qu'il passe déjà. Dans ce cas, ruling : le test reste comme garde-fou.
- [ ] **Step 3 : implémenter** le rejet ou l'ignorance propre si nécessaire.
- [ ] **Step 4 : vérifier** — `cargo test --locked -p tauri-plugin-transcription` → PASS.
- [ ] **Step 5 : commit** — `fix(transcription): sessions persistées d'un moteur local ignorées proprement`.

### Task 3 : desktop — réglages et parcours sans moteur local

**Files :**

- Modify :
  - `apps/desktop/package.json` (`@anlg/plugin-local-stt`, `@anlg/plugin-local-llm` retirés) ;
  - `settings/ai/stt/shared.tsx` (`_PROVIDERS` = `openai`, `nvidia`) ;
  - `settings/ai/stt/select.tsx` (téléchargement, suppression et liste de modèles locaux, recommandation sur l'appareil) ;
  - `settings/ai/stt/{context.tsx,health.tsx,model-icon.tsx,selection.ts}` ;
  - `stt/{capabilities.ts,model-selection.ts,useSTTConnection.ts,useRunBatch.ts,capture-lifecycle.ts,live-transcript-interrupted.ts,queries.ts}` (`promoteVoiceprintCandidates`) ;
  - `contexts/notifications.tsx` (progression de téléchargement) ;
  - `settings/queries.ts` (`start/stopServer`) ;
  - `store/zustand/listener/general-batch.ts` ;
  - `store/zustand/pending-stt-selection.ts` ;
  - `sidebar/toast/registry.tsx` (toasts local-stt et téléchargement) ;
  - LLM : `settings/ai/llm/shared.tsx` (provider `apple_foundation`), `ai/apple-foundation-model.ts`, `settings/ai/shared/list-apple-foundation.ts` et leurs usages (`useLLMConnection.ts`, `ai-task/tasks.ts`, `llm/select.tsx`, `llm/configure.tsx`, `reasoning-effort.ts`).
- Delete : `stt/useLocalSttModel.ts`, `settings/ai/stt/on-device-recommendation.ts`, `settings/ai/stt/local-file-model.tsx` et leurs tests, plus les tests dont l'unique objet est un moteur local.
- Test : `stt/model-selection.test.ts`, `stt/useRunBatch.test.ts`, `dictation/lifecycle.test.tsx`, `stt-on-prem.test.ts`

**Interfaces :**

- Consumes : `BatchProvider = "openai"` (Task 1).
- Produces : `ProviderId` STT = `"openai" | "nvidia"`.

- [ ] **Step 1 : tests qui échouent**
  - `model-selection.test.ts` : `it.each([["soniqo", "soniqo-parakeet-streaming"], ["apple_speech", "apple-speech"], ["local_file", "local-file"], ["anarlog", "soniqo-parakeet-batch"], ["anarlog", "am-parakeet-v3"]])("clears_local_stt_selection %s/%s")` → `{ provider: "", model: "" }`.
  - `useRunBatch.test.ts` : `no_local_fallback_when_endpoint_unreachable` : `getBatchFallbackTarget` (ou ce qui le remplace) ne renvoie jamais de cible locale ; si la fonction disparaît, le test vérifie qu'un échec du batch on-prem ne lance pas de seconde transcription.
  - `dictation/lifecycle.test.tsx` : `dictation_without_on_prem_provider_refuses` : sans provider STT configuré, la dictée renvoie l'erreur de configuration attendue et n'appelle aucune commande `local-stt`.
  - `stt-on-prem.test.ts` : `stt_settings_offer_only_on_prem_protocols` attend `["nvidia", "openai"]` ; `it("desktop_imports_no_local_engine")` : aucun fichier non-test de `apps/desktop/src` n'importe `@anlg/plugin-local-stt` ni `@anlg/plugin-local-llm`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm -F desktop exec vitest run src/stt-on-prem.test.ts src/stt src/dictation` → FAIL.
- [ ] **Step 3 : implémenter.** Les tests qui utilisent `soniqo`/`apple_speech`/`local_file`/`anarlog` comme fixture d'un comportement générique sont portés sur `openai`/`nvidia`. Ceux qui ne testent qu'un moteur local sont supprimés.
- [ ] **Step 4 : vérifier** :
  - `pnpm -F desktop test` → PASS ;
  - `pnpm -F desktop typecheck` → PASS ;
  - `pnpm install --frozen-lockfile` → PASS, sinon lockfile régénéré ;
  - `pnpm exec vite build` dans apps/desktop → PASS ;
  - eslint et dprint sur les fichiers modifiés.
- [ ] **Step 5 : commit** — `feat(local-inference): réglages et parcours sans moteur local`.

### Task 4 : documentation

**Files :**

- Modify : `docs/conformite/rgpd.md`, `NOTICE.md`
- Test : `apps/desktop/src/docs-rgpd.test.ts`

- [ ] **Step 1 : test qui échoue** — `rgpd_lists_no_model_download` :
  - `rgpd.md` ne contient plus `models.anarlog.so` ;
  - il mentionne les dossiers `models/stt` et `models/llm` laissés par d'anciennes versions, à supprimer à la main ;
  - il ne parle plus d'empreintes vocales ni de diarisation locale.

  Le test existant `docs_rgpd_lists_every_known_flow_and_store` retire `models.anarlog.so` de sa liste.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : rédiger.** `rgpd.md` : flux réseau (plus de téléchargement de modèles) ; données stockées (plus d'empreintes vocales ; dossiers de modèles hérités) ; garanties. `NOTICE.md` : inférence embarquée retirée.
- [ ] **Step 4 : vérifier** — `pnpm -F desktop exec vitest run src/docs-rgpd.test.ts` → PASS ; dprint.
- [ ] **Step 5 : commit** — `docs: plus d'inférence embarquée dans la note RGPD et NOTICE`.
