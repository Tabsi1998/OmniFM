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

kill_orphaned_omnifm_processes() {
  # Recover only known OmniFM processes whose working directory belongs to
  # this exact checkout. This also handles missing/stale PID files without ever
  # terminating an unrelated process merely because it uses port 3000/8001.
  [ -d /proc ] || return 0
  local root_real backend_real frontend_real proc pid cwd command service
  root_real="$(readlink -f "$ROOT" 2>/dev/null || printf '%s' "$ROOT")"
  backend_real="$(readlink -f "$ROOT/backend" 2>/dev/null || printf '%s/backend' "$root_real")"
  frontend_real="$(readlink -f "$ROOT/frontend" 2>/dev/null || printf '%s/frontend' "$root_real")"
  for proc in /proc/[0-9]*; do
    [ -r "$proc/cmdline" ] || continue
    pid="${proc##*/}"
    [ "$pid" = "$$" ] && continue
    cwd="$(readlink -f "$proc/cwd" 2>/dev/null || true)"
    command="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)"
    service=""
    if [ "$cwd" = "$root_real" ]; then
      case "$command" in
        *src/entrypoints/from-owner-config.mjs*|*src/index.js*) service="Bot-Runtime" ;;
      esac
    elif [ "$cwd" = "$backend_real" ]; then
      case "$command" in
        *uvicorn*server:app*) service="FastAPI-Backend" ;;
      esac
    elif [ "$cwd" = "$frontend_real" ]; then
      case "$command" in
        *node_modules/.bin/serve*-s*build*|*serve/build/main.js*-s*build*) service="React-Frontend" ;;
      esac
    fi
    [ -n "$service" ] || continue
    log "Stoppe verwaisten OmniFM-$service-Prozess (PID $pid)..."
    kill "$pid" 2>/dev/null || true
  done

  # Give all matched processes one grace period, then reclaim only survivors
  # that still match the exact checkout on the second pass.
  sleep 1
  for proc in /proc/[0-9]*; do
    [ -r "$proc/cmdline" ] || continue
    pid="${proc##*/}"
    cwd="$(readlink -f "$proc/cwd" 2>/dev/null || true)"
    command="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)"
    case "$cwd:$command" in
      "$root_real":*src/entrypoints/from-owner-config.mjs*|"$root_real":*src/index.js*|"$backend_real":*uvicorn*server:app*|"$frontend_real":*node_modules/.bin/serve*-s*build*|"$frontend_real":*serve/build/main.js*-s*build*)
        kill -9 "$pid" 2>/dev/null || true
        ;;
    esac
  done
}

kill_pid frontend
kill_pid backend
kill_pid bot
kill_orphaned_omnifm_processes

if [ "${1:-}" = "--all" ]; then
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet mongod 2>/dev/null; then
    SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
    log "Stoppe MongoDB (systemd)..."
    $SUDO systemctl stop mongod || true
  else
    kill_pid mongod
  fi
fi

log "Gestoppt."
