#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

app_syntheo=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --app-syntheo)
      app_syntheo="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "$app_syntheo" ]]; then
  "$SCRIPT_DIR/yabai_impl.sh" --bundle-id "$app_syntheo" --position left
fi
