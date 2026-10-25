# Aucun audio sur disque pendant la capture (04c-A) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une réunion capturée par Syntheo Desktop n'écrit plus jamais d'audio sur disque. L'audio va du capteur à l'endpoint STT en mémoire ; un échec STT laisse un trou daté dans le transcript, sans offre de batch ni de lecture.

**Architecture :** le superviseur de session ne démarre plus l'acteur recorder (la source accepte déjà `recorder: None`). La rétention est figée à « aucune » de bout en bout (Rust, réglages, UI), le balayage de rétention restant actif comme filet de sécurité pour l'audio hérité. La récupération après échec STT n'a plus d'audio à relire : elle enregistre des intervalles d'interruption datés, persistés avec le résultat de capture et affichés dans le transcript. Lecteur audio, retranscription et voiceprints, qui relisaient l'audio stocké, sont retirés.

**Tech Stack :** Rust (ractor, `crates/listener-core`, `plugins/transcription`), Tauri 2, React 19, TypeScript, Vitest, conteneur `syntheo-dev:1`.

**Spec :** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md`, section « Règle audio : zéro conservation (couche 04c) ».

**Découpage du chantier 04c :** ce plan (04c-A) couvre la capture de réunion et tous les critères « Fait quand » de la spec. Le plan 04c-B traitera les autres écritures temporaires d'audio, qui passent par un autre pipeline : dictée (WAV dans le temp de l'OS, `plugins/dictation/src/recorder.rs`), import et dépôt de fichier (copie normalisée en `audio.mp3`, `crates/fs-sync-core/src/audio/mod.rs`, staging `crates/agent-access/src/recording_import.rs`), segments temporaires du batch (`crates/listener2-core/src/batch/`), `afconvert`. D'ici là, `docs/conformite/rgpd.md` les signale.

## Global Constraints

- « L'audio n'est jamais conservé. Il ne vit qu'en mémoire, le temps d'être envoyé à l'endpoint STT. Seuls le transcript et la note sont persistés. » (spec)
- Aucun fichier `*.mp3`, `*.wav`, `*.part` ni dossier `audio-recovery/` créé dans le dossier de session pendant ou après une capture.
- Échec STT : « trou daté (« transcription interrompue 14:32–14:35 ») » et reconnexion ; « aucune proposition de batch ni de lecture » (spec).
- Interface en français pour tout texte nouveau ou modifié.
- Aucune réintroduction de cloud, de télémétrie ni de compte ; le garde-fou `apps/desktop/src/no-cloud-imports.test.ts` reste vert.
- Tests et builds dans le conteneur `syntheo-dev:1` ; formatage par `dprint` (y compris le Rust) ; `Cargo.lock` mis à jour sur l'hôte par `cargo metadata --format-version 1`.

## Review Focus

- Endpoint STT injoignable dès le début de la capture (jamais connecté) : la capture continue, un trou est ouvert depuis 0 et apparaît daté dans le transcript ; aucune offre de batch → test `never_connected_capture_records_gap_from_start` (Task 4).
- Audio hérité d'une version antérieure (`audio.mp3`, `audio-recovery/*.mp3` déjà sur disque) : supprimé par le balayage de rétention, quelle qu'ait été la rétention choisie → test `legacy_session_audio_is_swept_under_forced_none` (Task 2).
- Modèle « After recording » (batch seul) encore sélectionné depuis une ancienne configuration : la capture refuse de démarrer avec un message explicite au lieu d'enregistrer sans transcrire → test `batch_only_model_cannot_start_capture` (Task 3).
- Plusieurs coupures dans une même réunion : chaque intervalle est listé, dans l'ordre, au format `HH:MM–HH:MM` → test `incomplete_capture_banner_lists_dated_gaps` (Task 4).
- Fichier importé (inchangé jusqu'au 04c-B) : toujours transcrit, et son audio supprimé dès la transcription réussie puisque la rétention est « aucune » → test `imported_audio_is_deleted_after_transcription` (Task 3).

---

### Task 1 : superviseur de session sans recorder (Rust)

**Files :**

- Modify : `crates/listener-core/src/actors/session/supervisor/children.rs` (`spawn_recorder` et `try_restart_recorder` retirés), `crates/listener-core/src/actors/session/supervisor.rs` (`pre_start` sans recorder, message `SessionMsg::RetryRecorder` et `RECORDER_RETRY_DELAY` retirés, `emit_storage_error` lié au recorder retiré), `crates/listener-core/src/actors/session/types.rs` (`retain_audio` ignoré : la session ne conserve jamais d'audio)
- Test : `crates/listener-core/src/actors/session/supervisor/reliability_tests.rs`, `supervisor.rs` (tests)

**Interfaces :**

- Consumes : la source accepte déjà `recorder: Option<ActorRef<RecMsg>>` = `None` (`source/mod.rs:80`, `pipeline.rs:153`).
- Produces : une session ne crée aucun fichier audio ; `emit_session_ended` publie `audio_path: None` (le front saute alors tout batch post-arrêt).

- [ ] **Step 1 : test qui échoue** — `supervisor_writes_no_audio_to_session_dir` dans `reliability_tests.rs`, sur le modèle de `refreshed_credentials_resume_live_transcription_after_authentication_failure` : une session complète (source simulée émettant au moins 90 s d'audio, listener simulé), avec `retain_audio = Some(true)` pour prouver que le paramètre est ignoré ; après l'arrêt, un parcours récursif du dossier de session ne trouve aucun fichier dont l'extension est `mp3`, `wav`, `ogg` ou `part`, ni de dossier `audio-recovery`, ni de fichier `.delete-audio-on-stop`.
- [ ] **Step 2 : vérifier l'échec** — `cargo test --locked -p listener-core supervisor_writes_no_audio_to_session_dir` → FAIL (un morceau `audio-recovery/*.mp3` et `audio.mp3` existent).
- [ ] **Step 3 : implémenter** — retirer le démarrage du recorder et sa boucle de redémarrage ; la source reçoit `None`. Le module `actors/recorder/` reste compilé (utilisé par `cleanup_interrupted_audio` au démarrage pour l'audio hérité) mais n'est plus démarré par une session. Supprimer les tests devenus sans objet (`recorder_failure_keeps_the_listener_and_session_running`, `next_recorder_runs_while_previous_listener_finalizes`) et adapter ceux qui comptent des morceaux (`refreshed_credentials_resume_…` attend 0 morceau ; `shutdown_children_waits_in_source_listener_recorder_order` vérifie l'ordre source → listener).
- [ ] **Step 4 : vérifier** — `cargo test --locked -p listener-core` → PASS ; `cargo check --locked -p desktop` → PASS.
- [ ] **Step 5 : commit** — `feat(audio): la session de capture ne démarre plus le recorder`.

### Task 2 : rétention figée à « aucune » côté plugin (Rust)

**Files :**

- Modify : `plugins/transcription/src/api.rs` (conversion de `CaptureParams` : `retain_audio` forcé à `Some(false)`, champ conservé pour ne pas casser les bindings), `plugins/transcription/src/audio_retention.rs` (`resolve_policy` renvoie toujours la politique « aucune » ; le balayage `sweep` reste actif), `crates/db-app/src/managed_settings.rs` (les réglages gérés exigent `audio_retention == "none"` au lieu de `"forever"`)
- Test : tests de ces trois fichiers

**Interfaces :**

- Produces : quel que soit le réglage stocké (y compris `forever` hérité), le balayage supprime l'audio de session existant.

- [ ] **Step 1 : tests qui échouent** — `capture_params_never_retain_audio` (`api.rs` : une conversion avec `retain_audio: Some(true)` donne `Some(false)`) ; `retention_policy_is_always_none` (`audio_retention.rs` : `resolve_policy` avec un réglage `"forever"` ou `"oneWeek"` renvoie la politique « aucune ») ; `legacy_session_audio_is_swept_under_forced_none` (`audio_retention.rs` : un dossier de session temporaire contenant `audio.mp3` et `audio-recovery/x.mp3`, réglage stocké `"forever"`, un passage de `sweep` les supprime) ; `managed_settings_require_no_audio_retention` (`managed_settings.rs` : `"none"` accepté, `"forever"` refusé).
- [ ] **Step 2 : vérifier l'échec** — `cargo test --locked -p tauri-plugin-transcription -p db-app` → FAIL sur ces quatre tests.
- [ ] **Step 3 : implémenter** selon Files ; adapter les tests existants qui supposaient une rétention (`audio_retention.rs:340`, `372`, `394`, `capture_markers.rs:300`).
- [ ] **Step 4 : vérifier** — `cargo test --locked -p tauri-plugin-transcription -p db-app -p listener-core` → PASS.
- [ ] **Step 5 : commit** — `feat(audio): rétention audio figée à aucune`.

### Task 3 : capture sans rétention côté front, réglages et voiceprints retirés

**Files :**

- Modify : `apps/desktop/src/stt/useStartListening.ts` (`retainAudio` vaut toujours `false` ; refus de démarrer avec un modèle batch seul), `apps/desktop/src/stt/capture-lifecycle.ts` (`retainAudio` toujours `false`, appel `maybeExtractVoiceprintCandidates` retiré), `apps/desktop/src/stt/useRunBatch.ts` (appel voiceprint retiré), `apps/desktop/src/stt/capabilities.ts` (`requiresRetainedBatchAudio` supprimé), `apps/desktop/src/shared/config/index.ts` (`audio_retention` résolu toujours à `"none"`), `apps/desktop/src/settings/general/audio-settings.tsx` (`AudioRetentionRow` et la ligne « Remember speakers » retirées), `apps/desktop/src/settings/general/index.tsx` (props `audioRetention` retirées)
- Delete : `apps/desktop/src/services/voiceprint.ts` (et son test)
- Test : `stt/useStartListening.test.ts`, `shared/config/index.test.tsx`, `settings/general/audio-settings.test.tsx`, `stt/useRunBatch.test.ts`

**Interfaces :**

- Consumes : `getSttModelTranscriptionMode(provider, model): "batch" | "live" | undefined` (`stt/capabilities.ts:186`).
- Produces : `BATCH_ONLY_CAPTURE_MESSAGE` exporté de `useStartListening.ts`, valeur exacte : `"Ce modèle ne transcrit qu'après l'enregistrement, ce qui supposerait de conserver l'audio. Choisissez un modèle de transcription en temps réel."`

- [ ] **Step 1 : tests qui échouent** —
  - `start_listening_never_retains_audio` : avec `audio_retention = "forever"` stocké et un modèle temps réel, l'appel de démarrage natif reçoit `retain_audio: false`.
  - `batch_only_model_cannot_start_capture` : avec un modèle pour lequel `getSttModelTranscriptionMode` renvoie `"batch"`, aucun démarrage natif, et un toast d'erreur affiche `BATCH_ONLY_CAPTURE_MESSAGE`.
  - `audio_retention_config_is_always_none` : `useConfigValue("audio_retention")` vaut `"none"` même si `"forever"` est stocké.
  - `audio_settings_offer_no_retention_or_voiceprint` : le rendu des réglages audio ne contient ni « Audio file retention » ni « Remember speakers ».
  - `imported_audio_is_deleted_after_transcription` : un batch réussi sur un fichier importé appelle `deleteProcessedAudioForRetention` avec la rétention `"none"`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm exec vitest run src/stt src/shared/config src/settings/general` → FAIL sur ces tests.
- [ ] **Step 3 : implémenter** selon Files ; supprimer les tests qui exerçaient la rétention ou les voiceprints ; `pnpm exec lingui extract` si des chaînes disparaissent.
- [ ] **Step 4 : vérifier** — `pnpm exec vitest run && pnpm exec tsc --noEmit -p .` (dans `apps/desktop`) → PASS.
- [ ] **Step 5 : commit** — `feat(audio): capture sans rétention, réglage et voiceprints retirés`.

### Task 4 : échec STT → trou daté, sans batch ni audio sauvegardé

**Files :**

- Modify : `apps/desktop/src/stt/capture-audio-recovery.ts` (`batchOnly()` ouvre toujours un trou ; nouvelle méthode `interruptions(): RecoveryInterval[]` qui renvoie les trous fermés plus le trou ouvert clos à `elapsed()`), `apps/desktop/src/stt/capture-result.ts` (`saveIncompleteCapture` accepte `interruptions?: { startedAt: number; endedAt: number }[]` en millisecondes epoch ; `useIncompleteCapture` les renvoie), `apps/desktop/src/stt/capture-lifecycle.ts` (à l'arrêt, persiste les interruptions converties en epoch via le `startedAt` de la capture), `apps/desktop/src/session/components/note-input/transcript/index.tsx` (bandeau), `apps/desktop/src/stt/live-transcript-interrupted.ts` (texte en direct), `apps/desktop/src/stt/useStartListening.ts` et `apps/desktop/src/store/zustand/listener/general-live.ts` (toasts « Audio is being saved… », « Missing text will be recovered from temporary audio… » et « Audio saving… » retirés)
- Delete : `apps/desktop/src/stt/saved-capture-audio.tsx` (+ test) et son déclenchement `markCaptureAudioSaved` (`resume-listening.ts`)
- Test : `stt/capture-audio-recovery.test.ts`, `stt/live-transcript-interrupted.test.ts`, test du bandeau à créer dans `session/components/note-input/transcript/index.test.tsx` s'il n'existe pas

**Interfaces :**

- Consumes : `RecoveryInterval = { start: number; end: number }` (ms relatives au début de capture), `saveIncompleteCapture(sessionId, transcriptId, audioDeleted, audioDeletionFailed?, audioKeptForTranscription?)`.
- Produces : `formatInterruption(i: { startedAt: number; endedAt: number }, timeZone?: string): string` dans `capture-result.ts`, qui rend `"14:32–14:35"` (heures locales, tiret demi-cadratin U+2013).

- [ ] **Step 1 : tests qui échouent** —
  - `stt_failure_records_dated_gap_without_batch_offer` : `interrupted()` à t = 10 s puis `connected()` à t = 40 s → `interruptions()` vaut `[{ start: ≤ 10000, end: 40000 }]` et `repair` n'est jamais appelé.
  - `never_connected_capture_records_gap_from_start` : `batchOnly()` dès le départ sans `connected()`, arrêt à t = 60 s → un intervalle commençant à 0 et finissant à 60000.
  - `incomplete_capture_banner_lists_dated_gaps` : avec deux interruptions (14:32–14:35 puis 15:01–15:02, fuseau `Europe/Paris`), le bandeau affiche « Transcription interrompue 14:32–14:35, 15:01–15:02 » et ne contient ni « audio » ni « Re-transcribe ».
  - `live_interrupted_notice_mentions_no_saved_audio` : le texte en direct est « Transcription interrompue depuis HH:MM, reconnexion en cours. Aucun audio n'est conservé : ce passage manquera au transcript. » et ne contient plus `SAVED_AUDIO_NOTE`.
- [ ] **Step 2 : vérifier l'échec** — `pnpm exec vitest run src/stt src/session/components/note-input/transcript` → FAIL sur ces tests.
- [ ] **Step 3 : implémenter** selon Files. Le bandeau n'affiche plus les variantes « Audio could not be deleted », « kept it temporarily », « according to your retention setting » ; s'il n'y a pas d'interruption datée mais que la capture est incomplète, il affiche « Ce transcript est incomplet. ». Supprimer ou adapter les tests qui supposaient de l'audio conservé (`saved-capture-audio.test.tsx`, `live-capture-recovery.test.tsx:238`, `268`).
- [ ] **Step 4 : vérifier** — `pnpm exec vitest run && pnpm exec tsc --noEmit -p .` → PASS.
- [ ] **Step 5 : commit** — `feat(audio): un échec STT laisse un trou daté, sans audio sauvegardé`.

### Task 5 : lecteur audio et retranscription retirés

**Files :**

- Delete : `apps/desktop/src/audio-player/` (+ tests), `apps/desktop/src/session/top-audio-player.ts` s'il n'a plus d'appelant
- Modify : les importeurs listés par `rg -n '~/audio-player|audio-player/' apps/desktop/src` (`session/index.tsx`, `note-input/raw.tsx`, `note-input/header-transcript.tsx`, `outer-header/index.tsx`, `outer-header/overflow/index.tsx`, `note-input/transcript/state.ts`, `note-input/transcript/renderer/*` — le clic sur un mot ne lance plus de lecture —, `store/zustand/listener/general-live.ts` — `prepareSessionPeaks` retiré) ; actions « Re-transcribe » et « Delete recording » (`header-transcript.tsx`, `outer-header/overflow/index.tsx`), état vide « Audio available / Re-transcribe this audio » (`transcript/screens/empty.tsx`), `useRegenerateTranscript` (`transcript/actions.ts`). « Upload audio » et l'import restent (04c-B).
- Test : `apps/desktop/src/no-audio-at-rest.test.ts` (nouveau garde-fou), tests des composants modifiés

**Interfaces :**

- Produces : garde-fou qui interdit, dans le code de production, `"~/audio-player"`, `useRegenerateTranscript`, `prepareSessionPeaks` et `requiresRetainedBatchAudio`, et exige l'absence du dossier `audio-player/`.

- [ ] **Step 1 : test qui échoue** — `no_audio_playback_or_retranscription` dans `no-audio-at-rest.test.ts`, sur le modèle de `no-cloud-imports.test.ts` (parcours de `src/` hors tests et `i18n`).
- [ ] **Step 2 : vérifier l'échec** — `pnpm exec vitest run src/no-audio-at-rest` → FAIL (dossier et importeurs présents).
- [ ] **Step 3 : implémenter** selon Files ; `pnpm exec lingui extract --clean`.
- [ ] **Step 4 : vérifier** — `pnpm exec vitest run && pnpm exec tsc --noEmit -p .` et `pnpm exec oxlint --quiet src` → PASS.
- [ ] **Step 5 : commit** — `feat(audio): lecteur audio et retranscription retirés`.

### Task 6 : documentation

**Files :**

- Modify : `docs/conformite/rgpd.md` (la capture de réunion n'écrit plus d'audio ; écarts restants jusqu'au 04c-B : dictée, import et dépôt de fichier, segments temporaires du batch), `NOTICE.md` (lecteur audio, retranscription, voiceprints et réglage de rétention retirés)
- Test : `apps/desktop/src/docs-rgpd.test.ts`

- [ ] **Step 1 : test qui échoue** — `docs_rgpd_reflects_capture_without_audio` : `rgpd.md` ne contient plus `audio_retention` vaut \`forever\` par défaut ni « l'enregistrement audio est encore écrit sur disque pendant la capture », et contient « dictée » et « import » dans la description des écarts restants.
- [ ] **Step 2 : vérifier l'échec** — `pnpm exec vitest run src/docs-rgpd` → FAIL.
- [ ] **Step 3 : implémenter** selon Files ; `dprint fmt` des fichiers modifiés.
- [ ] **Step 4 : vérifier** — `pnpm exec vitest run` → PASS.
- [ ] **Step 5 : commit** — `docs(rgpd): capture sans audio sur disque` puis PR du lot (issue liée, auto-merge, miroir Forgejo).

**Vérification de bout en bout (hors CI, sur un build Linux)** : capturer 30 min contre le NIM ASR du GB10, puis `find ~/.local/share/syntheo -newer <marqueur> -type f \( -name '*.mp3' -o -name '*.wav' -o -name '*.part' -o -path '*audio-recovery*' \)` ne renvoie rien ; couper l'endpoint au milieu donne un trou daté et aucune offre de batch. À faire avant la release qui embarque ce lot ; ne jamais modifier l'état du DGX.
