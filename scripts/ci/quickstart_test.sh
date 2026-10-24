#!/usr/bin/env bash
# Rejoue le parcours « Développeurs » du Démarrage rapide du README dans un dossier vide.
#
# Convention : la section `## Démarrage rapide` du README contient une
# sous-section `### Développeurs` avec un seul bloc ```bash qui, exécuté tel quel
# depuis un dossier vide, installe, construit ET vérifie l'application. Ce script
# n'ajoute aucune commande : il extrait le bloc et l'exécute en mode strict ; la
# moindre commande en échec fait échouer le test.
#
# Usage : scripts/ci/quickstart_test.sh [README] [dossier de travail]
# Variables :
#   QUICKSTART_CLONE_FROM  dépôt local cloné à la place de l'URL du README
#                          (CI : tester le code de la PR, pas celui de main)
set -euo pipefail

README="$(realpath "${1:-$(dirname "$0")/../../README.md}")"
WORKDIR="${2:-$(mktemp -d)}"
mkdir -p "$WORKDIR"
WORKDIR="$(realpath "$WORKDIR")"

fail() { printf '\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

# Premier bloc ```bash de la sous-section « Développeurs » de « Démarrage rapide ».
# Les commentaires `# …` du bloc ne sont pas des titres. Sortie 3 si le bloc
# n'est jamais refermé.
BLOCK="$(awk '
  inblock && /^```/                  { closed = 1; exit }
  inblock                            { print; next }
  /^## Démarrage rapide/             { quick = 1; next }
  quick && /^## /                    { exit }
  quick && /^### Développeurs/       { found = 1; next }
  found && /^#+ /                    { exit }
  found && /^```bash/                { inblock = 1 }
  END { if (inblock && !closed) exit 3 }
' "$README")" || fail "bloc \`\`\`bash « Développeurs » non refermé dans $README"
[ -n "$BLOCK" ] || fail "aucun bloc \`\`\`bash dans « Démarrage rapide › Développeurs » de $README"

CLONE_URL="$(grep -oE 'git clone [^ ]+' <<<"$BLOCK" | head -1 | cut -d' ' -f3)"
[ -n "$CLONE_URL" ] || fail "le parcours développeur doit commencer par « git clone <url> »"
# L'URL du README doit être publique et joignable, même si on clone une copie locale.
git ls-remote --exit-code "$CLONE_URL" HEAD >/dev/null 2>&1 \
  || fail "URL de clone injoignable (dépôt privé ou inexistant ?) : $CLONE_URL"
if [ -n "${QUICKSTART_CLONE_FROM:-}" ]; then
  # Redirige uniquement ce `git clone` vers la copie locale (config git isolée).
  export GIT_CONFIG_GLOBAL="$WORKDIR/.gitconfig-quickstart"
  git config --file "$GIT_CONFIG_GLOBAL" \
    "url.$(realpath "$QUICKSTART_CLONE_FROM").insteadOf" "$CLONE_URL"
fi

printf '\033[1;34m==> Démarrage rapide « Développeurs » de %s, exécuté dans %s\033[0m\n' "$README" "$WORKDIR"
cd "$WORKDIR"
bash -euxo pipefail -c "$BLOCK"
printf '\n\033[1;32m✅ Démarrage rapide OK : le projet se construit et démarre depuis un dossier vierge.\033[0m\n'
