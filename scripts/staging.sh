#!/usr/bin/env bash

# A second OmniFM on the same server for trying a branch before production
# (#262). Run from the production checkout:
#
#   bash scripts/staging.sh setup [--domain staging.example.com]
#   bash scripts/staging.sh deploy [branch]      (default: main)
#   bash scripts/staging.sh status
#   bash scripts/staging.sh stop
#   bash scripts/staging.sh remove
#
# Staging is a Git worktree next to production (OMNIFM_STAGING_DIR, default
# ../omnifm-staging) with its own instance.env (units omnifm-staging-*, ports
# 3100/8101/8102), its own backend/.env (database <DB_NAME>_staging, its own
# owner token, no production alerts), runtime-data and logs. It shares only
# the MongoDB server with production. The Discord bots of staging are their
# own test applications, entered in the staging owner console.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING_DIR="${OMNIFM_STAGING_DIR:-$(dirname "$ROOT")/omnifm-staging}"
STAGING_FRONTEND_PORT="${STAGING_FRONTEND_PORT:-3100}"
STAGING_BACKEND_PORT="${STAGING_BACKEND_PORT:-8101}"
STAGING_NODE_API_PORT="${STAGING_NODE_API_PORT:-8102}"

log() { printf '\033[1;35m[Staging]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

env_value() { # file key
  local line
  line="$(grep -m1 -E "^$2=" "$1" 2>/dev/null || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

random_token() {
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

setup() {
  local domain="" prod_env mongo_url prod_db staging_db public_url origins backend_url
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --domain) domain="${2:?--domain braucht einen Namen}"; shift 2 ;;
      *) die "Unbekannte Option: $1" ;;
    esac
  done
  [ ! -e "$STAGING_DIR" ] || die "$STAGING_DIR gibt es schon. Neu aufsetzen: erst bash scripts/staging.sh remove."
  prod_env="$ROOT/backend/.env"
  [ -f "$prod_env" ] || die "backend/.env der Produktion fehlt; Staging uebernimmt daraus nur MONGO_URL."
  mongo_url="$(env_value "$prod_env" MONGO_URL)"
  prod_db="$(env_value "$prod_env" DB_NAME)"
  [ -n "$mongo_url" ] && [ -n "$prod_db" ] || die "MONGO_URL oder DB_NAME fehlt in backend/.env."
  staging_db="${prod_db}_staging"
  [ "$staging_db" != "$prod_db" ] || die "Die Staging-Datenbank darf nicht die der Produktion sein."

  log "Hole den aktuellen Stand und lege den Worktree $STAGING_DIR an..."
  git -C "$ROOT" fetch --quiet origin
  git -C "$ROOT" worktree add --quiet --detach "$STAGING_DIR" origin/main

  if [ -n "$domain" ]; then
    public_url="https://$domain"
    origins="$public_url"
    backend_url=""
  else
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    ip="${ip:-localhost}"
    public_url="http://$ip:$STAGING_BACKEND_PORT"
    origins="http://$ip:$STAGING_FRONTEND_PORT"
    backend_url="http://$ip:$STAGING_BACKEND_PORT"
  fi

  cat > "$STAGING_DIR/instance.env" <<EOF
# Staging instance (#262), written by scripts/staging.sh setup.
OMNIFM_INSTANCE=staging
FRONTEND_PORT=$STAGING_FRONTEND_PORT
BACKEND_PORT=$STAGING_BACKEND_PORT
EOF
  mkdir -p "$STAGING_DIR/backend" "$STAGING_DIR/frontend"
  umask 077
  cat > "$STAGING_DIR/backend/.env" <<EOF
# Staging (#262): own database, own owner token, no production alerts.
MONGO_URL=$mongo_url
DB_NAME=$staging_db
API_ADMIN_TOKEN=$(random_token)
PUBLIC_WEB_URL=$public_url
CORS_ALLOWED_ORIGINS=$origins
CHECKOUT_RETURN_ORIGINS=$origins
DEFAULT_LANGUAGE=de
SEED_DEMO_DATA=0
OMNIFM_DASHBOARD_BACKEND=node
OMNIFM_NODE_API_PORT=$STAGING_NODE_API_PORT
EOF
  printf 'REACT_APP_BACKEND_URL=%s\n' "$backend_url" > "$STAGING_DIR/frontend/.env"

  log "Staging ist angelegt: $STAGING_DIR (Datenbank $staging_db)."
  log "Owner-Token: $(env_value "$STAGING_DIR/backend/.env" API_ADMIN_TOKEN)"
  log "Naechster Schritt: bash scripts/staging.sh deploy [branch]"
}

deploy() {
  local branch="${1:-main}"
  [ -f "$STAGING_DIR/instance.env" ] || die "Kein Staging unter $STAGING_DIR. Erst: bash scripts/staging.sh setup"
  git -C "$STAGING_DIR" diff --quiet HEAD -- || die "Lokale Aenderungen im Staging-Checkout; bitte zuerst verwerfen."
  log "Hole origin/$branch..."
  git -C "$STAGING_DIR" fetch --quiet origin "$branch"
  git -C "$STAGING_DIR" checkout --quiet --detach FETCH_HEAD
  log "Staging steht auf $(git -C "$STAGING_DIR" log -1 --format='%h %s' | head -c 100)"
  ( cd "$STAGING_DIR" && ./start.sh )
  log "Fertig. Pruefen: bash scripts/staging.sh status"
}

status() {
  [ -f "$STAGING_DIR/instance.env" ] || die "Kein Staging unter $STAGING_DIR."
  echo "== Staging ($STAGING_DIR) =="
  echo "Code: $(git -C "$STAGING_DIR" log -1 --format='%h %s' 2>/dev/null | head -c 100)"
  ( cd "$STAGING_DIR" && ./update.sh --status quick ) || true
}

remove() {
  local sudo_cmd="" part
  [ -e "$STAGING_DIR" ] || die "Kein Staging unter $STAGING_DIR."
  [ -f "$STAGING_DIR/stop.sh" ] && ( cd "$STAGING_DIR" && ./stop.sh ) || true
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    [ "$(id -u)" -eq 0 ] || sudo_cmd="sudo"
    for part in bot frontend backend; do
      $sudo_cmd systemctl disable "omnifm-staging-$part" >/dev/null 2>&1 || true
      $sudo_cmd rm -f "/etc/systemd/system/omnifm-staging-$part.service"
    done
    $sudo_cmd systemctl daemon-reload || true
  fi
  git -C "$ROOT" worktree remove --force "$STAGING_DIR"
  log "Staging entfernt. Die Datenbank $(env_value "$ROOT/backend/.env" DB_NAME)_staging bleibt in MongoDB, bis du sie loeschst."
}

case "${1:-}" in
  setup) shift; setup "$@" ;;
  deploy) deploy "${2:-main}" ;;
  status) status ;;
  stop) ( cd "$STAGING_DIR" && ./stop.sh ) ;;
  remove) remove ;;
  *) die "Nutzung: bash scripts/staging.sh setup [--domain name] | deploy [branch] | status | stop | remove" ;;
esac
