#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM canonical runtime start
# Builds the React frontend and starts the Node.js API + Discord runtime as one
# process. The archived Python backend is intentionally not started here.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/run"
LOG_DIR="$ROOT/logs"
ENV_FILE="$ROOT/.env"

log() { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[OmniFM]\033[0m %s\n" "$*" >&2; exit 1; }

mkdir -p "$RUN_DIR" "$LOG_DIR"
cd "$ROOT"

command -v node >/dev/null 2>&1 || die "Node.js 22 ist erforderlich."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" == "22" ]] || die "Node.js 22 ist erforderlich (gefunden: $(node -v))."
command -v npm >/dev/null 2>&1 || die "npm wurde nicht gefunden."

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE" || true
  log ".env aus .env.example angelegt. Bitte Bot-Token und API_ADMIN_TOKEN setzen."
fi

if [[ -f "$RUN_DIR/omnifm.pid" ]] && kill -0 "$(cat "$RUN_DIR/omnifm.pid" 2>/dev/null)" 2>/dev/null; then
  die "OmniFM laeuft bereits (PID $(cat "$RUN_DIR/omnifm.pid")). Erst ./stop.sh ausfuehren."
fi
rm -f "$RUN_DIR/omnifm.pid"

log "Installiere Backend-Abhaengigkeiten ..."
npm ci --no-audit --no-fund --engine-strict=false
log "Installiere Frontend-Abhaengigkeiten und baue das Frontend ..."
npm --prefix frontend ci --no-audit --no-fund --engine-strict=false
npm run frontend:build

log "Starte Node.js API, Website und Discord-Runtime ..."
nohup node src/index.js >"$LOG_DIR/omnifm.log" 2>&1 &
echo $! >"$RUN_DIR/omnifm.pid"

sleep 2
if ! kill -0 "$(cat "$RUN_DIR/omnifm.pid")" 2>/dev/null; then
  tail -n 80 "$LOG_DIR/omnifm.log" >&2 || true
  rm -f "$RUN_DIR/omnifm.pid"
  die "OmniFM konnte nicht gestartet werden."
fi

log "OmniFM ist gestartet (PID $(cat "$RUN_DIR/omnifm.pid"))."
log "Website, API und Discord laufen aus demselben Release-Stand."
