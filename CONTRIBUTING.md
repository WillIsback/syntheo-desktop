# Contribuer à Syntheo Desktop

## Règles du projet

1. **Inférence on-premise uniquement** : pas de provider cloud, pas
   d'intégration cloud (agenda, messagerie, CRM…), pas de télémétrie.
2. **Aucun audio sur disque**, même temporairement.
3. **Texte d'interface en français d'abord.**
4. Pas de code issu de `enterprise/` d'Anarlog (licence commerciale).
   Un correctif porté depuis Anarlog (MIT) est signalé dans la PR et dans
   [NOTICE.md](NOTICE.md).

## Flux de travail

- Une **issue** par changement (modèles dans `.github/ISSUE_TEMPLATE`).
- Une branche par issue, puis une PR vers `main` en suivant le
  [modèle de PR](.github/PULL_REQUEST_TEMPLATE.md).
- **Titre de PR et commits au format Conventional Commits** :
  `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`,
  `revert`, avec `!` pour un breaking change.
- Le corps de la PR référence l'issue : `Closes #N` ou `Related to #N`.
- Seuls `feat` (minor), `fix`/`perf` (patch) et `!` (major) déclenchent une
  release.

## Gates de CI (bloquantes sur les PR)

| Workflow | Vérifie |
|---|---|
| `ci-code-quality` | dprint (TS, Rust, YAML, TOML, Markdown), oxlint (desktop), ESLint (fichiers modifiés), `tsc`, `cargo clippy`, titre de PR, actionlint, zizmor, lockfiles |
| `ci-security` | Dependency Review, `cargo deny`, Trivy, CodeQL (TS + Rust), Gitleaks, registre d'exceptions |
| `ci-test` | Vitest (desktop), `cargo test` des crates des chantiers, yamllint ; couverture différentielle ≥ 90 % à venir |
| `ci-traceability` | issue référencée, type de PR, cohérence semver |
| `ci-install` | le bloc « Démarrage rapide » du README, rejoué sur un runner vierge |

Sur `main` : `release` (version, paquets `.deb`/AppImage, SBOM, attestation,
GitHub Release) et, sur le miroir Forgejo, `functional-gb10` (tests contre les
moteurs d'inférence réels).

## Vérifications locales

```bash
pnpm install --frozen-lockfile
pnpm fmt:check && pnpm lint && pnpm -F desktop typecheck
pnpm -F ui build && pnpm -F desktop test
pnpm exec dprint check $(git diff --name-only main)
cargo test --locked -p template-app -p db-app
```

## Exceptions de sécurité

Une alerte acceptée temporairement est inscrite dans
`.github/security-exceptions.yml` avec une justification, un auteur et une date
d'expiration. Une exception expirée fait échouer la CI.
