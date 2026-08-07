#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if command -v node >/dev/null 2>&1; then
  exec node --no-warnings "$APP_DIR/src/premium-cli.js" "$@"
fi

if command -v docker >/dev/null 2>&1 && docker compose ps --services --status running 2>/dev/null | grep -q "^omnifm$"; then
  exec docker compose exec -it omnifm node /app/src/premium-cli.js "$@"
fi

if command -v docker >/dev/null 2>&1; then
  bash "$APP_DIR/init-data.sh"
  exec docker compose run --rm --no-deps --build omnifm node /app/src/premium-cli.js "$@"
fi

echo "Weder node noch docker gefunden."
exit 1
