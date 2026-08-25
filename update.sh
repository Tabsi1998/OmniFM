#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM — update script. Pulls the latest code, updates dependencies and
# restarts the stack. Run this on your server after a deploy.
# Usage:  ./update.sh | ./update.sh --doctor
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

log() { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; exit 1; }

doctor() {
  local failed=0
  log "Prüfe Deployment-Konfiguration (ohne Änderungen)..."
  [ -f "$ROOT/backend/.env" ] || { log "FEHLT: backend/.env"; failed=1; }
  [ -f "$ROOT/frontend/.env" ] || { log "FEHLT: frontend/.env"; failed=1; }
  command -v python3 >/dev/null 2>&1 || { log "FEHLT: python3"; failed=1; }
  command -v node >/dev/null 2>&1 || { log "FEHLT: node"; failed=1; }
  command -v npm >/dev/null 2>&1 || { log "FEHLT: npm"; failed=1; }
  command -v curl >/dev/null 2>&1 || { log "FEHLT: curl"; failed=1; }
  if command -v node >/dev/null 2>&1; then
    [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" = "22" ] \
      || { log "FALSCH: Node.js 22 ist erforderlich (gefunden: $(node -v 2>/dev/null || echo unbekannt))"; failed=1; }
  fi
  if [ -f "$ROOT/backend/.env" ]; then
    grep -qE '^MONGO_URL=..+' "$ROOT/backend/.env" || { log "FEHLT: MONGO_URL in backend/.env"; failed=1; }
    grep -qE '^DB_NAME=..+' "$ROOT/backend/.env" || { log "FEHLT: DB_NAME in backend/.env"; failed=1; }
    grep -qE '^API_ADMIN_TOKEN=..+' "$ROOT/backend/.env" || { log "FEHLT: API_ADMIN_TOKEN in backend/.env"; failed=1; }
  fi
  [ "$failed" -eq 0 ] || die "Konfigurationsprüfung fehlgeschlagen. Es wurde nichts verändert."
  log "Konfiguration ist deploy-fähig. Es wurde nichts verändert."
}

if [ "${1:-}" = "--doctor" ]; then
  [ "$#" -eq 1 ] || die "--doctor akzeptiert keine weiteren Argumente."
  doctor
  exit 0
fi
[ "$#" -eq 0 ] || die "Unbekannte Argumente. Nutzung: ./update.sh oder ./update.sh --doctor"

BACKUP_DIR="$ROOT/.update-backups/config/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
for config_file in backend/.env frontend/.env; do
  if [ -f "$ROOT/$config_file" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$config_file")"
    cp -p "$ROOT/$config_file" "$BACKUP_DIR/$config_file"
  fi
done
log "Konfigurations-Backup: $BACKUP_DIR"

if [ -d .git ]; then
  log "Hole neuesten Stand (git pull)..."
  git pull --ff-only || die "git pull fehlgeschlagen. Dienste und Konfiguration wurden nicht verändert."
  log "Code-Stand: $(git log -1 --pretty='%h — %s' 2>/dev/null | head -c 120 || echo 'unbekannt')"
else
  log "Kein Git-Repository – überspringe git pull."
fi

log "Bereite Update vor und starte Frontend, FastAPI und Discord-Runtime gemeinsam neu..."
./start.sh

if [ -f "$ROOT/run/bot.pid" ] && kill -0 "$(cat "$ROOT/run/bot.pid" 2>/dev/null)" 2>/dev/null; then
  log "Discord-Bot läuft mit diesem Code-Stand. Prüfen: /help in Discord zeigt unten im Footer die Version."
else
  log "ACHTUNG: Discord-Bot läuft NICHT (Commander-Token unter /admin → Discord & Bots eintragen, dann ./start.sh)."
  log "Ohne laufenden Bot ändern sich Discord-Embeds NICHT — alte Nachrichten bleiben alt."
fi

log "Update abgeschlossen."
