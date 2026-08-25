#!/usr/bin/env bash
# Stops the canonical OmniFM Node.js runtime started by ./start.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/run"

log() { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }

stop_process() {
  local name="$1" pid="$2"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
  log "Stoppe $name (PID $pid) ..."
  kill "$pid" 2>/dev/null || true
  for _ in {1..10}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
}

stop_pid() {
  local name="$1" file="$RUN_DIR/$1.pid"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  stop_process "$name" "$pid"
  rm -f "$file"
}

stop_orphaned_omnifm_processes() {
  # A short-lived release removed legacy PID files before stopping the old
  # processes. Recover only processes whose command and working directory
  # prove they belong to this exact OmniFM checkout; never search by port or
  # kill an unrelated Node/Python service.
  [[ -d /proc ]] || return 0
  local root_real backend_real frontend_real proc_dir pid cwd command
  root_real="$(readlink -f "$ROOT" 2>/dev/null || printf '%s' "$ROOT")"
  backend_real="$root_real/backend"
  frontend_real="$root_real/frontend"

  for proc_dir in /proc/[0-9]*; do
    [[ -r "$proc_dir/cmdline" ]] || continue
    pid="${proc_dir##*/}"
    [[ "$pid" == "$$" ]] && continue
    cwd="$(readlink -f "$proc_dir/cwd" 2>/dev/null || true)"
    command="$(tr '\0' ' ' < "$proc_dir/cmdline" 2>/dev/null || true)"
    [[ -n "$command" ]] || continue

    if [[ "$cwd" == "$root_real" ]] && [[ "$command" == *"src/index.js"* || "$command" == *"src/entrypoints/from-owner-config.mjs"* || "$command" == *"src/entrypoints/commander.js"* || "$command" == *"src/entrypoints/worker.js"* || "$command" == *"src/entrypoints/worker-autoheal.js"* ]]; then
      stop_process "verwaiste OmniFM-Runtime" "$pid"
    elif [[ "$cwd" == "$backend_real" ]] && [[ "$command" == *"uvicorn"*"server:app"* || "$command" == *"python"*"server.py"* ]]; then
      stop_process "verwaistes OmniFM-Backend" "$pid"
    elif [[ "$cwd" == "$frontend_real" ]] && [[ "$command" == *"react-scripts"*"start"* ]]; then
      stop_process "verwaistes OmniFM-Frontend" "$pid"
    fi
  done
}

stop_pid omnifm
# Releases before the unified Node runtime wrote these PID files. Stop only
# the explicitly recorded processes; never use a broad process search that
# could affect unrelated services on the host.
stop_pid frontend
stop_pid backend
stop_pid bot
stop_orphaned_omnifm_processes
log "Gestoppt."
