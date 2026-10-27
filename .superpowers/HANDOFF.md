# Passation — Syntheo Desktop

Dernière mise à jour : 2026-10-27.
Dépôt : `/home/will/work/syntheo-desktop` (GitHub `WillIsback/syntheo-desktop`, miroir
Forgejo `wderue/syntheo-desktop`). Fork d'Anarlog (MIT), historique neuf, jamais fusionné
vers l'amont.

## Règles non négociables

- Inférence **uniquement** via des endpoints on-premise standard (OpenAI-compatible, vLLM
  Realtime, NVIDIA NIM WS/gRPC). Aucun provider cloud.
- **Aucun audio écrit sur disque**, même temporairement.
- **Aucune télémétrie**, aucun compte, aucun paywall.
- Textes d'interface en **français d'abord**.
- Commits/PR en Conventional Commits ; PR avec issue (`Closes #N`), `[skip release]` tant que
  les chantiers 04b/04c ne sont pas tous fusionnés.
- Un chantier = un plan écrit dans `docs/superpowers/plans/` **avant** d'exécuter.

## État au moment de la passation

| Élément | État |
|---|---|
| `main` | `51ce2b0` — 04c-B (#59) + lot 10 télémétrie (#61) fusionnés |
| Lot 04 / 04b / 04c-A / 04c-B | **terminés et fusionnés** |
| Lot 10 (retrait télémétrie) | **terminé et fusionné** (#61, `Closes #60`) |
| Issues ouvertes | Dependabot #55, #54, #51, #46, #41 |
| Lots 05-09 | 05 **gelé** (dépriorisé) ; 06-09 **non commencés** |

### Lot 04c-B (#59) — aucun audio temporaire sur disque

- Moteur batch en mémoire (`AudioInputRef::Path | Bytes`), dictée sans WAV temporaire.
- Import sans copie : chemin d'origine transmis au batch, plus de staging `agent-access`,
  commandes `fs-sync:audio_import_data` et `db:cleanup_recording_imports` retirées ; crates
  `audio-norm` et `afconvert` supprimés.
- Code mort 04c-A retiré : `actors/recorder` → `actors/audio_sweep` (balayage conservé),
  plomberie `recorder_cell` retirée, `vorbis.rs`/`vorbis_rs` supprimés.

### Lot 10 (#61) — télémétrie retirée

- `crates/analytics`, `plugins/analytics` supprimés ; `posthog-rs`, `tauri-plugin-analytics`
  retirés.
- Sentry retiré partout (Rust et JS) : `plugins/tracing`, `crates/user-error`,
  `listener-core`, `apps/desktop/src-tauri`, `apps/cli` ; `sentry`, `tauri-plugin-sentry`,
  `@sentry/react` retirés.
- Réglages `telemetry_consent`/`crash_reporting_consent` et empreinte `anlg_host::fingerprint`
  supprimés.
- **Correctif annexe** (inclus) : `crates/notification-linux` repassé à `pango = "0.18"`
  (le bump Dependabot cassait le build desktop Linux).
- Exceptions SCA zstd documentées (`.github/security-exceptions.yml`, `deny.toml`), à
  réévaluer au prochain saut de version de tantivy.

## Chantiers restants (ordre fixé)

05 adaptateurs on-prem nouveaux (**gelé** : NVIDIA NIM gRPC Riva, vLLM Realtime/Voxtral) →
06 identité visuelle (thème Syntheo, sombre, police ; rebranding « Anarlog » → « Syntheo ») →
07 traduction FR (`messages.po` via le vLLM du DGX) → 08 templates FR (migration SQL de la
spec) + générateur IA → 09 phase 6 (rappel participants, export DOCX, palette locuteurs).

## Pièges déjà rencontrés (à ne pas revivre)

- **Ne jamais lancer un `edit` et un `git commit` dans le même message**.
- `Vec<u8>` en argument Tauri est sérialisé en `number[]` : transporter l'audio en **base64**.
- La CI `ci-test (Rust)` ne construit que `template-app`, `db-app`, `owhisper-client`,
  `listener-core`, `storage`.
- `cargo check -p desktop` échoue dans le conteneur (`ort-sys` → `onnxruntime` absent) :
  `tauri.gen.ts`/permissions régénérés à la main ou via les tests `export_types` des plugins.
- `cargo check --all-features` impossible (features exclusives d'`aec`) ; exclure
  `shortcut-macos` et `tcc` (macOS).
- dprint formate aussi Rust/YAML/TOML via rustfmt (lancer avec `RUSTUP_TOOLCHAIN=1.94.0`).
  `cargo fmt --all` reformate des fichiers hors périmètre : préférer `cargo fmt -p <crate>`.
  **`pnpm exec dprint fmt` (global) est requis avant de pousser** : les retraits scriptés
  laissent des blocs vides et des lignes vides qui font échouer `ci-code-quality (TypeScript)`.
- Les conteneurs écrivent des `node_modules` en root dans des dossiers supprimés
  (`plugins/analytics`) : supprimer via le conteneur (`docker run … rm -rf /work/plugins/analytics`).
- Flake connu : `plugins/tracing/tests/integration.rs::test_log_file_rotation_e2e` (vert au
  rerun, non couvert par la CI).
- Après ajout/retrait d'une commande Tauri : régénérer bindings **et** permissions.

## Commandes utiles

```bash
# conteneur de build (déjà construit)
docker run --rm -v /home/will/work/syntheo-desktop:/work -w /work syntheo-dev:1 bash -lc '…'
# tests
docker run --rm -v … -w /work/apps/desktop syntheo-dev:1 bash -lc 'pnpm exec tsc --noEmit; pnpm exec vitest run'
docker run --rm -v … -w /work syntheo-dev:1 bash -lc 'cargo test --locked -p listener-core -p db-app'
# PR
gh pr create … && gh pr merge <n> --auto --squash
```

Secrets : `bws` (Bitwarden EU) pour les clés ; jetons Forgejo/GitHub via `bws secret list`.
