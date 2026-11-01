#!/usr/bin/env bash
# Désinstalle Syntheo Desktop sous Linux.
#
#   # Interactif : propose les deux modes
#   curl -fsSL https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/uninstall.sh | bash
#
#   # Voir ce qui serait retiré, sans rien supprimer
#   curl -fsSL …/scripts/uninstall.sh | bash -s -- --purge --dry-run
#
# Modes :
#   --keep-data   Désinstaller l'application : AppImage, paquet .deb ou AUR,
#                 lancement au démarrage, raccourcis du menu. Vos réunions,
#                 réglages et clés d'API sont conservés.
#   --purge       Désinstallation complète : l'application, plus la base de
#                 données (réunions, notes, transcriptions), les journaux, le
#                 cache, la configuration et les clés d'API du trousseau.
#
# Options :
#   --dry-run     Liste ce qui serait retiré, sans rien supprimer.
#   --yes         Ne demande pas de confirmation (scripts, CI).
#   --to <dir>    Répertoire de l'AppImage (défaut : $XDG_BIN_HOME ou ~/.local/bin).
#   -h, --help    Affiche cette aide.
#
# Ne touche jamais : vos exports, la CLI `syntheo` installée par cargo
# (~/.cargo/bin), ni la configuration de vos agents (Claude, Codex, OpenCode).
set -euo pipefail

MODE=""
DRY_RUN=false
ASSUME_YES=false
INSTALL_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
KEYRING_SERVICE="fr.willisback.syntheo.secure-store"
IDENTIFIERS=(fr.willisback.syntheo fr.willisback.syntheo.dev)

die() { printf 'erreur: %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Désinstalle Syntheo Desktop.

  --keep-data   Désinstaller l'application, conserver réunions, réglages et clés d'API
  --purge       Désinstallation complète : application, données, journaux, cache,
                configuration et clés d'API
  --dry-run     Liste ce qui serait retiré, sans rien supprimer
  --yes         Ne demande pas de confirmation
  --to <dir>    Répertoire de l'AppImage (défaut : ~/.local/bin)
  -h, --help    Affiche cette aide
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --keep-data) MODE="keep-data"; shift ;;
    --purge) MODE="purge"; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    --to)
      [[ "$#" -ge 2 ]] || die "--to attend une valeur"
      INSTALL_DIR="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "option inconnue : $1 (voir --help)" ;;
  esac
done

# `curl … | bash` : stdin est le script, les questions lisent le terminal.
# L'invite va sur /dev/tty et non sur stderr (`read -p`) : ask() tourne dans
# $(…) et stderr est réduit au silence pour l'erreur d'ouverture du terminal,
# l'invite y serait invisible.
ask() {
  local prompt=$1 answer
  if [[ -r /dev/tty ]]; then
    { printf '%s' "$prompt" >/dev/tty && read -r answer </dev/tty; } 2>/dev/null || answer=""
  else
    die "aucun terminal pour répondre : relancez avec --keep-data ou --purge et --yes"
  fi
  printf '%s' "$answer"
}

if [[ -z "$MODE" ]]; then
  cat <<'EOF'
Que voulez-vous désinstaller ?

  1) L'application seulement : vos réunions, réglages et clés d'API sont conservés
     (utile pour réinstaller ou changer de version).
  2) Tout : l'application, plus vos réunions, notes, transcriptions, journaux,
     cache, configuration et clés d'API. Irréversible.

EOF
  case "$(ask 'Votre choix [1/2, Entrée pour annuler] : ')" in
    1) MODE="keep-data" ;;
    2) MODE="purge" ;;
    *) printf 'Annulé.\n'; exit 0 ;;
  esac
fi

# --- Inventaire ---
APP_PATHS=()     # application et intégration au bureau (les deux modes)
DATA_PATHS=()    # données locales (désinstallation complète)
PACKAGES=()      # paquets système à retirer (« gestionnaire nom »)

add_if_exists() { # $1 = nom du tableau, puis des chemins
  local -n target=$1
  shift
  local path
  for path in "$@"; do
    if [[ -e "$path" || -L "$path" ]]; then target+=("$path"); fi
  done
}

# AppImage installées par install.sh, et le lien `syntheo` s'il pointe vers une
# AppImage Syntheo (jamais un autre binaire du même nom, comme la CLI).
shopt -s nullglob
add_if_exists APP_PATHS "$INSTALL_DIR"/Syntheo-*.AppImage "$INSTALL_DIR"/Syntheo*.AppImage
if [[ -L "$INSTALL_DIR/syntheo" ]] && [[ "$(readlink "$INSTALL_DIR/syntheo")" == *Syntheo*.AppImage ]]; then
  APP_PATHS+=("$INSTALL_DIR/syntheo")
fi
add_if_exists APP_PATHS \
  "$CONFIG_HOME"/autostart/Syntheo*.desktop "$CONFIG_HOME"/autostart/syntheo*.desktop \
  "$DATA_HOME"/applications/*[Ss]yntheo*.desktop \
  "$DATA_HOME"/icons/hicolor/*/apps/*[Ss]yntheo*
shopt -u nullglob
# Doublons possibles (motifs qui se recoupent) : on dédoublonne.
mapfile -t APP_PATHS < <(printf '%s\n' "${APP_PATHS[@]}" | awk 'NF && !seen[$0]++')

if command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' syntheo 2>/dev/null | grep -q "install ok installed"; then
  PACKAGES+=("apt syntheo")
fi
if command -v pacman >/dev/null 2>&1; then
  for name in syntheo syntheo-bin syntheo-desktop syntheo-desktop-bin; do
    pacman -Q "$name" >/dev/null 2>&1 && PACKAGES+=("pacman $name")
  done
fi

if [[ "$MODE" == "purge" ]]; then
  add_if_exists DATA_PATHS "$DATA_HOME/syntheo"
  for id in "${IDENTIFIERS[@]}"; do
    add_if_exists DATA_PATHS "$DATA_HOME/$id" "$CONFIG_HOME/$id" "$CACHE_HOME/$id"
  done
  # Dossier partagé par toutes les apps qui utilisent tray-icon : seules les
  # entrées de Syntheo sont retirées.
  shopt -s nullglob
  add_if_exists DATA_PATHS "${XDG_RUNTIME_DIR:-/nonexistent}"/tray-icon/syntheo*
  shopt -u nullglob
fi

SECRETS=0
if [[ "$MODE" == "purge" ]] && command -v secret-tool >/dev/null 2>&1; then
  SECRETS=$(secret-tool search --all service "$KEYRING_SERVICE" 2>/dev/null | grep -c '^\[' || true)
fi

# --- Récapitulatif ---
printf '\nMode : %s\n' "$([[ "$MODE" == purge ]] && echo "désinstallation complète" || echo "application seulement (données conservées)")"
if [[ "${#PACKAGES[@]}" -eq 0 && "${#APP_PATHS[@]}" -eq 0 && "${#DATA_PATHS[@]}" -eq 0 && "$SECRETS" -eq 0 ]]; then
  printf 'Rien à retirer : Syntheo ne semble pas installé pour cet utilisateur.\n'
  exit 0
fi
for package in "${PACKAGES[@]}"; do printf '  paquet   %s\n' "${package#* }"; done
for path in "${APP_PATHS[@]}"; do printf '  appli    %s\n' "$path"; done
for path in "${DATA_PATHS[@]}"; do printf '  données  %s (%s)\n' "$path" "$(du -sh "$path" 2>/dev/null | cut -f1)"; done
if [[ "$SECRETS" -gt 0 ]]; then printf "  trousseau %s clé(s) d'API (%s)\n" "$SECRETS" "$KEYRING_SERVICE"; fi
if [[ "$MODE" == "purge" ]] && ! command -v secret-tool >/dev/null 2>&1; then
  printf "  trousseau : secret-tool absent, les clés d'API ne seront pas retirées\n"
  printf '              (paquet libsecret, ou « Mots de passe et clés » : %s)\n' "$KEYRING_SERVICE"
fi

if $DRY_RUN; then
  printf "\nSimulation (--dry-run) : rien n'a été supprimé.\n"
  exit 0
fi

if ! $ASSUME_YES; then
  if [[ "$MODE" == "purge" ]]; then
    [[ "$(ask $'\nCette suppression est irréversible. Tapez EFFACER pour confirmer : ')" == "EFFACER" ]] \
      || { printf 'Annulé.\n'; exit 0; }
  else
    [[ "$(ask $'\nContinuer ? [o/N] ')" =~ ^[oOyY]$ ]] || { printf 'Annulé.\n'; exit 0; }
  fi
fi

# --- Désinstallation ---
pkill -x syntheo 2>/dev/null || true
pkill -f 'Syntheo.*\.AppImage' 2>/dev/null || true
sleep 1

for package in "${PACKAGES[@]}"; do
  manager=${package%% *}
  name=${package#* }
  printf 'Retrait du paquet %s (sudo)...\n' "$name"
  case "$manager" in
    apt) sudo apt-get remove -y "$name" ;;
    pacman) sudo pacman -R --noconfirm "$name" ;;
  esac
done

for path in "${APP_PATHS[@]}" "${DATA_PATHS[@]}"; do
  rm -rf -- "$path"
done

if [[ "$SECRETS" -gt 0 ]]; then
  secret-tool clear service "$KEYRING_SERVICE" 2>/dev/null || true
fi

command -v update-desktop-database >/dev/null 2>&1 \
  && update-desktop-database "$DATA_HOME/applications" >/dev/null 2>&1 || true

printf '\nSyntheo est désinstallé.\n'
if [[ "$MODE" == "keep-data" ]]; then
  printf 'Vos données sont conservées dans %s : une réinstallation les retrouvera.\n' "$DATA_HOME/syntheo"
fi
printf 'Non touchés : vos exports, la CLI installée par cargo, la configuration de vos agents.\n'
printf 'Si vous aviez relié Claude, Codex ou OpenCode à Syntheo, retirez-les dans leurs réglages.\n'
