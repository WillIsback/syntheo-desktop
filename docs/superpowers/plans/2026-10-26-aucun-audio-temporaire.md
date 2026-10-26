# Aucun audio temporaire sur disque (04c-B) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une fois ce lot terminé, Syntheo Desktop n'écrit plus **aucun** fichier audio sur
disque, même temporairement : la dictée, l'import de fichier et la transcription batch
travaillent en mémoire, et la source fournie par l'utilisateur est lue à son emplacement
d'origine sans copie dans le dossier de données. Le code mort laissé par le lot 04c-A
(recorder jamais démarré) est retiré.

**Architecture :** le moteur batch (`crates/listener2-core`) prend aujourd'hui un
`file_path: String` et écrit ses segments dans un `TempDir`. On le généralise à une
**source** `Path` ou `Bytes` : la décodage/segmentation se fait sur un `Cursor` (ou en
flux) et les segments sont matériés dans des `Vec<u8>`. La dictée produit un WAV en
mémoire au lieu d'un `tempfile` ; l'import passe le chemin d'origine au batch sans copie.
Côté session, `audio.mp3` cesse d'exister pour les imports : le catalogue et la rétention
sont ajustés en conséquence.

**Tech Stack :** Rust 1.94, `reqwest` multipart, `hound` (WAV), `rodio`/`symphonia`
(decodage), `anlg-mp3` (encodage), Tauri 2, React 19, TypeScript, Vitest.

**Spec :** `docs/superpowers/specs/2026-10-24-syntheo-desktop-migration-design.md`, section
« Règle audio : zéro conservation » (couche 04c) et « Import de fichier ».
**Plan amont :** `docs/superpowers/plans/2026-10-25-aucun-audio-sur-disque.md` (lot 04c-A,
la capture de réunion — déjà fusionné).

## Global Constraints

- **Règle audio** : jamais d'écriture sur disque, **pas même temporaire**, sur aucun des
  trois chemins (dictée, import, batch).
- Le fichier importé par l'utilisateur est lu à son **emplacement d'origine** ; aucune
  copie dans le dossier de données de l'application.
- Inférence on-prem uniquement ; clé API facultative.
- Pas de régression sur la **reprise** : un import qui échoue ne doit plus laisser de
  copie temporaire.
- Textes d'interface nouveaux en français ; les catalogues i18n générés ne s'éditent pas à
  la main.
- Un lot = une PR ; commits au format Conventional Commits, `[skip release]` dans le titre
  de la PR tant que les chantiers 04b/04c ne sont pas tous fusionnés.

## Review Focus

- Une dictée de 30 s sur un endpoint on-prem : aucun `*.wav` dans le dossier temporaire
  du système après coup (test garde-fou + vérification `find` manuelle).
- Un import de fichier de 40 min dépassant la limite du provider : les segments sont
  encodés en mémoire, aucun `segment-*.mp3` n'apparaît dans le dossier temporaire.
- Un import interrompu (annulation ou erreur réseau) : le fichier d'origine est intact,
  aucune copie n'existe dans `sessions/<id>/`.
- Une reprise après plantage : aucune trace d'audio dans le dossier de session ni dans le
  dossier temporaire.

---

### Task 1: Le moteur batch accepte une source en mémoire

**Files:**
- Modify: `crates/listener2-core/src/batch/mod.rs` (`BatchParams`), `crates/listener2-core/src/batch/upload.rs` (`segment_plan`, `split_batch_upload`, `temporary_audio_directory`), `crates/listener2-core/src/batch/simple/direct.rs`, `crates/listener2-core/src/batch/progressive/segmented.rs`, `crates/listener2-core/src/batch/progressive/bootstrap.rs`
- Modify: `crates/owhisper-client/src/adapter/http.rs` (`streaming_file_part`), `crates/owhisper-client/src/adapter/openai/batch.rs`, `crates/owhisper-client/src/adapter/openai_compatible_batch.rs`
- Modify: `crates/mp3/src/segment.rs` (`encode_mono_segments`)
- Modify: `plugins/transcription/src/api.rs` (`TranscriptionParams`), `plugins/transcription/src/listener2/{commands.rs,ext.rs}`, `plugins/transcription/js/bindings.gen.ts`
- Modify: `apps/desktop/src/stt/useRunBatch.ts`
- Create: `crates/listener2-core/src/batch/source.rs` (type `AudioSource` + helpers)

**Interfaces:**
- Produces : `enum AudioSource { Path(PathBuf), Bytes { data: Arc<Vec<u8>>, file_name: String } }` ;
  `BatchParams::source: AudioSource` (remplace `file_path: String`) ;
  `segment_plan(source: &AudioSource, limit: BatchUploadLimit) -> Option<SegmentPlan>` (la
  longueur vient du `metadata` **ou** de `data.len()`) ;
  `encode_mono_segments(source: &AudioSource, segment_duration: Duration) -> Result<Vec<Vec<u8>>>`
  (segments en mémoire) ;
  `streaming_file_part(bytes: Arc<Vec<u8>>, file_name: &str, mime: &str) -> Part`.
- `AudioSource::Path` ne doit **jamais** écrire : lecture seule + streaming.

- [x] **Step 1 :** Écrire les tests qui échouent dans
  `crates/listener2-core/tests/no_disk_audio.rs` :
  - `segments_are_encoded_in_memory` : une source `Bytes` (WAV synthétique > limite) produit
    ≥ 2 segments non vides et **aucun** fichier `*.mp3` n'existe sous `std::env::temp_dir()` ;
  - `path_source_is_never_copied` : une source `Path` transcrit sans créer de fichier dans le
    dossier de données (assertion sur un `tempdir` dédié) ;
  - `missing_source_is_a_configuration_error` : une source `Path` inexistante échoue avec une
    erreur explicite, sans panique.
- [x] **Step 2 :** Lancer → échecs attendus (le type `AudioSource` n'existe pas).
- [x] **Step 3 :** Implémenter : `AudioSource`, `segment_plan`, `encode_mono_segments` en
  mémoire, `streaming_file_part` à partir de bytes, propagation dans les deux chemins batch
  (direct et progressif) et jusqu'à `TranscriptionParams`/`useRunBatch`.
- [x] **Step 4 :** `cargo test -p listener2-core -p owhisper-client -p anlg-mp3 --locked`,
  `cargo check -p tauri-plugin-transcription`, Vitest `src/stt/useRunBatch.test.ts` verts.
- [x] **Step 5 :** Commit `refactor(batch): transcrire depuis une source en mémoire`.

### Task 2: La dictée n'écrit plus de WAV temporaire

**Files:**
- Modify: `plugins/dictation/src/recorder.rs` (`Recorder`, `RecordedAudio`), `plugins/dictation/src/commands.rs` (`stop_recording`, `discard_recording`), `plugins/dictation/js/{index.ts,bindings.gen.ts}`
- Modify: `apps/desktop/src/chat/components/input/use-dictation.ts`, `apps/desktop/src/dictation/lifecycle.tsx`
- Test: `plugins/dictation/src/recorder.rs` (unitaires), `apps/desktop/src/dictation/*.test.*`

**Interfaces:**
- Consumes : `AudioSource::Bytes` (Task 1).
- Produces : `RecordedAudio { pcm_or_wav: Vec<u8>, mime: String, duration_ms: u64 }` (plus de
  `file_path`) ; `discard_recording` retiré.

- [x] **Step 1 :** Tests qui échouent : `recording_keeps_no_file_on_disk` (après
  `start`→`stop`, `std::env::temp_dir()` ne contient aucun `anarlog-dictation-*`),
  `recording_returns_playable_wav_bytes` (en-tête WAV valide, durée ≈ attendue).
- [x] **Step 2 :** Lancer → échecs attendus.
- [x] **Step 3 :** Remplacer `tempfile` + `hound::WavWriter` par un `WavWriter<Cursor<Vec<u8>>>` ;
  adapter `commands.rs` et le front (plus de `discardTemporaryRecording`, plus de chemin).
- [x] **Step 4 :** `cargo test -p tauri-plugin-dictation --locked`, Vitest
  `src/dictation/` et `src/chat/components/input/` verts.
- [x] **Step 5 :** Commit `feat(dictation): transcription sans fichier temporaire`.

### Task 3: L'import ne copie plus l'audio dans le dossier de données

**Files:**
- Modify: `crates/fs-sync-core/src/audio/mod.rs` (`import_to_session`, `AUDIO_ARTIFACTS`, `delete`), `plugins/fs-sync/src/commands.rs` (`audio_import`, `audio_import_data`, `audio_import_source_path`), `plugins/fs-sync/src/ext.rs`
- Modify: `crates/audio-norm/src/lib.rs` (`normalize_file` → variante en mémoire/stream), `crates/afconvert/src/lib.rs` (fallback macOS sans WAV temporaire, ou retiré si décodage direct suffisant)
- Modify: `crates/agent-access/src/recording_import.rs` (plus de staging ni de lock fichier), `apps/desktop/src/stt/recording-import.tsx`, `apps/desktop/src/stt/useUploadFile.ts`
- Modify: `apps/desktop/src/services/audio-retention.ts`, `plugins/transcription/src/audio_retention.rs`
- Test: `crates/fs-sync-core`, `crates/agent-access`, `apps/desktop/src/stt/useUploadFile.test.ts`

**Interfaces:**
- Consumes : `AudioSource::Path` (Task 1) — le chemin d'origine est transmis tel quel au batch.
- Produces : `audio_import` renvoie une **référence** (chemin d'origine + métadonnées), plus de
  `sessions/<id>/audio.mp3` ; le catalogue ne référence plus d'artefact audio de session.

- [x] **Step 1 :** Tests qui échouent : `import_does_not_copy_into_the_session_directory`
  (après import, le dossier de session ne contient aucun fichier audio),
  `failed_import_leaves_the_source_intact`, `retention_skips_absent_audio`.
- [x] **Step 2 :** Lancer → échecs attendus.
- [x] **Step 3 :** Implémenter : suppression de la copie et du staging, batch sur le chemin
  d'origine, ajustement du catalogue, de la rétention et de la reprise (le job CLI/MCP porte
  le chemin d'origine, plus de fichier intermédiaire).
- [x] **Step 4 :** Tests Rust concernés, Vitest `src/stt/`, `cargo check` du workspace.
- [x] **Step 5 :** Commit `feat(import): transcrire le fichier depuis son emplacement d'origine`.

### Task 4: Retirer le code mort de 04c-A

**Files:**
- Delete: `crates/listener-core/src/actors/recorder/{mod.rs,chunks.rs,disk.rs,memory/}` (après avoir déplacé la seule fonction utile : le balayage de démarrage `recover_interrupted_captures_except`, conservé comme filet)
- Modify: `crates/listener-core/src/actors/session/supervisor/children.rs`, `.../supervisor.rs` (plomberie recorder), `crates/listener-core/src/actors/root.rs`
- Delete: `crates/audio-utils/src/vorbis.rs` (helpers sans appelant), `crates/mp3/src/wav.rs` (si plus d'appelant)
- Modify: `plugins/transcription/src/listener/commands.rs`, `apps/desktop/src/stt/capture-lifecycle.ts` (appel `deleteTranscribedCaptureAudio` si le balayage disparaît)

- [x] **Step 1 :** Test garde-fou Rust : `no_recorder_module_is_reachable` (le module recorder
  n'est plus déclaré) et `startup_sweep_still_removes_legacy_audio` (le filet de sécurité
  supprime bien un `audio.mp3` hérité dans un dossier de session de test).
- [x] **Step 2 :** Lancer → échecs attendus.
- [x] **Step 3 :** Supprimer, en gardant le balayage de démarrage.
- [x] **Step 4 :** `cargo test --locked -p listener-core -p anlg-audio-utils -p anlg-mp3`,
  `cargo check -p desktop`.
- [x] **Step 5 :** Commit `refactor(audio): retirer l'ancien enregistreur et ses helpers morts`.

### Task 5: Documentation et garde-fous

**Files:**
- Modify: `docs/conformite/rgpd.md` (l'audio ne touche plus jamais le disque sur aucun
  chemin ; retirer la mention « WAV de dictée reste si l'app plante »), `NOTICE.md`
- Test: `apps/desktop/src/docs-rgpd.test.ts`, `apps/desktop/src/no-audio-at-rest.test.ts`

- [x] **Step 1 :** Test `rgpd_states_no_audio_is_ever_written` : `rgpd.md` affirme l'absence
  totale d'écriture audio et ne contient plus « reste dans le dossier temporaire ».
- [x] **Step 2 :** Échec attendu.
- [x] **Step 3 :** Mettre à jour les documents.
- [x] **Step 4 :** Tests verts, suite complète.
- [x] **Step 5 :** Commit `docs: zéro audio sur disque, sur tous les chemins`.

---

## Vérification manuelle avant fusion (hors CI)

- Dictée de 30 s contre l'endpoint on-prem, puis
  `find /tmp "$TMPDIR" ~/.local/share/syntheo -newer <marqueur> \( -name '*.wav' -o -name '*.mp3' -o -name '*.part' \)` → vide.
- Import d'un fichier audio de 40 min, même contrôle.
- Import annulé en cours de route : pas de copie, source intacte.
- `find ~/.local/share/syntheo -type d -name 'audio-recovery'` → vide.
- Le DGX n'est pas modifié.
