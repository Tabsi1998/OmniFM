#!/usr/bin/env bash
# #290: plays the switch and the way back on a fresh Ubuntu 24.04 in Docker.
#
#   bash scripts/rehearse-public-switch.sh [--keep]
#
# The checkout as it is (tracked and new files) goes into a container, and
# start.sh installs everything like on a new server (MongoDB, Node, Python,
# frontend build; no systemd, so the nohup path). Then three starts, the way
# update.sh starts: Node as the public entry, the way back to FastAPI
# (OMNIFM_PUBLIC_BACKEND=fastapi), and Node again. After each start it checks
# who answers :8001 and that the other backend no longer runs. Takes about
# ten minutes, most of it the first installation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="omnifm-switch-rehearsal"
IMAGE="ubuntu:24.04"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

say() { printf '\033[1;36m[rehearsal]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[rehearsal] FEHLER:\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker fehlt."
docker info >/dev/null 2>&1 || fail "Die Docker-Engine läuft nicht."

work="$(mktemp -d)"
cleanup() {
  rm -rf "$work"
  if [ "$KEEP" -eq 0 ]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

say "Packe den Checkout (ohne node_modules, Builds, venv)..."
(cd "$ROOT" && git ls-files -co --exclude-standard) > "$work/files.txt"
tar -C "$ROOT" -cf "$work/src.tar" -T "$work/files.txt"

docker rm -f "$NAME" >/dev/null 2>&1 || true
say "Starte $IMAGE..."
docker run -d --name "$NAME" "$IMAGE" sleep infinity >/dev/null
docker cp "$work/src.tar" "$NAME:/tmp/src.tar"
docker exec "$NAME" bash -c 'set -e; mkdir -p /opt/omnifm && tar -xf /tmp/src.tar -C /opt/omnifm
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null && apt-get install -y -qq git curl procps ca-certificates >/dev/null
  cd /opt/omnifm && git init -q && git add -A >/dev/null && git -c user.name=rehearsal -c user.email=r@example.test commit -qm rehearsal'

run_start() {
  local label="$1" backend="$2"
  say "$label: OMNIFM_PUBLIC_BACKEND=$backend, ./start.sh ..."
  docker exec "$NAME" bash -c "cd /opt/omnifm
    if [ -f backend/.env ]; then
      sed -i '/^OMNIFM_PUBLIC_BACKEND=/d' backend/.env
      echo OMNIFM_PUBLIC_BACKEND=$backend >> backend/.env
    fi
    OMNIFM_SKIP_SYSTEMD=1 ./start.sh > logs-start-$backend.txt 2>&1 \
      || { tail -n 60 logs-start-$backend.txt; exit 1; }" || fail "$label: start.sh ist fehlgeschlagen."
}

check_backend() {
  local label="$1" expected="$2"
  docker exec "$NAME" bash -c '
    health="$(curl -s --max-time 5 http://127.0.0.1:8001/api/health)"
    printf "%s" "$health" | grep -q "\"contractVersion\":\"owner-live-v5\"" || { echo "kein Vertrag: $health"; exit 1; }
    # Command lines from their start, so this check never counts itself.
    node_api=$(ps -eo args= | grep -cE "^node src/entrypoints/api[.]js")
    uvicorn=$(ps -eo args= | grep -cE "^[^ ]*python[^ ]* [^ ]*/uvicorn server:app")
    stats=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/api/stats)
    echo "node_api=$node_api uvicorn=$uvicorn stats=$stats"
    if [ "'"$expected"'" = node ]; then
      [ "$node_api" -ge 1 ] && [ "$uvicorn" -eq 0 ] || exit 1
      # Only the Node entry has these fields in its health answer.
      printf "%s" "$health" | grep -q "\"readyBots\"" || exit 1
    else
      [ "$uvicorn" -ge 1 ] && [ "$node_api" -eq 0 ] || exit 1
      printf "%s" "$health" | grep -q "\"readyBots\"" && exit 1
    fi
    [ "$stats" = 200 ]' || fail "$label: :8001 wird nicht vom erwarteten Backend ($expected) beantwortet."
  say "$label: :8001 beantwortet $expected, das andere Backend läuft nicht."
}

run_start "1/3 Umschalten" node
check_backend "1/3 Umschalten" node
run_start "2/3 Rückweg" fastapi
check_backend "2/3 Rückweg" fastapi
run_start "3/3 Wieder Node" node
check_backend "3/3 Wieder Node" node
say "Umschalten und Rückweg funktionieren."
