#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM — vollautomatisches Start-/Setup-Script (Ubuntu 24.04 / Debian)
#
# Installiert BEIM ERSTEN LAUF alles Nötige und startet dann den kompletten
# Stack (MongoDB, FastAPI-Backend, React-Frontend, Discord-Bot).
#
# Es installiert automatisch (falls nicht vorhanden):
#   - Node.js 22 LTS  (NodeSource)
#   - MongoDB 8.0 Community  (lokal, systemd)
#   - FFmpeg, Python-venv, Build-Tools
#
# Als ERSTES wird ein Owner-Passwort (Admin-Token) erzeugt und angezeigt.
#
# Idempotent: mehrfaches Ausführen ist sicher.
# Nutzung:  ./start.sh
#   Optional:  PUBLIC_URL=https://deine-domain.tld ./start.sh
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/run"
LOG_DIR="$ROOT/logs"
VENV="$ROOT/.venv"
BACKEND_ENV="$ROOT/backend/.env"
FRONTEND_ENV="$ROOT/frontend/.env"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8001}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

DEPLOY_STARTED=0
cleanup_failed_start() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$DEPLOY_STARTED" -eq 1 ]; then
    printf "\033[1;31m[error]\033[0m Start fehlgeschlagen; räume teilweise gestartete Prozesse auf.\n" >&2
    "$ROOT/stop.sh" >/dev/null 2>&1 || true
  fi
  return "$code"
}
trap cleanup_failed_start EXIT

log()  { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; exit 1; }

# --- sudo nur, wenn nicht root -----------------------------------------------
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
if [ -n "$SUDO" ] && ! command -v sudo >/dev/null 2>&1; then
  die "Bitte als root ausführen oder 'sudo' installieren."
fi

gen_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets;print(secrets.token_urlsafe(32))"
  else
    date +%s%N | sha256sum | head -c 48
  fi
}

# =============================================================================
# 1) OWNER-PASSWORT (Admin-Token) — WIRD ZUERST ERZEUGT
# =============================================================================
OWNER_TOKEN=""
if [ -f "$BACKEND_ENV" ]; then
  existing="$(grep -E '^API_ADMIN_TOKEN=' "$BACKEND_ENV" 2>/dev/null | head -n1 | cut -d '=' -f2- || true)"
  case "$existing" in
    ""|"change-me"|"your_"*) OWNER_TOKEN="" ;;
    *) OWNER_TOKEN="$existing" ;;
  esac
fi
NEW_OWNER_TOKEN=0
if [ -z "$OWNER_TOKEN" ]; then
  OWNER_TOKEN="$(gen_token)"
  NEW_OWNER_TOKEN=1
fi

print_owner_box() {
  printf "\n"
  printf "\033[1;32m╔════════════════════════════════════════════════════════════════╗\033[0m\n"
  printf "\033[1;32m║                  OMNIFM  OWNER-ZUGANG                          ║\033[0m\n"
  printf "\033[1;32m╠════════════════════════════════════════════════════════════════╣\033[0m\n"
  printf "\033[1;32m║\033[0m  Owner-Login unter:  \033[1m/admin\033[0m\n"
  printf "\033[1;32m║\033[0m  Owner-Token (Passwort):\n"
  printf "\033[1;32m║\033[0m      \033[1;33m%s\033[0m\n" "$OWNER_TOKEN"
  if [ "$NEW_OWNER_TOKEN" -eq 1 ]; then
    printf "\033[1;32m║\033[0m  \033[0;36m(neu generiert — gespeichert in backend/.env)\033[0m\n"
  else
    printf "\033[1;32m║\033[0m  \033[0;36m(bestehend — aus backend/.env gelesen)\033[0m\n"
  fi
  printf "\033[1;32m╚════════════════════════════════════════════════════════════════╝\033[0m\n\n"
}
print_owner_box

# =============================================================================
# 2) SYSTEM-ABHÄNGIGKEITEN AUTOMATISCH INSTALLIEREN
# =============================================================================
APT_UPDATED=0
apt_update_once() {
  if [ "$APT_UPDATED" -eq 0 ]; then
    log "Aktualisiere Paketquellen (apt update)..."
    $SUDO apt-get update -y >>"$LOG_DIR/setup.log" 2>&1 || warn "apt update meldete Warnungen (siehe logs/setup.log)."
    APT_UPDATED=1
  fi
}

log "Prüfe Basis-Tools..."
if ! command -v curl >/dev/null 2>&1 || ! command -v gpg >/dev/null 2>&1; then
  apt_update_once
  $SUDO apt-get install -y ca-certificates curl gnupg >>"$LOG_DIR/setup.log" 2>&1
fi

# --- Python + Build-Tools + FFmpeg ------------------------------------------
NEED_PKGS=()
command -v python3 >/dev/null 2>&1 || NEED_PKGS+=(python3)
python3 -c "import venv" >/dev/null 2>&1 || NEED_PKGS+=(python3-venv)
command -v pip3 >/dev/null 2>&1 || NEED_PKGS+=(python3-pip)
command -v ffmpeg >/dev/null 2>&1 || NEED_PKGS+=(ffmpeg)
command -v cc >/dev/null 2>&1 || NEED_PKGS+=(build-essential)
if [ "${#NEED_PKGS[@]}" -gt 0 ]; then
  log "Installiere Systempakete: ${NEED_PKGS[*]}"
  apt_update_once
  $SUDO apt-get install -y python3-dev "${NEED_PKGS[@]}" >>"$LOG_DIR/setup.log" 2>&1 \
    || die "Installation der Systempakete fehlgeschlagen (siehe logs/setup.log)."
fi

# --- Node.js 22 LTS ----------------------------------------------------------
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 12 ? 0 : 1)' \
    >/dev/null 2>&1 && NODE_OK=1
fi
if [ "$NODE_OK" -eq 0 ]; then
  log "Installiere Node.js 22 LTS ab 22.12 (NodeSource)..."
  if [ -n "$SUDO" ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - >>"$LOG_DIR/setup.log" 2>&1 \
      || die "NodeSource-Setup fehlgeschlagen (siehe logs/setup.log)."
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >>"$LOG_DIR/setup.log" 2>&1 \
      || die "NodeSource-Setup fehlgeschlagen (siehe logs/setup.log)."
  fi
  $SUDO apt-get install -y nodejs >>"$LOG_DIR/setup.log" 2>&1 \
    || die "Node.js-Installation fehlgeschlagen (siehe logs/setup.log)."
  log "Node.js $(node -v) installiert."
else
  log "Node.js $(node -v) ist vorhanden."
fi

# --- MongoDB 8.0 Community ----------------------------------------------------
if ! command -v mongod >/dev/null 2>&1; then
  log "Installiere MongoDB 8.0 Community..."
  UBU_CODENAME="$( ( . /etc/os-release 2>/dev/null && echo "${UBUNTU_CODENAME:-${VERSION_CODENAME:-noble}}" ) || echo noble)"
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
    | $SUDO gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor --yes >>"$LOG_DIR/setup.log" 2>&1
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${UBU_CODENAME}/mongodb-org/8.0 multiverse" \
    | $SUDO tee /etc/apt/sources.list.d/mongodb-org-8.0.list >/dev/null
  $SUDO apt-get update -y >>"$LOG_DIR/setup.log" 2>&1
  $SUDO apt-get install -y mongodb-org >>"$LOG_DIR/setup.log" 2>&1 \
    || die "MongoDB-Installation fehlgeschlagen (siehe logs/setup.log)."
  log "MongoDB installiert."
fi

# The server itself and the backup/restore tools are separate packages on
# some existing installations. Updates require verified backups, therefore
# make the tools an explicit deployment dependency as well.
if ! command -v mongodump >/dev/null 2>&1 || ! command -v mongorestore >/dev/null 2>&1; then
  log "Installiere MongoDB Database Tools für Backup und Restore..."
  apt_update_once
  $SUDO apt-get install -y mongodb-database-tools >>"$LOG_DIR/setup.log" 2>&1 \
    || die "MongoDB Database Tools konnten nicht installiert werden (siehe logs/setup.log)."
fi

# --- MongoDB starten ---------------------------------------------------------
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^mongod\.service'; then
  log "Starte MongoDB (systemd)..."
  $SUDO systemctl enable mongod >>"$LOG_DIR/setup.log" 2>&1 || true
  $SUDO systemctl start mongod  >>"$LOG_DIR/setup.log" 2>&1 || warn "MongoDB-Start via systemd meldete Fehler (siehe logs/setup.log)."
elif ! pgrep -x mongod >/dev/null 2>&1; then
  log "Starte MongoDB (nohup, /var/lib/mongodb)..."
  $SUDO mkdir -p /var/lib/mongodb
  nohup mongod --dbpath /var/lib/mongodb --bind_ip 127.0.0.1 >"$LOG_DIR/mongod.log" 2>&1 &
  echo $! > "$RUN_DIR/mongod.pid"
  sleep 3
fi

# =============================================================================
# 3) .env-DATEIEN ERZEUGEN / AKTUALISIEREN
# =============================================================================
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$SERVER_IP" ] || SERVER_IP="localhost"

# --- API-URL fürs Frontend bestimmen ---------------------------------------
# Standard: RELATIVE Same-Origin-API ("" => Frontend ruft /api auf derselben
#           Domain auf). Ideal hinter einem Reverse-Proxy (kein Mixed-Content,
#           kein CORS, kein Domain-spezifischer Rebuild nötig).
# PUBLIC_URL=https://domain : absolute Domain (ebenfalls Same-Origin).
# DIRECT_IP=1               : direkter Zugriff ohne Proxy -> http://SERVER_IP:8001
if [ -n "${PUBLIC_URL:-}" ]; then
  FRONTEND_API="$PUBLIC_URL"
  BACKEND_PUBLIC="$PUBLIC_URL"
  FRONTEND_ORIGIN="$PUBLIC_URL"
  log "Modus: öffentliche Domain = ${PUBLIC_URL}"
elif [ "${DIRECT_IP:-0}" = "1" ]; then
  FRONTEND_API="http://${SERVER_IP}:${BACKEND_PORT}"
  BACKEND_PUBLIC="http://${SERVER_IP}:${BACKEND_PORT}"
  FRONTEND_ORIGIN="http://${SERVER_IP}:${FRONTEND_PORT}"
  log "Modus: Direkter IP-Zugriff = ${FRONTEND_API}"
else
  FRONTEND_API=""
  BACKEND_PUBLIC="http://${SERVER_IP}:${BACKEND_PORT}"
  FRONTEND_ORIGIN=""
  log "Modus: Reverse-Proxy (relative Same-Origin-API '/api'). Optional: PUBLIC_URL=https://domain"
fi
CORS_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"
[ -n "$FRONTEND_ORIGIN" ] && CORS_ORIGINS="${FRONTEND_ORIGIN},http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"

set_kv() { # file key value
  local f="$1" k="$2" v="$3"
  if grep -qE "^${k}=" "$f" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$f"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}

if [ ! -f "$BACKEND_ENV" ]; then
  log "Erzeuge backend/.env ..."
  cat > "$BACKEND_ENV" <<EOF
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=radio_bot
API_ADMIN_TOKEN=${OWNER_TOKEN}
PUBLIC_WEB_URL=${BACKEND_PUBLIC}
CORS_ALLOWED_ORIGINS=${CORS_ORIGINS}
CHECKOUT_RETURN_ORIGINS=${CORS_ORIGINS}
DEFAULT_LANGUAGE=en
SEED_DEMO_DATA=0
OMNIFM_DASHBOARD_BACKEND=node
EOF
else
  # Fehlenden/Platzhalter-Token nachtragen, damit Owner-Login funktioniert
  if ! grep -qE '^API_ADMIN_TOKEN=..+' "$BACKEND_ENV" || grep -qE '^API_ADMIN_TOKEN=(change-me|your_)' "$BACKEND_ENV"; then
    set_kv "$BACKEND_ENV" API_ADMIN_TOKEN "$OWNER_TOKEN"
  fi
  # Existing configuration is production data. Never overwrite it during a
  # normal start/update; an explicit Owner/administrator change is required.
  # Only add keys that did not exist in older installations.
  grep -qE '^PUBLIC_WEB_URL=' "$BACKEND_ENV" || set_kv "$BACKEND_ENV" PUBLIC_WEB_URL "$BACKEND_PUBLIC"
  grep -qE '^CORS_ALLOWED_ORIGINS=' "$BACKEND_ENV" || set_kv "$BACKEND_ENV" CORS_ALLOWED_ORIGINS "$CORS_ORIGINS"
  grep -qE '^CHECKOUT_RETURN_ORIGINS=' "$BACKEND_ENV" || set_kv "$BACKEND_ENV" CHECKOUT_RETURN_ORIGINS "$CORS_ORIGINS"
  grep -qE '^SEED_DEMO_DATA=' "$BACKEND_ENV" || set_kv "$BACKEND_ENV" SEED_DEMO_DATA 0
  # #195: the dashboard is answered by the Node API behind FastAPI. Only added
  # when missing; OMNIFM_DASHBOARD_BACKEND=fastapi in backend/.env switches back.
  grep -qE '^OMNIFM_DASHBOARD_BACKEND=' "$BACKEND_ENV" || set_kv "$BACKEND_ENV" OMNIFM_DASHBOARD_BACKEND node
fi

# The frontend's API target is also configuration. Preserve it unless a
# caller explicitly requested a different public URL for this deployment.
if [ -f "$FRONTEND_ENV" ] && [ -n "${PUBLIC_URL:-}" ]; then
  set_kv "$FRONTEND_ENV" REACT_APP_BACKEND_URL "$FRONTEND_API"
elif [ ! -f "$FRONTEND_ENV" ]; then
  log "Erzeuge frontend/.env ..."
  printf 'REACT_APP_BACKEND_URL=%s\n' "$FRONTEND_API" > "$FRONTEND_ENV"
fi


# =============================================================================
# 4) BACKEND (FastAPI)
# =============================================================================
log "Richte Python-Umgebung ein..."
[ -d "$VENV" ] || python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$ROOT/backend/requirements.txt"

# Install and build before stopping the currently running version. A failed
# dependency install or frontend compilation therefore causes no outage.
log "Installiere Frontend-Abhängigkeiten reproduzierbar..."
( cd "$ROOT/frontend" && npm ci --no-audit --no-fund )

log "Baue Frontend..."
( cd "$ROOT/frontend" && npm run build )

log "Installiere Bot-Abhängigkeiten reproduzierbar..."
# --omit=dev: the bot runs without ESLint and the other development tools.
( cd "$ROOT" && npm ci --omit=dev --no-audit --no-fund --engine-strict=true --loglevel=error )

log "Prüfe Backend- und Runtime-Syntax vor dem Umschalten..."
"$VENV/bin/python" -m py_compile "$ROOT/backend/server.py" "$ROOT"/backend/routers/*.py "$ROOT"/backend/services/*.py
( cd "$ROOT" && npm run test:syntax )
( cd "$ROOT" && npm run test:split-syntax )

# MongoDB is often still starting after a reboot. Wait for it instead of
# failing the whole deployment on the first ping (#199).
MONGO_WAIT_SECONDS="${MONGO_WAIT_SECONDS:-60}"
BACKEND_MONGO_URL="$(grep -E '^MONGO_URL=' "$BACKEND_ENV" 2>/dev/null | head -n1 | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' || true)"
BACKEND_MONGO_URL="${BACKEND_MONGO_URL:-mongodb://127.0.0.1:27017}"
log "Warte auf MongoDB (max ${MONGO_WAIT_SECONDS}s)..."
MONGO_READY=0
for _ in $(seq 1 "$MONGO_WAIT_SECONDS"); do
  if MONGO_URL="$BACKEND_MONGO_URL" "$VENV/bin/python" -c 'import os; from pymongo import MongoClient; MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=1500).admin.command("ping")' >/dev/null 2>&1; then
    MONGO_READY=1
    break
  fi
  sleep 1
done
[ "$MONGO_READY" -eq 1 ] || die "MongoDB ist nach ${MONGO_WAIT_SECONDS}s nicht erreichbar (MONGO_URL aus backend/.env); laufende Version bleibt aktiv."
log "MongoDB antwortet."

log "Prüfe FastAPI-Import vor dem Umschalten..."
( cd "$ROOT" && "$VENV/bin/python" -c "import backend.server as app; assert app.mongo_is_reachable(), 'MongoDB nicht erreichbar'" ) \
  || die "FastAPI-Preflight fehlgeschlagen; laufende Version bleibt aktiv."

log "Prüfe DB-gesteuerte Discord-Konfiguration vor dem Umschalten..."
set +e
( cd "$ROOT" && DRY_RUN=1 node src/entrypoints/from-owner-config.mjs >"$LOG_DIR/bot-preflight.log" 2>&1 )
BOT_PREFLIGHT_STATUS=$?
set -e
case "$BOT_PREFLIGHT_STATUS" in
  0) log "Discord-Konfiguration ist startbereit." ;;
  78) warn "Noch kein Commander im Owner-Menü konfiguriert; Web/API werden ohne Bot gestartet." ;;
  *) tail -n 40 "$LOG_DIR/bot-preflight.log" >&2 || true
     die "Discord-Preflight fehlgeschlagen; laufende Version bleibt aktiv." ;;
esac

# =============================================================================
# 4b) PROZESS-MODELL: systemd-Units (Standard) oder nohup (Fallback)
# =============================================================================
# With systemd every component is its own unit with Restart=always: a crashed
# API, website or bot is back within seconds and a reboot brings the stack up
# without rebuilding anything (#201). Without systemd (WSL, containers, dev
# boxes) the previous nohup model stays as the fallback.
USE_SYSTEMD=0
if [ "${OMNIFM_SKIP_SYSTEMD:-0}" != "1" ] && command -v systemctl >/dev/null 2>&1 \
  && [ -d /run/systemd/system ] && [ -d /etc/systemd/system ]; then
  USE_SYSTEMD=1
fi
RUN_USER="$(id -un)"
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
UNIT_DIR="/etc/systemd/system"
UNIT_TEMPLATE_DIR="$ROOT/deploy/systemd"
OMNIFM_UNITS="omnifm-backend omnifm-frontend omnifm-bot"

render_unit() { # unit name without .service
  render_unit_file "$1.service"
}

render_unit_file() { # file name in deploy/systemd, e.g. omnifm-backup.timer
  sed -e "s|__ROOT__|$ROOT|g" \
      -e "s|__USER__|$RUN_USER|g" \
      -e "s|__BACKEND_PORT__|$BACKEND_PORT|g" \
      -e "s|__FRONTEND_PORT__|$FRONTEND_PORT|g" \
      -e "s|__NODE__|$NODE_BIN|g" \
      -e "s|__NODE_DIR__|$NODE_DIR|g" \
      "$UNIT_TEMPLATE_DIR/$1" | $SUDO tee "$UNIT_DIR/$1" >/dev/null
}

install_units() {
  log "Schreibe systemd-Units ($OMNIFM_UNITS)..."
  if [ -f "$UNIT_DIR/omnifm.service" ]; then
    # Oneshot unit of earlier releases: it re-ran start.sh on every boot and
    # supervised nothing. Its ExecStop is never invoked here on purpose.
    $SUDO systemctl disable omnifm.service >>"$LOG_DIR/setup.log" 2>&1 || true
    $SUDO rm -f "$UNIT_DIR/omnifm.service"
  fi
  local unit
  for unit in $OMNIFM_UNITS; do
    render_unit "$unit"
  done
  $SUDO systemctl daemon-reload
  # shellcheck disable=SC2086
  $SUDO systemctl enable $OMNIFM_UNITS >>"$LOG_DIR/setup.log" 2>&1 \
    || warn "systemd enable meldete Warnungen (siehe logs/setup.log)."
}

# The nightly backup (#259) is a timer, not a service to supervise: stop.sh
# leaves it alone, so backups keep running while OmniFM itself is stopped.
install_backup_timer() {
  log "Schreibe Backup-Timer (omnifm-backup.timer, taeglich ca. 04:15)..."
  render_unit_file omnifm-backup.service
  render_unit_file omnifm-backup.timer
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now omnifm-backup.timer >>"$LOG_DIR/setup.log" 2>&1     || warn "Backup-Timer konnte nicht aktiviert werden (siehe logs/setup.log)."
}

unit_active() {
  systemctl is-active --quiet "$1" 2>/dev/null
}

log "Stoppe bestehende OmniFM-Prozesse unmittelbar vor dem Neustart..."
"$ROOT/stop.sh" || true
DEPLOY_STARTED=1

# #227: runtime files belong in runtime-data/ (in the update backup), not
# between the code. Moved once, while every OmniFM process is stopped; the
# script archives them to .update-backups/runtime-root/ first.
export OMNIFM_RUNTIME_DATA_DIR="$ROOT/runtime-data"
export LOGS_DIR="$LOG_DIR"
mkdir -p "$OMNIFM_RUNTIME_DATA_DIR"
MIGRATION_OUTPUT="$(bash "$ROOT/scripts/migrate-runtime-data.sh" "$ROOT")" \
  || die "Laufzeitdateien konnten nicht nach runtime-data/ umziehen. Nichts wurde verschoben; Details oben."
if [ -n "$MIGRATION_OUTPUT" ]; then
  log "Laufzeitdateien ziehen nach runtime-data/ um:"
  printf '%s\n' "$MIGRATION_OUTPUT" | sed 's/^/  /'
fi

port_is_open() {
  "$VENV/bin/python" -c 'import socket,sys; s=socket.socket(); s.settimeout(.4); rc=s.connect_ex(("127.0.0.1", int(sys.argv[1]))); s.close(); raise SystemExit(0 if rc == 0 else 1)' "$1"
}

for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if port_is_open "$port"; then
    die "Port $port ist nach stop.sh weiterhin belegt. Start abgebrochen, damit kein alter oder fremder Prozess als neue Version ausgegeben wird."
  fi
done

wait_for_http() {
  local name="$1" url="$2" log_file="$3"
  for _ in {1..30}; do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      log "$name ist bereit: $url"
      return 0
    fi
    sleep 1
  done
  tail -n 80 "$log_file" >&2 || true
  die "$name wurde nicht bereit. Details: $log_file"
}

backend_alive() {
  if [ "$USE_SYSTEMD" -eq 1 ]; then
    unit_active omnifm-backend
    return $?
  fi
  local pid
  pid="$(cat "$RUN_DIR/backend.pid" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

wait_for_backend_contract() {
  local url="http://127.0.0.1:${BACKEND_PORT}/api/health" body
  for _ in {1..30}; do
    if ! backend_alive; then
      tail -n 80 "$LOG_DIR/backend.log" >&2 || true
      die "FastAPI-Backend ist beim Start beendet worden."
    fi
    body="$(curl --fail --silent --show-error --max-time 2 "$url" 2>/dev/null || true)"
    if [ -n "$body" ] && printf '%s' "$body" | "$VENV/bin/python" -c 'import json,sys; data=json.load(sys.stdin); raise SystemExit(0 if data.get("contractVersion") == "owner-live-v5" else 1)' 2>/dev/null; then
      log "FastAPI-Backend ist bereit und API-Vertrag owner-live-v5 ist aktiv: $url"
      return 0
    fi
    sleep 1
  done
  tail -n 80 "$LOG_DIR/backend.log" >&2 || true
  die "FastAPI-Backend liefert nicht den erwarteten API-Vertrag owner-live-v5. Ein alter Prozess oder ein fehlerhaftes Deployment ist aktiv."
}

if [ "$USE_SYSTEMD" -eq 1 ]; then
  # ===========================================================================
  # 5) DIENSTE UNTER SYSTEMD
  # ===========================================================================
  install_units
  install_backup_timer

  log "Starte Backend (omnifm-backend) auf Port $BACKEND_PORT..."
  $SUDO systemctl restart omnifm-backend
  wait_for_backend_contract

  log "Starte Frontend (omnifm-frontend) auf Port $FRONTEND_PORT..."
  $SUDO systemctl restart omnifm-frontend
  wait_for_http "React-Frontend" "http://127.0.0.1:${FRONTEND_PORT}/" "$LOG_DIR/frontend.log"

  if [ "$BOT_PREFLIGHT_STATUS" -eq 0 ]; then
    log "Starte Discord-Bot (omnifm-bot) aus Owner-Menü-Konfiguration..."
    $SUDO systemctl restart omnifm-bot
    sleep 3
    if unit_active omnifm-bot; then
      log "Discord-Bot läuft (systemd: omnifm-bot)."
    else
      tail -n 40 "$LOG_DIR/bot-console.log" >&2 || true
      warn "Discord-Bot ist nach dem Start nicht aktiv. Details: journalctl -u omnifm-bot -n 50 und logs/bot-console.log"
    fi
  else
    $SUDO systemctl stop omnifm-bot >/dev/null 2>&1 || true
    warn "Discord-Bot nicht gestartet – noch kein Commander-Token hinterlegt."
    warn "Trage Tokens unter /admin → 'Discord & Bots' ein und führe ./update.sh (oder ./start.sh) erneut aus."
  fi
  log "Dienste werden von systemd überwacht: systemctl status $OMNIFM_UNITS"
else
  # ===========================================================================
  # 5) PROZESSE OHNE SYSTEMD (nohup, PIDs unter run/)
  # ===========================================================================
  warn "Kein systemd verfügbar (oder OMNIFM_SKIP_SYSTEMD=1): Prozesse laufen ohne Neustart-Überwachung."

  log "Starte Backend auf Port $BACKEND_PORT..."
  ( cd "$ROOT/backend" && nohup "$VENV/bin/uvicorn" server:app --host 0.0.0.0 --port "$BACKEND_PORT" --workers 1 \
    >"$LOG_DIR/backend.log" 2>&1 & echo $! > "$RUN_DIR/backend.pid" )
  wait_for_backend_contract

  log "Serviere Frontend auf Port $FRONTEND_PORT..."
  ( cd "$ROOT/frontend" && nohup ./node_modules/.bin/serve build --config ../serve.json -l "tcp://0.0.0.0:${FRONTEND_PORT}" \
    >"$LOG_DIR/frontend.log" 2>&1 & echo $! > "$RUN_DIR/frontend.pid" )
  wait_for_http "React-Frontend" "http://127.0.0.1:${FRONTEND_PORT}/" "$LOG_DIR/frontend.log"

  if [ "$BOT_PREFLIGHT_STATUS" -eq 0 ]; then
    log "Starte Discord-Bot aus Owner-Menü-Konfiguration..."
    ( cd "$ROOT" && nohup node src/entrypoints/from-owner-config.mjs >"$LOG_DIR/bot-console.log" 2>&1 & echo $! > "$RUN_DIR/bot.pid" )
    sleep 3
    BOT_PID="$(cat "$RUN_DIR/bot.pid" 2>/dev/null)"
    if [ -n "$BOT_PID" ] && kill -0 "$BOT_PID" 2>/dev/null; then
      log "Discord-Bot läuft (PID $BOT_PID)."
    else
      rm -f "$RUN_DIR/bot.pid"
      tail -n 40 "$LOG_DIR/bot-console.log" >&2 || true
      warn "Discord-Bot ist nach dem Start nicht aktiv. Details: logs/bot-console.log"
    fi
  else
    warn "Discord-Bot nicht gestartet – noch kein Commander-Token hinterlegt."
    warn "Trage Tokens unter /admin → 'Discord & Bots' ein und führe ./update.sh (oder ./start.sh) erneut aus."
  fi
fi


# =============================================================================
# FERTIG
# =============================================================================
WEB_INFO="${PUBLIC_URL:-http://${SERVER_IP}:${FRONTEND_PORT}}"
log "Fertig. Web: ${WEB_INFO}  |  Backend intern: http://127.0.0.1:${BACKEND_PORT}  |  API: ${FRONTEND_API:-/api (relativ)}"
if [ "$USE_SYSTEMD" -eq 1 ]; then
  log "Logs: $LOG_DIR (und journalctl -u omnifm-bot)   Status: ./update.sh --status quick   Stoppen: ./stop.sh"
else
  log "Logs: $LOG_DIR   Stoppen mit: ./stop.sh"
fi
print_owner_box
trap - EXIT
