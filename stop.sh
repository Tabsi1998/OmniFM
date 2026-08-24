#!/usr/bin/env bash
# ============================================================
# OmniFM Web Stack — stop (Ubuntu / self-hosted)
# Stops processes started by ./start.sh
# ============================================================
set -uo pipefail
cd "$(dirname "$0")"
RUN_DIR=".run"

stop_pid() {
  local name="$1" file="$RUN_DIR/$1.pid"
  if [ -f "$file" ]; then
    local pid; pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "==> Stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  else
    echo "==> No $name pidfile, skipping"
  fi
}

stop_pid backend
stop_pid frontend
echo "==> OmniFM Web Stack stopped."
