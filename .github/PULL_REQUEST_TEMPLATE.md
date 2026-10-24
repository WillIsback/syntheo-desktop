<!--
  Template de Pull Request — Syntheo Desktop
  Titre au format Conventional Commits ; au moins une issue référencée.
-->

# Pull Request

## Type de changement

- [ ] Bug fix (`fix:`)
- [ ] Nouvelle fonctionnalité (`feat:`)
- [ ] Refactoring (`refactor:`)
- [ ] Documentation (`docs:`)
- [ ] Maintenance / outillage (`chore:`)
- [ ] Performance (`perf:`)
- [ ] Tests (`test:`)
- [ ] CI (`ci:`)
- [ ] Build / dépendances (`build:`)
- [ ] Annulation d'un commit (`revert:`)
- [ ] **BREAKING CHANGE** (`<type>!:`)

## Issues liées

<!-- Obligatoire : au moins une ligne "Closes #..." ou "Related to #...". -->

- Closes #

## Impact semver attendu

<!--
  Garde-fou croisé : une divergence avec le titre émet une alerte (non bloquante) ;
  la release calcule la version depuis les commits de main.
-->

- [ ] **Patch** — `fix:` ou `perf:` (x.y.Z)
- [ ] **Minor** — `feat:` (x.Y.z)
- [ ] **Major** — breaking change, `<type>!:` (X.y.z)
- [ ] **Aucune release** — `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `build:`, `revert:`

## Preuves

```shell
# Tests
$ pnpm -F desktop test
$ cargo test --locked -p <crate>

# Lint
$ pnpm lint && cargo clippy -p <crate> -- -D warnings
```

## Règles Syntheo

- [ ] Aucun provider ni intégration cloud ajouté ; seuls les endpoints configurés par l'utilisateur sont contactés
- [ ] Aucune écriture d'audio sur disque
- [ ] Texte d'interface en français
- [ ] Code porté depuis Anarlog : révision citée ici et dans `NOTICE.md` (sinon : sans objet)

## Checklist

- [ ] Le titre de la PR suit **Conventional Commits**
- [ ] La documentation (`README.md`, `CONTRIBUTING.md`, `docs/`) est à jour
- [ ] Aucun secret, token ou information sensible n'est commité
- [ ] Migration SQLite : horodatée après la dernière migration existante, testée sur une base existante
- [ ] La procédure de rollback est décrite si nécessaire

## Notes pour le reviewer

- Périmètre de revue :
- Points de risque :
