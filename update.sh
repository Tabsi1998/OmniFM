#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM — update script. Pulls the latest code, updates dependencies and
# restarts the stack. Run this on your server after a deploy.
# Usage:  ./update.sh | ./update.sh --doctor
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# LAST_STEP names the step an aborted update stopped in; the operator alert
# (#316) carries it.
LAST_STEP=""
log() { LAST_STEP="$*"; printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }
die() { LAST_STEP="$*"; printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; exit 1; }

doctor() {
  local failed=0
  log "Prüfe Deployment-Konfiguration (ohne Änderungen)..."
  [ -f "$ROOT/backend/.env" ] || { log "FEHLT: backend/.env"; failed=1; }
  [ -f "$ROOT/frontend/.env" ] || { log "FEHLT: frontend/.env"; failed=1; }
  command -v python3 >/dev/null 2>&1 || { log "FEHLT: python3"; failed=1; }
  command -v node >/dev/null 2>&1 || { log "FEHLT: node"; failed=1; }
  command -v npm >/dev/null 2>&1 || { log "FEHLT: npm"; failed=1; }
  command -v curl >/dev/null 2>&1 || { log "FEHLT: curl"; failed=1; }
  command -v tar >/dev/null 2>&1 || { log "FEHLT: tar"; failed=1; }
  command -v gzip >/dev/null 2>&1 || { log "FEHLT: gzip"; failed=1; }
  command -v mongodump >/dev/null 2>&1 || { log "FEHLT: mongodump (mongodb-database-tools)"; failed=1; }
  command -v mongorestore >/dev/null 2>&1 || { log "FEHLT: mongorestore (mongodb-database-tools)"; failed=1; }
  if command -v node >/dev/null 2>&1; then
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 12 ? 0 : 1)' \
      >/dev/null 2>&1 \
      || { log "FALSCH: Node.js 22.12 oder neuer ist erforderlich (gefunden: $(node -v 2>/dev/null || echo unbekannt))"; failed=1; }
  fi
  if [ -f "$ROOT/backend/.env" ]; then
    grep -qE '^MONGO_URL=..+' "$ROOT/backend/.env" || { log "FEHLT: MONGO_URL in backend/.env"; failed=1; }
    grep -qE '^DB_NAME=..+' "$ROOT/backend/.env" || { log "FEHLT: DB_NAME in backend/.env"; failed=1; }
    grep -qE '^API_ADMIN_TOKEN=..+' "$ROOT/backend/.env" || { log "FEHLT: API_ADMIN_TOKEN in backend/.env"; failed=1; }
  fi
  [ "$failed" -eq 0 ] || die "Konfigurationsprüfung fehlgeschlagen. Es wurde nichts verändert."
  log "Konfiguration ist deploy-fähig. Es wurde nichts verändert."
}

BACKEND_PORT_VALUE="${BACKEND_PORT:-8001}"
VENV_PY="$ROOT/.venv/bin/python"

has_systemd() {
  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

mongo_url_from_env() {
  grep -E '^MONGO_URL=' "$ROOT/backend/.env" 2>/dev/null | head -n1 | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//'
}

mongo_ping() {
  local url
  url="$(mongo_url_from_env)"
  url="${url:-mongodb://127.0.0.1:27017}"
  if [ ! -x "$VENV_PY" ]; then
    printf 'MongoDB-Ping nicht moeglich: Python-venv fehlt (./start.sh ausfuehren).\n'
    return 1
  fi
  MONGO_URL="$url" "$VENV_PY" -c 'import os
from pymongo import MongoClient
url = os.environ["MONGO_URL"]
client = MongoClient(url, serverSelectionTimeoutMS=1500)
client.admin.command("ping")
host = url.split("@")[-1]
print(f"MongoDB antwortet ({host})")
for name in sorted(client.list_database_names()):
    if name in ("admin", "config", "local"):
        continue
    db = client[name]
    print(f"  {name}: {len(db.list_collection_names())} Collections")'
}

service_lines() {
  if has_systemd; then
    local unit
    for unit in omnifm-backend omnifm-frontend omnifm-bot; do
      printf '%-17s %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || echo unbekannt)"
    done
  else
    local name pid
    for name in backend frontend bot; do
      pid="$(cat "$ROOT/run/$name.pid" 2>/dev/null || true)"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        printf '%-17s laeuft (PID %s)\n' "$name" "$pid"
      else
        printf '%-17s gestoppt\n' "$name"
      fi
    done
  fi
}

api_health() {
  curl --silent --max-time 3 "http://127.0.0.1:${BACKEND_PORT_VALUE}/api/health" || printf 'API antwortet nicht auf Port %s' "$BACKEND_PORT_VALUE"
  printf '\n'
}

status_report() {
  local topic="${1:-quick}" file
  case "$topic" in
    quick)
      echo "== OmniFM Status =="
      echo "Code-Stand: $(git -C "$ROOT" log -1 --pretty='%h %s' 2>/dev/null | head -c 100 || echo unbekannt)"
      echo "-- Dienste --"
      service_lines
      echo "-- MongoDB --"
      mongo_ping || true
      echo "-- API --"
      api_health
      echo "-- Speicher --"
      df -h "$ROOT" | tail -n 1
      ;;
    health)
      api_health
      ;;
    local-logs)
      for file in bot.log error.log bot-console.log backend.log frontend.log; do
        [ -f "$ROOT/logs/$file" ] || continue
        echo "== logs/$file (letzte 40 Zeilen) =="
        tail -n 40 "$ROOT/logs/$file"
        echo
      done
      ;;
    mongo)
      mongo_ping
      ;;
    storage)
      echo "== Speicher =="
      du -sh "$ROOT/runtime-data" "$ROOT/logs" "$ROOT/.update-backups" "$ROOT/node_modules" "$ROOT/frontend/node_modules" "$ROOT/frontend/build" 2>/dev/null || true
      df -h "$ROOT" | tail -n 1
      leftovers="$(bash "$ROOT/scripts/migrate-runtime-data.sh" --list "$ROOT" 2>/dev/null || true)"
      if [ -n "$leftovers" ]; then
        echo
        echo "WARNUNG: Laufzeitdateien liegen noch im Repo-Wurzelverzeichnis (#227)."
        echo "Sie sind in keinem Update-Backup. ./start.sh verschiebt sie nach runtime-data/:"
        printf '%s\n' "$leftovers" | sed 's/^/  /'
      fi
      ;;
    backup)
      backup_report
      ;;
    *)
      die "Unbekanntes Status-Thema: $topic (quick, health, local-logs, mongo, storage, backup)"
      ;;
  esac
}

# Newest archive per kind with age and size, the timer and the last restore
# check (#259). Older than 36 hours means a night was missed.
backup_report() {
  local kind newest age_h count size marker
  echo "== Backups (.update-backups) =="
  for kind in mongodb runtime-data; do
    newest="$(find "$ROOT/.update-backups/$kind" -maxdepth 1 -type f -name '*.gz' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
    if [ -z "$newest" ]; then
      echo "$kind: noch kein Backup"
      continue
    fi
    age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
    count="$(find "$ROOT/.update-backups/$kind" -maxdepth 1 -type f -name '*.gz' | wc -l)"
    size="$(du -sh "$ROOT/.update-backups/$kind" 2>/dev/null | cut -f1)"
    echo "$kind: neuestes $(basename "$newest") vor ${age_h} h; ${count} Staende, ${size} insgesamt"
    if [ "$age_h" -gt 36 ]; then
      echo "  WARNUNG: aelter als 36 Stunden - laeuft der Backup-Timer?"
    fi
  done
  echo "-- Timer --"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl list-timers omnifm-backup.timer --no-pager 2>/dev/null | head -n 2 || true
    systemctl show omnifm-backup.service -p Result -p ExecMainExitTimestamp --no-pager 2>/dev/null || true
  else
    echo "systemd nicht verfuegbar"
  fi
  echo "-- Letzte Wiederherstellungsprobe --"
  marker="$ROOT/.update-backups/mongodb/.last-restore-check.json"
  if [ -f "$marker" ]; then
    cat "$marker"
  else
    echo "noch keine (laeuft beim naechsten naechtlichen Backup)"
  fi
  echo "Protokoll: logs/backup.log"
}

show_bots() {
  # DRY_RUN prints the resolved commander/worker list with token lengths only.
  ( cd "$ROOT" && DRY_RUN=1 node src/entrypoints/from-owner-config.mjs ) || true
}

cleanup_logs() {
  local mode="${1:-dry-run}" days="${OMNIFM_CLEANUP_LOG_DAYS:-14}" found=0 file
  case "$mode" in dry-run|run) ;; *) die "Unbekannter Cleanup-Modus: $mode (dry-run, run)" ;; esac
  echo "== Cleanup ($mode): rotierte Logs aelter als ${days} Tage =="
  while IFS= read -r file; do
    found=1
    if [ "$mode" = "run" ]; then
      rm -f -- "$file" && echo "geloescht: $file"
    else
      echo "wuerde loeschen: $file"
    fi
  done < <(find "$ROOT/logs" -type f \( -name 'bot-*.log' -o -name 'error-*.log' \) -mtime "+$days" 2>/dev/null | sort)
  [ "$found" -eq 1 ] || echo "Nichts zu bereinigen."
  echo "MongoDB- und Runtime-Backups duennt der naechtliche Backup-Timer aus (14 Tage, 8 Wochen, 6 Monate):"
  du -sh "$ROOT/.update-backups" 2>/dev/null || echo "  (keine Backups vorhanden)"
}

USAGE="Nutzung: ./update.sh | --doctor | --status [quick|health|local-logs|mongo|storage|backup] | --show-bots | --cleanup [dry-run|run]"
case "${1:-}" in
  --doctor)
    [ "$#" -eq 1 ] || die "--doctor akzeptiert keine weiteren Argumente."
    doctor
    exit 0
    ;;
  --status)
    status_report "${2:-quick}"
    exit 0
    ;;
  --show-bots|--show-roles)
    show_bots
    exit 0
    ;;
  --cleanup)
    cleanup_logs "${2:-dry-run}"
    exit 0
    ;;
  "")
    ;;
  *)
    die "Unbekannte Argumente. $USAGE"
    ;;
esac

# From here on this is a real update: every way out - die, a failing command
# under set -e, Ctrl+C - ends in exactly one operator alert (#316).
OLD_REV="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unbekannt)"
UPDATE_ALERT_SENT=0
notify_update() { # ok|failed, detail
  local new_rev
  UPDATE_ALERT_SENT=1
  command -v node >/dev/null 2>&1 || return 0
  [ -f "$ROOT/scripts/notify-operator.mjs" ] || return 0
  new_rev="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unbekannt)"
  timeout 30 node "$ROOT/scripts/notify-operator.mjs" "update-$1" "$OLD_REV" "$new_rev" "${2:-}" \
    >/dev/null 2>&1 || true
}
on_update_exit() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$UPDATE_ALERT_SENT" -eq 0 ]; then
    notify_update failed "${LAST_STEP:-unbekannt} (Exit-Code $status)"
  fi
}
trap on_update_exit EXIT

BACKUP_DIR="$ROOT/.update-backups/config/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
for config_file in backend/.env frontend/.env; do
  if [ -f "$ROOT/$config_file" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$config_file")"
    cp -p "$ROOT/$config_file" "$BACKUP_DIR/$config_file"
  fi
done
log "Konfigurations-Backup: $BACKUP_DIR"

# Runtime fallback files and MongoDB are production data. Create both
# snapshots before touching Git or dependencies. A failed database backup is a
# hard stop: the still-running version remains online and no pull has happened.
if [ -d "$ROOT/runtime-data" ]; then
  log "Sichere Runtime-Daten vor dem Update..."
  bash "$ROOT/scripts/backup-runtime-data.sh" create \
    || die "Runtime-Daten konnten nicht gesichert werden. Update wurde vor dem Pull abgebrochen."
else
  log "Keine Runtime-Daten vorhanden; Datei-Backup wird übersprungen."
fi

if [ -f "$ROOT/backend/.env" ]; then
  log "Sichere MongoDB vor dem Update..."
  bash "$ROOT/scripts/backup-mongodb.sh" create \
    || die "MongoDB konnte nicht gesichert werden. Update wurde vor dem Pull abgebrochen."
else
  die "backend/.env fehlt; MongoDB-Backup und Update wurden abgebrochen."
fi

if [ -d .git ]; then
  # Releases before f38b631 used `npm install` during deployment. Depending on
  # the npm version this could rewrite tracked lockfiles and permanently block
  # the next fast-forward pull. Lockfiles are generated deployment artifacts,
  # never runtime configuration: back up their exact diff, then restore only
  # those known files. Any other tracked local change remains a hard stop.
  LOCK_DIFF_DIR="$BACKUP_DIR/local-lockfile-diffs"
  for lock_file in package-lock.json frontend/package-lock.json; do
    if [ -f "$ROOT/$lock_file" ] && ! git diff --quiet HEAD -- "$lock_file"; then
      mkdir -p "$LOCK_DIFF_DIR/$(dirname "$lock_file")"
      git diff --binary HEAD -- "$lock_file" > "$LOCK_DIFF_DIR/$lock_file.patch"
      git restore --source=HEAD --staged --worktree -- "$lock_file" \
        || die "Automatisch erzeugte Änderung an $lock_file konnte nicht zurückgesetzt werden."
      log "Legacy-Änderung an $lock_file gesichert und bereinigt."
    fi
  done

  if ! git diff --quiet HEAD --; then
    git status --short >&2
    die "Andere lokale Git-Änderungen erkannt. Dienste bleiben unverändert; Änderungen zuerst committen oder sichern."
  fi

  log "Hole neuesten Stand (git pull)..."
  git pull --ff-only || die "git pull fehlgeschlagen. Dienste und Konfiguration wurden nicht verändert."
  log "Code-Stand: $(git log -1 --pretty='%h — %s' 2>/dev/null | head -c 120 || echo 'unbekannt')"
else
  log "Kein Git-Repository – überspringe git pull."
fi

log "Bereite Update vor und starte Frontend, FastAPI und Discord-Runtime gemeinsam neu..."
./start.sh

bot_running() {
  if has_systemd && systemctl list-unit-files omnifm-bot.service 2>/dev/null | grep -q '^omnifm-bot.service'; then
    systemctl is-active --quiet omnifm-bot
    return $?
  fi
  [ -f "$ROOT/run/bot.pid" ] && kill -0 "$(cat "$ROOT/run/bot.pid" 2>/dev/null)" 2>/dev/null
}

if bot_running; then
  log "Discord-Bot läuft mit diesem Code-Stand. Prüfen: /help in Discord zeigt unten im Footer die Version."
  UPDATE_NOTE="Discord-Bot läuft."
else
  log "ACHTUNG: Discord-Bot läuft NICHT (Commander-Token unter /admin → Discord & Bots eintragen, dann ./start.sh)."
  log "Ohne laufenden Bot ändern sich Discord-Embeds NICHT — alte Nachrichten bleiben alt."
  UPDATE_NOTE="ACHTUNG: Discord-Bot läuft NICHT."
fi

log "Update abgeschlossen."
notify_update ok "$UPDATE_NOTE"
