#!/usr/bin/env bash
# Stops the canonical OmniFM Node.js runtime started by ./start.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/run"

log() { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }

stop_pid() {
  local name="$1" file="$RUN_DIR/$1.pid"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    log "Stoppe $name (PID $pid) ..."
    kill "$pid" 2>/dev/null || true
    for _ in {1..10}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

stop_pid omnifm
# Releases before the unified Node runtime wrote these PID files. Stop only
# the explicitly recorded processes; never use a broad process search that
# could affect unrelated services on the host.
stop_pid frontend
stop_pid backend
stop_pid bot
log "Gestoppt."
