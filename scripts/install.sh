#!/usr/bin/env bash
# Installe Syntheo Desktop depuis les GitHub Releases.
#
#   # Dernière release (AppImage, ~/.local/bin)
#   curl -fsSL https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.sh | bash
#
#   # Une release précise (pour tester une version donnée)
#   curl -fsSL https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/scripts/install.sh | bash -s -- --version v0.1.1
#
# Options :
#   --version <tag>   Release à installer (défaut : latest). accepte vX.Y.Z.
#   --deb             Installe le paquet .deb (Debian/Ubuntu) au lieu de l'AppImage.
#   --appimage        Force l'AppImage (défaut).
#   --to <dir>        Répertoire d'installation (défaut : $XDG_BIN_HOME ou ~/.local/bin).
#   --dir <dir>       Répertoire de téléchargement (défaut : $TMPDIR ou /tmp).
#   -h, --help        Affiche cette aide.
#
# L'AppImage est enregistrée sous Syntheo-<version>.AppImage et un lien
# `syntheo` pointe vers elle : plusieurs versions peuvent coexister.
set -euo pipefail

REPO="WillIsback/syntheo-desktop"
VERSION="latest"
FORMAT="appimage"
INSTALL_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DOWNLOAD_DIR="${TMPDIR:-/tmp}"

die() { printf 'erreur: %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Installe Syntheo Desktop depuis les GitHub Releases.

  --version <tag>   Release à installer (défaut : latest), par ex. v0.1.1
  --deb             Installe le paquet .deb (Debian/Ubuntu) au lieu de l'AppImage
  --appimage        Force l'AppImage (défaut)
  --to <dir>        Répertoire d'installation (défaut : ~/.local/bin)
  --dir <dir>       Répertoire de téléchargement (défaut : /tmp)
  -h, --help        Affiche cette aide
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --version)
      [[ "$#" -ge 2 ]] || die "--version attend une valeur"
      VERSION="$2"
      shift 2
      ;;
    --deb) FORMAT="deb"; shift ;;
    --appimage) FORMAT="appimage"; shift ;;
    --to)
      [[ "$#" -ge 2 ]] || die "--to attend une valeur"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --dir)
      [[ "$#" -ge 2 ]] || die "--dir attend une valeur"
      DOWNLOAD_DIR="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "option inconnue: $1" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl est requis"

case "$(uname -s)" in
  Linux) ;;
  *) die "ce script ne gère que Linux (utilisez les paquets/installateurs de votre OS)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "architecture non prise en charge: $(uname -m)" ;;
esac

if [[ "$FORMAT" = "deb" ]]; then
  EXT="deb"
else
  EXT="AppImage"
fi

if [[ "$VERSION" = "latest" ]]; then
  resolved="$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" || true)"
  case "$resolved" in
    */tag/*) TAG="${resolved##*/tag/}" ;;
    *) die "aucune release publiée (ou accès GitHub impossible)" ;;
  esac
else
  TAG="$VERSION"
fi
TAG="${TAG%%\?*}"
VERSION_NUMBER="${TAG#v}"

ASSET="Syntheo_${VERSION_NUMBER}_${ARCH}.${EXT}"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
ASSET_URL="${BASE_URL}/${ASSET}"
SUMS_URL="${BASE_URL}/SHA256SUMS"

printf 'Syntheo Desktop %s (%s, %s)\n' "$TAG" "$EXT" "$ARCH"

mkdir -p "$DOWNLOAD_DIR" "$INSTALL_DIR"
target="$DOWNLOAD_DIR/$ASSET"

printf 'Téléchargement de %s...\n' "$ASSET"
if ! curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL --retry 3 --progress-bar "$ASSET_URL" -o "$target"; then
  die "téléchargement impossible: $ASSET_URL (cette release publie-t-elle bien un ${EXT} pour ${ARCH} ?)"
fi

# Vérifie la somme si le manifeste de la release est disponible.
if sums="$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL "$SUMS_URL" 2>/dev/null)"; then
  expected="$(printf '%s\n' "$sums" | awk -v a="$ASSET" '$2 == a || $2 == "./"a { print $1 }')"
  if [[ -n "$expected" ]]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$target" | awk '{ print $1 }')"
    elif command -v shasum >/dev/null 2>&1; then
      actual="$(shasum -a 256 "$target" | awk '{ print $1 }')"
    fi
    if [[ -n "${actual:-}" ]]; then
      [[ "$actual" = "$expected" ]] || die "somme SHA256 invalide pour $ASSET"
      printf 'SHA256 vérifié.\n'
    fi
  fi
fi

if [[ "$FORMAT" = "deb" ]]; then
  installed="$INSTALL_DIR/$ASSET"
  mv "$target" "$installed"
  printf 'Paquet téléchargé : %s\n' "$installed"
  printf 'Installez-le avec : sudo apt install %s\n' "$installed"
  exit 0
fi

installed="$INSTALL_DIR/Syntheo-${VERSION_NUMBER}.AppImage"
mv "$target" "$installed"
chmod +x "$installed"
ln -sf "$installed" "$INSTALL_DIR/syntheo"

printf 'Installé : %s\n' "$installed"
printf 'Lien     : %s/syntheo\n' "$INSTALL_DIR"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) printf '\nAjoutez %s au PATH : export PATH="%s:$PATH"\n' "$INSTALL_DIR" "$INSTALL_DIR" ;;
esac

printf '\nLancez : syntheo\n'
printf "Sur Arch/Omarchy, l'AppImage a besoin de FUSE 2 : sudo pacman -S fuse2\n"
