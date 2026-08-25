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
  log "Code-Stand: $(git log -1 --pretty='%h — %s' 2>/dev/null | head -c 120 || echo 'unbekannt')"
else
  log "Kein Git-Repository – überspringe git pull."
fi

log "Stoppe laufende Dienste..."
./stop.sh || true

log "Starte Dienste neu (installiert Abhängigkeiten & baut Frontend)..."
./start.sh

if [ -f "$ROOT/run/omnifm.pid" ] && kill -0 "$(cat "$ROOT/run/omnifm.pid" 2>/dev/null)" 2>/dev/null; then
  log "Website, API und Discord-Bot laufen mit diesem Code-Stand."
else
  log "ACHTUNG: OmniFM läuft NICHT. Details stehen in logs/omnifm.log."
fi

log "Update abgeschlossen."
