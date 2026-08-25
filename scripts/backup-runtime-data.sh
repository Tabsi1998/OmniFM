#!/usr/bin/env bash

# Create and restore recoverable archives of the persistent Node runtime
# directory. The restore path intentionally requires stopped OmniFM processes
# and an explicit --force because it replaces live state.
set -euo pipefail
umask 077

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${OMNIFM_HOST_RUNTIME_DATA_DIR:-$APP_DIR/runtime-data}"
BACKUP_DIR="${OMNIFM_RUNTIME_BACKUP_DIR:-$APP_DIR/.update-backups/runtime-data}"
MODE="${1:-create}"

fatal() {
  echo "[ERROR] $*" >&2
  exit 1
}

require_tar() {
  command -v tar >/dev/null 2>&1 || fatal "tar is required for runtime-data backups."
}

assert_default_runtime_dir() {
  [[ "$RUNTIME_DIR" == "$APP_DIR/runtime-data" ]] || fatal "OMNIFM_HOST_RUNTIME_DATA_DIR must be $APP_DIR/runtime-data for this deployment."
}

archive_name() {
  printf 'runtime-data-%s.tar.gz' "$(date +%Y%m%d-%H%M%S)"
}

validate_archive_layout() {
  local archive="$1" base entry
  base="$(basename "$RUNTIME_DIR")"

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    [[ "$entry" == "$base/"* || "$entry" == "$base" ]] || fatal "Archive contains an unexpected path: $entry"
    [[ "$entry" != /* && "$entry" != *"/../"* && "$entry" != ../* && "$entry" != *"/.." ]] \
      || fatal "Archive contains an unsafe path: $entry"
  done < <(tar -tzf "$archive")
}

ensure_omnifm_stopped() {
  local pid_file pid
  for pid_file in "$APP_DIR/run/backend.pid" "$APP_DIR/run/frontend.pid" "$APP_DIR/run/bot.pid"; do
    [[ -f "$pid_file" ]] || continue
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      fatal "Stop OmniFM first with ./stop.sh before restoring runtime data."
    fi
  done
}

create_backup() {
  local archive temp_archive checksum_file
  assert_default_runtime_dir
  require_tar
  [[ -d "$RUNTIME_DIR" ]] || fatal "Runtime data directory is missing: $RUNTIME_DIR. Run bash ./init-data.sh first."

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  archive="$BACKUP_DIR/$(archive_name)"
  temp_archive="${archive}.tmp-$$"
  tar -C "$(dirname "$RUNTIME_DIR")" -czf "$temp_archive" "$(basename "$RUNTIME_DIR")"
  chmod 600 "$temp_archive"
  validate_archive_layout "$temp_archive"
  mv "$temp_archive" "$archive"
  chmod 600 "$archive"

  if command -v sha256sum >/dev/null 2>&1; then
    checksum_file="${archive}.sha256"
    sha256sum "$archive" > "$checksum_file"
    chmod 600 "$checksum_file"
  fi

  echo "[OK] Runtime-data backup created: $archive"
}

list_backups() {
  local archive
  assert_default_runtime_dir
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "No runtime-data backups found."
    return 0
  fi
  for archive in "$BACKUP_DIR"/runtime-data-*.tar.gz; do
    [[ -f "$archive" ]] || continue
    printf '%s\n' "$archive"
  done | sort
}

restore_backup() {
  local archive="${2:-}" force="${3:-}" staging backup_previous base
  assert_default_runtime_dir
  require_tar
  [[ -n "$archive" && "$force" == "--force" ]] || fatal "Usage: $0 restore <archive.tar.gz> --force"
  [[ -f "$archive" ]] || fatal "Backup archive not found: $archive"
  ensure_omnifm_stopped
  validate_archive_layout "$archive"

  staging="$(mktemp -d "$APP_DIR/.runtime-data-restore.XXXXXX")"
  trap '[ -z "${staging:-}" ] || rm -rf "$staging"' EXIT
  tar -xzf "$archive" -C "$staging"
  base="$(basename "$RUNTIME_DIR")"
  [[ -d "$staging/$base" ]] || fatal "Backup archive does not contain $base/."

  backup_previous="${RUNTIME_DIR}.pre-restore-$(date +%Y%m%d-%H%M%S)"
  if [[ -e "$RUNTIME_DIR" ]]; then
    mv "$RUNTIME_DIR" "$backup_previous"
  fi
  mv "$staging/$base" "$RUNTIME_DIR"
  chmod 700 "$RUNTIME_DIR" 2>/dev/null || true
  rm -rf "$staging"
  trap - EXIT
  echo "[OK] Runtime data restored from $archive"
  echo "[INFO] Previous runtime data remains recoverable at $backup_previous"
  echo "[INFO] Start OmniFM with: ./start.sh"
}

case "$MODE" in
  create|backup)
    create_backup
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
  bash ./scripts/backup-runtime-data.sh create
  bash ./scripts/backup-runtime-data.sh list
  bash ./scripts/backup-runtime-data.sh restore <archive.tar.gz> --force

Restore intentionally requires stopped OmniFM processes and leaves the prior
runtime-data directory next to the restored one for recovery.
EOF
    ;;
  *)
    fatal "Unknown mode: $MODE"
    ;;
esac
