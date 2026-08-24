#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM — update script. Pulls the latest code, updates dependencies and
# restarts the stack. Run this on your server after a deploy.
# Usage:  ./update.sh
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

log() { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }

if [ -d .git ]; then
  log "Hole neuesten Stand (git pull)..."
  git pull --ff-only || log "git pull übersprungen (lokale Änderungen oder kein Remote)."
else
  log "Kein Git-Repository – überspringe git pull."
fi

log "Stoppe laufende Dienste..."
./stop.sh || true

log "Starte Dienste neu (installiert Abhängigkeiten & baut Frontend)..."
./start.sh

log "Update abgeschlossen."
