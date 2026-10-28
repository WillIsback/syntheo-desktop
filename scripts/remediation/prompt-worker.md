# Tâche de remédiation

Tu corriges **une seule tâche** sur la branche courante. Ne pousse rien, ne crée pas de PR,
ne changes pas de branche.

## Tâche

- Identifiant : {{TASK_ID}}
- Type : {{KIND}}
- Outil : {{TOOL}}
- Règle : {{RULE}}
- Sévérité : {{SEVERITY}}
- Fichier(s) : {{FILES}}
- Ligne : {{LINE}}
- Message : {{MESSAGE}}
- URL : {{URL}}

## Détail des alertes

```json
{{ALERTS_JSON}}
```

## Validation locale à lancer avant de committer

```sh
{{VALIDATION}}
```

Si aucune commande n'est listée, ne lance rien et commit quand même après relecture.

## Consignes

- N'ouvre aucune page web, ne lance aucune recherche en ligne, ne charge aucune skill :
  base-toi uniquement sur l'alerte et le fichier fournis.
- Ne lis pas les fichiers de documentation (`docs/`, `.superpowers/`, handoffs) : ils ne
  sont pas nécessaires pour corriger une alerte.
- Tu travailles dans le clone courant. N'exécute jamais `cd` vers le dépôt principal
  (`/home/will/work/syntheo-desktop`) ni vers un autre clone. Toutes les commandes
  `git` doivent rester dans le répertoire courant.
- Pour `code-scanning` : corrige la cause de l'alerte (échappement, regex bornée, validation
  de chemin, etc.). Modifie le minimum de fichiers.
- Pour `dependabot` : mets à jour les paquets listés vers une version corrigée. Pour pnpm,
  utilise `pnpm update <paquet>` (ou `pnpm install` après édition) et commit le lockfile.
  Pour Cargo, utilise `cargo update -p <paquet>` puis vérifie `cargo metadata --locked`.
  Ne change pas de majeure sans nécessité.
- Pour `secret-triage` : classe chaque alerte Gitleaks en `faux-positif` ou
  `secret-reel`. Pour les faux positifs, ajoute une entrée ciblée dans `.gitleaks.toml`
  (allowlist par chemin ou regex précise, jamais globale). Pour un secret réel, ne le
  copie pas, ne le commite pas : signale `SECRET_NEEDS_ROTATION: <fichier>:<ligne>`.
- Pour `sonar` : corrige toutes les issues listées dans ce fichier. Priorise les
  bugs et vulnérabilités, puis les code smells. Ne change pas le comportement
  fonctionnel sans nécessité, et garde les tests existants verts.
- Commit en Conventional Commits : `fix(security): ...` ou `chore(deps): ...`.
- Réponds en JSON, sans texte autour :

```json
{
  "status": "fixed" | "needs-human",
  "summary": "...",
  "files_changed": ["..."],
  "validation": "passed" | "failed" | "skipped",
  "notes": "..."
}
```
