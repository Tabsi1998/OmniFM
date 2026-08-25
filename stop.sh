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

kill_orphaned_bot_runtime() {
  # The faulty 8080 release deleted bot.pid before it stopped the bot. Recover
  # only a known OmniFM Node entrypoint from this exact checkout; never search
  # by port or terminate unrelated services.
  [ -d /proc ] || return 0
  local root_real proc pid cwd command
  root_real="$(readlink -f "$ROOT" 2>/dev/null || printf '%s' "$ROOT")"
  for proc in /proc/[0-9]*; do
    [ -r "$proc/cmdline" ] || continue
    pid="${proc##*/}"
    [ "$pid" = "$$" ] && continue
    cwd="$(readlink -f "$proc/cwd" 2>/dev/null || true)"
    command="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)"
    [ "$cwd" = "$root_real" ] || continue
    case "$command" in
      *src/entrypoints/from-owner-config.mjs*|*src/index.js*)
        log "Stoppe verwaiste OmniFM-Bot-Runtime (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -9 "$pid" 2>/dev/null || true
        ;;
    esac
  done
}

kill_pid frontend
kill_pid backend
kill_pid bot
kill_orphaned_bot_runtime

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
