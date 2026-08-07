#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=/dev/null
source "$APP_DIR/scripts/runtime-compose.sh"
refresh_omnifm_compose_env "$APP_DIR"

if [[ $# -eq 0 ]]; then
  echo "$(compose_deployment_summary "$APP_DIR")"
  echo "Beispiel: bash ./scripts/compose.sh ps"
  exit 0
fi

for arg in "$@"; do
  case "$arg" in
    up|create|start|run)
      bash "$APP_DIR/init-data.sh"
      break
      ;;
  esac
done

exec docker compose "$@"
