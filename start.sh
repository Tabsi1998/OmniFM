#!/usr/bin/env bash
# ============================================================
# OmniFM Web Stack — start (Ubuntu / self-hosted)
# Starts the FastAPI management API and serves the built React
# dashboard. Run ./stop.sh to stop, ./update.sh to update.
#
# Requirements: python3 (venv), node>=22, yarn, MongoDB reachable
# via MONGO_URL in backend/.env.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

RUN_DIR=".run"
mkdir -p "$RUN_DIR"

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

echo "==> OmniFM Web Stack starting"

# --- Backend (FastAPI) ---
if [ ! -d ".venv" ]; then
  echo "==> Creating Python virtualenv (.venv)"
  python3 -m venv .venv
fi
./.venv/bin/pip install -q -r backend/requirements.txt

echo "==> Starting backend on ${BACKEND_HOST}:${BACKEND_PORT}"
( cd backend && nohup ../.venv/bin/uvicorn server:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
    > "../$RUN_DIR/backend.log" 2>&1 & echo $! > "../$RUN_DIR/backend.pid" )

# --- Frontend (build + static serve) ---
echo "==> Building frontend"
( cd frontend && yarn install --frozen-lockfile >/dev/null 2>&1 || yarn install; yarn build )

echo "==> Serving frontend on :${FRONTEND_PORT}"
nohup npx --yes serve -s frontend/build -l "$FRONTEND_PORT" \
  > "$RUN_DIR/frontend.log" 2>&1 & echo $! > "$RUN_DIR/frontend.pid"

echo "==> OmniFM Web Stack is up."
echo "    API:      http://localhost:${BACKEND_PORT}/api/health"
echo "    Dashboard http://localhost:${FRONTEND_PORT}/"
echo "    Owner:    http://localhost:${FRONTEND_PORT}/admin"
