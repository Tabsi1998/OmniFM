#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM — stop script. Stops frontend, backend and (optionally) MongoDB
# that were started via ./start.sh.
# Usage:  ./stop.sh            (keeps MongoDB running)
#         ./stop.sh --all      (also stops the MongoDB started by start.sh)
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/run"

log() { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }

kill_pid() {
  local name="$1" file="$RUN_DIR/$1.pid"
  if [ -f "$file" ]; then
    local pid; pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      log "Stoppe $name (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  else
    log "$name läuft nicht (keine PID-Datei)."
  fi
}

kill_pid frontend
kill_pid backend
kill_pid bot

if [ "${1:-}" = "--all" ]; then
  kill_pid mongod
fi

log "Gestoppt."
