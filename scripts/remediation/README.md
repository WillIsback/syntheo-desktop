# Remédiation automatisée (GitHub + Aikido)

Boucle locale qui corrige les alertes de sécurité et de qualité avec le modèle
`nvidia/Qwen3.8-Flash-Next-FP4-Local` (vLLM, DGX Spark), puis merge les correctifs
dans une branche d'intégration unique.

## Principe

- `collect-alerts.mjs` lit les alertes ouvertes via `gh api` et les regroupe en tâches
  sans conflit de fichiers.
- `orchestrate.mjs` crée un **clone git isolé** par tâche (les worktrees ne suffisent pas :
  OpenCode résout le projet vers le dépôt principal), lance l'agent `fixer`, valide,
  puis merge `--no-ff` dans `fix/master-remediation`.
- Aucun push avant la fin. La PR finale est créée manuellement.

## Prérequis

- `gh` authentifié sur le dépôt.
- `VLLM_API_KEY` dans l'environnement.
- Agent `fixer` défini dans `~/.config/opencode/agents/fixer.md` (ou dans
  `.opencode/agents/fixer.md` pour le dépôt principal).
- Le serveur vLLM est limité à `--max-num-seqs 2` : la concurrence est plafonnée à 2.

## Utilisation

```sh
# 1. Collecter les alertes (écrit dans /tmp/opencode/syntheo-remediation)
node scripts/remediation/collect-alerts.mjs

# 2. Simuler
node scripts/remediation/orchestrate.mjs --dry-run

# 3. Exécuter (2 workers, Dependabot en série)
node scripts/remediation/orchestrate.mjs

# Reprendre après une interruption
node scripts/remediation/orchestrate.mjs --resume

# Une seule tâche
node scripts/remediation/orchestrate.mjs --task cs-packages-utils-src-folders.ts
```

## Validation locale

Par tâche, dans le clone :

| Aire                    | Commande                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| JS/TS                   | `./node_modules/.bin/oxfmt --check <fichiers>`                                                       |
| `apps/desktop/**`       | `./node_modules/.bin/oxlint --quiet <fichiers>` + `./node_modules/.bin/tsc -p apps/desktop --noEmit` |
| autres TS               | `./node_modules/.bin/eslint <fichiers>`                                                              |
| Markdown/JSON/YAML/TOML | `./node_modules/.bin/dprint check <fichiers>`                                                        |
| Rust                    | `cargo clippy --manifest-path <crate>/Cargo.toml -- -D warnings`                                     |
| Lockfile pnpm           | `pnpm install --offline --frozen-lockfile`                                                           |

La CI complète ne tourne qu'une fois, sur la PR finale.

## Phase 2 : Aikido

Aikido a remplacé SonarCloud (app GitHub « Aikido PR Checks », exclusions dans
`.aikido` à la racine). La collecte passe par l'API publique : créer un client
API dans Aikido (Settings › Integrations › API, portée `issues:read`).

```sh
export AIKIDO_CLIENT_ID=... AIKIDO_CLIENT_SECRET=...
# Instance US : export AIKIDO_API_BASE=https://app.us.aikido.dev

# Collecter les issues de code ouvertes (sast, iac par défaut)
node scripts/remediation/collect-aikido.mjs

# Ne garder que les fichiers les plus sévères (ex. 60 fichiers)
node scripts/remediation/collect-aikido.mjs --limit 60

# Exécuter avec le fichier de tâches Aikido
REMEDIATION_TASKS=/tmp/opencode/syntheo-remediation/aikido-tasks.json \
  node scripts/remediation/orchestrate.mjs --resume
```

Les dépendances et les secrets restent collectés par `collect-alerts.mjs`
(Dependabot, Gitleaks). Avant de pousser, un correctif peut être revérifié en
local avec le scan Aikido de Claude Code (plugin Aikido, outil `aikido_scan_paths`),
qui applique les mêmes règles SAST, secrets et IaC.

## Fin de boucle

```sh
git -C .worktrees/wt-integration log --oneline
git -C .worktrees/wt-integration push -u origin fix/master-remediation
gh pr create --base main --head fix/master-remediation --title "fix(security): remédiation des alertes GitHub" --body "..."
```

## Limites connues

- Le formateur `dprint` appelle `pnpm exec oxfmt` via son plugin `exec` ; en local sur
  Node 25, `pnpm` refuse de tourner (engines). On utilise donc `oxfmt --check` en direct.
- Les tâches Dependabot ne partagent pas `node_modules` (le worker doit pouvoir modifier
  les dépendances sans polluer le dépôt principal).
- Un secret réel détecté par Gitleaks n'est jamais committé : il est listé dans
  `needs-human.json` pour rotation manuelle.
