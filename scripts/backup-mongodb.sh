#!/usr/bin/env bash

# Create, verify, list and deliberately restore encrypted-credential-safe
# MongoDB archives for OmniFM. Connection credentials are passed through a
# private MongoDB tools config file so they never appear in the process list.
set -euo pipefail
umask 077

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OMNIFM_BACKEND_ENV:-$APP_DIR/backend/.env}"
BACKUP_DIR="${OMNIFM_MONGO_BACKUP_DIR:-$APP_DIR/.update-backups/mongodb}"
MODE="${1:-create}"
TOOLS_CONFIG=""

fatal() {
  echo "[ERROR] $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TOOLS_CONFIG" && -f "$TOOLS_CONFIG" ]]; then
    rm -f -- "$TOOLS_CONFIG"
  fi
}
trap cleanup EXIT

read_env_value() {
  local key="$1" line value
  line="$(grep -m1 -E "^${key}=" "$ENV_FILE" 2>/dev/null || true)"
  value="${line#*=}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

load_config() {
  [[ -f "$ENV_FILE" ]] || fatal "Backend configuration is missing: $ENV_FILE"
  command -v python3 >/dev/null 2>&1 || fatal "python3 is required to create a private MongoDB tools config."

  MONGO_URL="$(read_env_value MONGO_URL)"
  DB_NAME="$(read_env_value DB_NAME)"
  [[ -n "$MONGO_URL" ]] || fatal "MONGO_URL is missing in $ENV_FILE"
  [[ -n "$DB_NAME" ]] || fatal "DB_NAME is missing in $ENV_FILE"
  [[ "$DB_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || fatal "DB_NAME contains unsupported characters."

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR" 2>/dev/null || true
  if [[ -n "$TOOLS_CONFIG" && -f "$TOOLS_CONFIG" ]]; then
    rm -f -- "$TOOLS_CONFIG"
  fi
  TOOLS_CONFIG="$(mktemp "$BACKUP_DIR/.mongo-tools.XXXXXX.yml")"
  printf '%s' "$MONGO_URL" \
    | python3 -c 'import json,sys; print("uri: " + json.dumps(sys.stdin.read()))' \
    > "$TOOLS_CONFIG"
  chmod 600 "$TOOLS_CONFIG"
}

require_backup_tools() {
  command -v mongodump >/dev/null 2>&1 || fatal "mongodump is required (package: mongodb-database-tools)."
  command -v gzip >/dev/null 2>&1 || fatal "gzip is required for MongoDB backup verification."
}

require_restore_tools() {
  command -v mongorestore >/dev/null 2>&1 || fatal "mongorestore is required (package: mongodb-database-tools)."
}

archive_name() {
  printf 'mongodb-%s-%s-%s.archive.gz' "$DB_NAME" "$(date -u +%Y%m%dT%H%M%SZ)" "${BASHPID:-$$}"
}

verify_backup() {
  local archive="$1" checksum_file
  [[ -f "$archive" ]] || fatal "MongoDB backup archive not found: $archive"
  [[ -s "$archive" ]] || fatal "MongoDB backup archive is empty: $archive"
  command -v gzip >/dev/null 2>&1 || fatal "gzip is required for MongoDB backup verification."
  gzip -t -- "$archive" || fatal "MongoDB backup archive is corrupt: $archive"

  checksum_file="${archive}.sha256"
  if [[ -f "$checksum_file" ]]; then
    command -v sha256sum >/dev/null 2>&1 || fatal "sha256sum is required to verify $checksum_file"
    (
      cd "$(dirname "$archive")"
      sha256sum -c "$(basename "$checksum_file")" >/dev/null
    ) || fatal "MongoDB backup checksum does not match: $archive"
  fi
  echo "[OK] MongoDB backup verified: $archive"
}

create_backup() {
  local archive temp_archive checksum_file
  load_config
  require_backup_tools

  archive="$BACKUP_DIR/$(archive_name)"
  temp_archive="${archive}.tmp"
  checksum_file="${archive}.sha256"
  rm -f -- "$temp_archive"

  mongodump \
    --config="$TOOLS_CONFIG" \
    --db="$DB_NAME" \
    --archive="$temp_archive" \
    --gzip
  chmod 600 "$temp_archive"
  gzip -t -- "$temp_archive" || fatal "mongodump created an invalid compressed archive."
  mv -- "$temp_archive" "$archive"
  chmod 600 "$archive"

  if command -v sha256sum >/dev/null 2>&1; then
    (
      cd "$BACKUP_DIR"
      sha256sum "$(basename "$archive")" > "$(basename "$checksum_file")"
    )
    chmod 600 "$checksum_file"
  fi

  echo "[OK] MongoDB backup created: $archive"
}

list_backups() {
  local archive
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "No MongoDB backups found."
    return 0
  fi
  for archive in "$BACKUP_DIR"/mongodb-*.archive.gz; do
    [[ -f "$archive" ]] || continue
    printf '%s\n' "$archive"
  done | sort
}

ensure_omnifm_stopped() {
  local pid_file pid
  for pid_file in "$APP_DIR/run/backend.pid" "$APP_DIR/run/frontend.pid" "$APP_DIR/run/bot.pid"; do
    [[ -f "$pid_file" ]] || continue
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      fatal "Stop OmniFM first with ./stop.sh before restoring MongoDB."
    fi
  done
}

restore_backup() {
  local archive="${2:-}" force="${3:-}"
  [[ -n "$archive" && "$force" == "--force" ]] \
    || fatal "Usage: $0 restore <mongodb-archive.gz> --force"
  ensure_omnifm_stopped
  load_config
  require_backup_tools
  require_restore_tools
  verify_backup "$archive"

  echo "[INFO] Creating a safety backup of the current database before restore."
  create_backup
  mongorestore \
    --config="$TOOLS_CONFIG" \
    --archive="$archive" \
    --gzip \
    --nsInclude="${DB_NAME}.*" \
    --drop \
    --stopOnError
  echo "[OK] MongoDB database $DB_NAME restored from: $archive"
  echo "[INFO] Start OmniFM with: ./start.sh"
}

case "$MODE" in
  create|backup)
    create_backup
    ;;
  verify)
    [[ -n "${2:-}" ]] || fatal "Usage: $0 verify <mongodb-archive.gz>"
    verify_backup "$2"
    ;;
  list)
    list_backups
    ;;
  restore)
    restore_backup "$@"
    ;;
  -h|--help|help)
    cat <<'EOF'
Usage:
  bash ./scripts/backup-mongodb.sh create
  bash ./scripts/backup-mongodb.sh list
  bash ./scripts/backup-mongodb.sh verify <mongodb-archive.gz>
  bash ./scripts/backup-mongodb.sh restore <mongodb-archive.gz> --force

Restore requires stopped OmniFM processes, verifies the selected archive and
creates a second safety backup of the current database before replacing data.
No backup is deleted automatically.
EOF
    ;;
  *)
    fatal "Unknown mode: $MODE"
    ;;
esac
