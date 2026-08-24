#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM — clean start script (Ubuntu / Debian)
# Installs dependencies (first run) and starts MongoDB, the FastAPI backend
# and the React frontend. Idempotent: safe to run multiple times.
# Usage:  ./start.sh
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/run"
LOG_DIR="$ROOT/logs"
VENV="$ROOT/.venv"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8001}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

log()  { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; exit 1; }

command -v python3 >/dev/null 2>&1 || die "python3 ist nicht installiert."
command -v node    >/dev/null 2>&1 || die "node ist nicht installiert (Node 18+ empfohlen)."
command -v yarn    >/dev/null 2>&1 || { warn "yarn fehlt – installiere via 'npm i -g yarn'"; command -v npm >/dev/null 2>&1 && npm i -g yarn || die "npm fehlt ebenfalls."; }

# --- MongoDB -----------------------------------------------------------------
if ! pgrep -x mongod >/dev/null 2>&1; then
  if command -v mongod >/dev/null 2>&1; then
    log "Starte MongoDB..."
    mkdir -p "$ROOT/data/db"
    nohup mongod --dbpath "$ROOT/data/db" --bind_ip_all >"$LOG_DIR/mongod.log" 2>&1 &
    echo $! > "$RUN_DIR/mongod.pid"
    sleep 3
  else
    warn "mongod nicht gefunden. Stelle sicher, dass MONGO_URL in backend/.env auf eine erreichbare MongoDB zeigt."
  fi
else
  log "MongoDB läuft bereits."
fi

# --- Backend (FastAPI) -------------------------------------------------------
log "Richte Python-Umgebung ein..."
[ -d "$VENV" ] || python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$ROOT/backend/requirements.txt"

[ -f "$ROOT/backend/.env" ] || warn "backend/.env fehlt – bitte MONGO_URL, DB_NAME und API_ADMIN_TOKEN setzen."

log "Starte Backend auf Port $BACKEND_PORT..."
( cd "$ROOT/backend" && nohup "$VENV/bin/uvicorn" server:app --host 0.0.0.0 --port "$BACKEND_PORT" --workers 1 \
  >"$LOG_DIR/backend.log" 2>&1 & echo $! > "$RUN_DIR/backend.pid" )

# --- Frontend (React) --------------------------------------------------------
log "Installiere Frontend-Abhängigkeiten..."
( cd "$ROOT/frontend" && yarn install --frozen-lockfile 2>/dev/null || yarn install )

log "Baue Frontend..."
( cd "$ROOT/frontend" && yarn build )

log "Serviere Frontend auf Port $FRONTEND_PORT..."
( cd "$ROOT/frontend" && nohup npx --yes serve -s build -l "$FRONTEND_PORT" \
  >"$LOG_DIR/frontend.log" 2>&1 & echo $! > "$RUN_DIR/frontend.pid" )

# --- Discord bot (DB-driven, optional) --------------------------------------
# Reads Commander + Workers straight from the Owner Console (MongoDB).
# Skips gracefully if no bot token has been configured yet.
if [ -f "$ROOT/package.json" ]; then
  log "Installiere Bot-Abhängigkeiten (Node)..."
  ( cd "$ROOT" && npm install --no-audit --no-fund --engine-strict=false --loglevel=error ) || warn "Bot-Abhängigkeiten konnten nicht installiert werden."
  log "Starte Discord-Bot aus Owner-Menü-Konfiguration..."
  ( cd "$ROOT" && nohup node src/entrypoints/from-owner-config.mjs >"$LOG_DIR/bot.log" 2>&1 & echo $! > "$RUN_DIR/bot.pid" )
  sleep 3
  BOT_PID="$(cat "$RUN_DIR/bot.pid" 2>/dev/null)"
  if [ -n "$BOT_PID" ] && kill -0 "$BOT_PID" 2>/dev/null; then
    log "Discord-Bot läuft (PID $BOT_PID)."
  else
    rm -f "$RUN_DIR/bot.pid"
    warn "Discord-Bot nicht gestartet – vermutlich noch kein Commander-Token hinterlegt."
    warn "Trage Tokens unter /admin → 'Discord & Bots' ein und führe ./update.sh (oder ./start.sh) erneut aus."
  fi
fi

log "Fertig. Backend: http://localhost:$BACKEND_PORT  |  Frontend: http://localhost:$FRONTEND_PORT"
log "Logs: $LOG_DIR   Stoppen mit: ./stop.sh"
