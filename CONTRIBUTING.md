# Contribuer à Syntheo Desktop

## Règles du projet

1. **Inférence on-premise uniquement** : pas de provider cloud, pas
   d'intégration cloud (agenda, messagerie, CRM…), pas de télémétrie.
2. **Aucun audio sur disque**, même temporairement.
3. **Texte d'interface en français d'abord.**
4. Pas de code issu de `enterprise/` d'Syntheo (licence commerciale).
   Un correctif porté depuis Syntheo (MIT) est signalé dans la PR et dans
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

## Gates de CI

Sur chaque PR (rapides, bloquantes) :

| Workflow | Vérifie |
|---|---|
| `ci-code-quality` | dprint (TS, Rust, YAML, TOML, Markdown), oxlint (desktop), ESLint (fichiers modifiés), `tsc`, `cargo clippy` (non bloquant, #3), titre de PR, actionlint, zizmor, lockfiles |
| `ci-security` | Dependency Review, `cargo deny`, Trivy, Gitleaks, registre d'exceptions |
| `ci-codeql` | CodeQL `security-extended` TypeScript, si la PR modifie du TS/JS |
| `ci-test` | Vitest (desktop), `cargo test` des crates des chantiers, yamllint ; couverture différentielle ≥ 90 % à venir |
| `ci-traceability` | issue référencée, type de PR, cohérence semver |

Gates lourdes, hors PR :

| Workflow | Quand | Vérifie |
|---|---|---|
| `release` | push sur `main` (feat/fix/perf) | CodeQL Rust et TypeScript (gate), build des paquets, SBOM, attestation, GitHub Release |
| `ci-codeql` | hebdomadaire, à la demande | analyse complète TypeScript + Rust |
| `ci-install` | hebdomadaire, à la demande | le bloc « Construire depuis les sources › Linux » rejoué sur un runner vierge |
| `functional-gb10` (Forgejo) | push sur `main`, à la demande | moteurs d'inférence réels du GB10 |

### Dépendances (Dependabot)

Dependabot ouvre chaque semaine des PR groupées (npm, cargo, actions). Elles sont
fusionnées automatiquement (squash) dès que les gates de PR requises par la règle
de la branche `main` sont au vert ; une PR en échec reste ouverte et doit être
corrigée à la main. `ci-traceability` ne s'applique pas à Dependabot.

## Construire depuis les sources

Prérequis communs : Node.js ≥ 22.23 et [rustup](https://rustup.rs) (la version
de Rust est fixée par `rust-toolchain.toml`). Les dépendances système de Tauri
par OS sont décrites dans les
[prérequis Tauri](https://v2.tauri.app/start/prerequisites/).

### Linux

Ce bloc (Debian/Ubuntu), exécuté tel quel depuis un dossier vide, installe les
dépendances, construit le paquet `.deb` et vérifie que l'application démarre.
Il est rejoué à l'identique par `ci-install` (hebdomadaire et à la demande).

```bash
git clone https://github.com/WillIsback/syntheo-desktop.git
cd syntheo-desktop
bash scripts/setup-linux-tauri.sh
bash scripts/setup-linux-others.sh
sudo apt-get install -y xvfb
npm install -g pnpm@11.1.1
pnpm install --frozen-lockfile
pnpm -F ui build
VITE_API_URL=http://127.0.0.1:9 pnpm -F desktop tauri build --ci --bundles deb --config ./src-tauri/tauri.conf.syntheo.json
ls apps/desktop/src-tauri/target/release/bundle/deb/*.deb
# Vérification : l'application doit tenir 30 s sans planter (124 = arrêtée par timeout).
status=0; timeout 30 xvfb-run -a apps/desktop/src-tauri/target/release/syntheo || status=$?; [ "$status" -eq 124 ]
```

`VITE_API_URL` est une valeur factice exigée à la compilation par des
intégrations cloud héritées ; elle disparaît avec le chantier 04d du plan.

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
