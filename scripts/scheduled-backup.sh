#!/usr/bin/env bash

# Nightly backup of omnifm-backup.timer (#259): runtime data and MongoDB,
# thinning out old archives, an optional copy to another machine and, every
# four weeks, a restore check. A failed step does not stop the others; at the
# end every failure is reported to the operator webhook and the run exits 1,
# which `systemctl status omnifm-backup` and `./update.sh --status backup` show.
set -uo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${OMNIFM_NODE:-$(command -v node || true)}"
BACKUPS="$ROOT/.update-backups"
RESTORE_CHECK_DAYS="${OMNIFM_RESTORE_CHECK_DAYS:-28}"
FAILED=()

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

run_step() { # label, command...
  local label="$1"
  shift
  echo "[$(stamp)] $label ..."
  if "$@"; then
    echo "[$(stamp)] OK: $label"
  else
    echo "[$(stamp)] FEHLER: $label" >&2
    FAILED+=("$label")
  fi
}

copy_offsite() {
  local target="$OMNIFM_BACKUP_REMOTE" kind
  for kind in mongodb runtime-data; do
    [ -d "$BACKUPS/$kind" ] || continue
    case "$target" in
      rclone:*)
        rclone copy "$BACKUPS/$kind" "${target#rclone:}/$kind" || return 1
        ;;
      *)
        # Copies only; the remote side never loses an archive because the
        # local one was rotated away or the local disk failed.
        rsync -a --ignore-existing "$BACKUPS/$kind/" "$target/$kind/" || return 1
        ;;
    esac
  done
}

restore_check_due() {
  local marker="$BACKUPS/mongodb/.last-restore-check.json"
  [ "$RESTORE_CHECK_DAYS" != "0" ] || return 1
  [ -f "$marker" ] || return 0
  # A failed check is repeated the next night, a good one after the interval.
  grep -q '"ok": false' "$marker" && return 0
  [ -n "$(find "$marker" -mtime "+$((RESTORE_CHECK_DAYS - 1))" 2>/dev/null)" ]
}

echo "[$(stamp)] === OmniFM-Backup startet ==="
[ -n "$NODE_BIN" ] || { echo "[$(stamp)] FEHLER: node nicht gefunden" >&2; exit 1; }

if [ -d "$ROOT/runtime-data" ]; then
  run_step "Runtime-Daten sichern" bash "$ROOT/scripts/backup-runtime-data.sh" create
fi
run_step "MongoDB sichern" bash "$ROOT/scripts/backup-mongodb.sh" create
run_step "Alte Backups ausduennen" "$NODE_BIN" "$ROOT/scripts/rotate-backups.mjs" \
  "$BACKUPS/mongodb" "$BACKUPS/runtime-data"
if [ -n "${OMNIFM_BACKUP_REMOTE:-}" ]; then
  run_step "Kopie ausser Haus ($OMNIFM_BACKUP_REMOTE)" copy_offsite
fi
if restore_check_due; then
  run_step "Wiederherstellungsprobe" "$NODE_BIN" "$ROOT/scripts/verify-mongo-backup.mjs"
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  "$NODE_BIN" "$ROOT/scripts/notify-backup-failed.mjs" "${FAILED[@]}" || true
  echo "[$(stamp)] === Backup mit Fehlern beendet: ${FAILED[*]} ===" >&2
  exit 1
fi
echo "[$(stamp)] === Backup fertig ==="
