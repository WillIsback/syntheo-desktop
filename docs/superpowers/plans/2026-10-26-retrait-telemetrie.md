# Retrait complet de la télémétrie (lot 10) — plan d'implémentation

**Goal :** Syntheo Desktop ne contient plus aucun code de télémétrie : ni PostHog, ni Sentry,
ni identifiant d'appareil, ni réglage de consentement. Le dépôt respecte la règle projet
« no telemetry, account, or billing code ».

**Pourquoi maintenant :** le lot 04 avait seulement *neutralisé* la télémétrie (aucune clé
PostHog fournie, `sentry_client = None`), en reportant le retrait au lot 10. Le bump
Dependabot de `posthog-rs` 0.27 a cassé la compilation de toute l'application, parce que ce
code mort est toujours compilé.

## Périmètre

| Élément | Action |
|---|---|
| `crates/analytics` (posthog-rs, `LazyPosthogClient`, `capture`, empreinte) | supprimé |
| `plugins/analytics` (commandes, consentement, file d'envoi) | supprimé |
| `apps/desktop/src/analytics.ts` + 42 appels `trackAnalyticsEvent` (17 imports) | supprimés |
| `trackMeetingNoteCompletion`, `usePermissionAnalytics`, `analyticsCommands` | supprimés |
| `apps/desktop/src/error-reporting.ts` + appels Sentry (`main.tsx`) | supprimé |
| `@sentry/react`, `sentry`, `tauri-plugin-sentry`, `posthog-rs` | retirés des manifestes |
| `telemetry_consent`, `crash_reporting_consent` (UI + `managed_settings`) | supprimés |
| `anlg_host::fingerprint()` quand il ne sert qu'à l'identifiant analytics | supprimé |
| `docs/conformite/rgpd.md` | reformulé : télémétrie retirée, pas neutralisée |

## Étapes

1. **Plan** (ce fichier).
2. **Côté TS** : supprimer les appels et les imports, supprimer `analytics.ts`,
   `onboarding/meeting-note-analytics.ts`, `shared/hooks/usePermissionAnalytics.ts`,
   `error-reporting.ts`, puis retirer `Sentry.*` de `main.tsx`. Script de suppression
   équilibrée des parenthèses, puis `tsc` comme filet.
3. **Côté Rust** : supprimer les deux crates/plugins, retirer les membres et dépendances
   du workspace, dé-enregistrer les plugins, retirer `anlg_host::fingerprint` s'il devient
   orphelin, nettoyer `managed_settings` et les réglages de consentement.
4. **Manifestes** : `apps/desktop/package.json`, `pnpm-workspace.yaml`, `Cargo.toml`,
   `capabilities/default.json`, permissions générées, `pnpm-lock.yaml`, `Cargo.lock`.
5. **Tests** : retirer les mocks/assertions analytics et Sentry ; garder les tests
   fonctionnels sous-jacents.
6. **Vérifications** : `tsc --noEmit`, Vitest complet, `cargo check --workspace` +
   `cargo test` des crates touchés, `cargo clippy`, dprint.
7. **Docs + PR** : `rgpd.md`, `NOTICE.md`, issue + PR avec `[skip release]`.

## Critère de fin

- `rg -il 'posthog|sentry|telemetry_consent|trackAnalyticsEvent' apps crates plugins packages`
  ne renvoie rien (hors historique de changelog).
- `pnpm install --frozen-lockfile` et `cargo metadata --locked` passent.
- L'application compile et la suite Vitest est verte.
