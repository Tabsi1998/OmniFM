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
#   - Yarn
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
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null && NODE_OK=1
fi
if [ "$NODE_OK" -eq 0 ]; then
  log "Installiere Node.js 22 LTS (NodeSource)..."
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

# --- Yarn --------------------------------------------------------------------
if ! command -v yarn >/dev/null 2>&1; then
  log "Installiere Yarn..."
  $SUDO npm install -g yarn >>"$LOG_DIR/setup.log" 2>&1 || die "Yarn-Installation fehlgeschlagen."
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
# 3) .env-DATEIEN ERZEUGEN (falls fehlend)
# =============================================================================
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$SERVER_IP" ] || SERVER_IP="localhost"
BACKEND_URL="${PUBLIC_URL:-http://${SERVER_IP}:${BACKEND_PORT}}"
FRONTEND_ORIGIN="http://${SERVER_IP}:${FRONTEND_PORT}"

if [ ! -f "$BACKEND_ENV" ]; then
  log "Erzeuge backend/.env ..."
  cat > "$BACKEND_ENV" <<EOF
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=radio_bot
API_ADMIN_TOKEN=${OWNER_TOKEN}
PUBLIC_WEB_URL=${BACKEND_URL}
CORS_ALLOWED_ORIGINS=${FRONTEND_ORIGIN},http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}
CHECKOUT_RETURN_ORIGINS=${FRONTEND_ORIGIN},http://localhost:${FRONTEND_PORT}
DEFAULT_LANGUAGE=en
EOF
else
  # Fehlenden/Platzhalter-Token nachtragen, damit Owner-Login funktioniert
  if ! grep -qE '^API_ADMIN_TOKEN=..+' "$BACKEND_ENV" || grep -qE '^API_ADMIN_TOKEN=(change-me|your_)' "$BACKEND_ENV"; then
    if grep -qE '^API_ADMIN_TOKEN=' "$BACKEND_ENV"; then
      sed -i "s|^API_ADMIN_TOKEN=.*|API_ADMIN_TOKEN=${OWNER_TOKEN}|" "$BACKEND_ENV"
    else
      printf "\nAPI_ADMIN_TOKEN=%s\n" "$OWNER_TOKEN" >> "$BACKEND_ENV"
    fi
  fi
fi

if [ ! -f "$FRONTEND_ENV" ]; then
  log "Erzeuge frontend/.env ..."
  cat > "$FRONTEND_ENV" <<EOF
REACT_APP_BACKEND_URL=${BACKEND_URL}
EOF
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

log "Starte Backend auf Port $BACKEND_PORT..."
( cd "$ROOT/backend" && nohup "$VENV/bin/uvicorn" server:app --host 0.0.0.0 --port "$BACKEND_PORT" --workers 1 \
  >"$LOG_DIR/backend.log" 2>&1 & echo $! > "$RUN_DIR/backend.pid" )

# =============================================================================
# 5) FRONTEND (React)
# =============================================================================
log "Installiere Frontend-Abhängigkeiten..."
( cd "$ROOT/frontend" && yarn install --frozen-lockfile 2>/dev/null || yarn install )

log "Baue Frontend..."
( cd "$ROOT/frontend" && yarn build )

log "Serviere Frontend auf Port $FRONTEND_PORT..."
( cd "$ROOT/frontend" && nohup npx --yes serve -s build -l "$FRONTEND_PORT" \
  >"$LOG_DIR/frontend.log" 2>&1 & echo $! > "$RUN_DIR/frontend.pid" )

# =============================================================================
# 6) DISCORD-BOT (DB-gesteuert, optional)
# =============================================================================
if [ -f "$ROOT/package.json" ]; then
  log "Installiere Bot-Abhängigkeiten (Node)..."
  ( cd "$ROOT" && npm install --no-audit --no-fund --engine-strict=false --loglevel=error ) \
    || warn "Bot-Abhängigkeiten konnten nicht installiert werden."
  log "Starte Discord-Bot aus Owner-Menü-Konfiguration..."
  ( cd "$ROOT" && nohup node src/entrypoints/from-owner-config.mjs >"$LOG_DIR/bot.log" 2>&1 & echo $! > "$RUN_DIR/bot.pid" )
  sleep 3
  BOT_PID="$(cat "$RUN_DIR/bot.pid" 2>/dev/null)"
  if [ -n "$BOT_PID" ] && kill -0 "$BOT_PID" 2>/dev/null; then
    log "Discord-Bot läuft (PID $BOT_PID)."
  else
    rm -f "$RUN_DIR/bot.pid"
    warn "Discord-Bot nicht gestartet – vermutlich noch kein Commander-Token hinterlegt."
    warn "Trage Tokens unter /admin → 'Discord & Bots' ein und führe ./update.sh (oder ./start.sh) erneut aus."
  fi
fi

# =============================================================================
# 7) SYSTEMD-AUTOSTART (nach Server-Neustart automatisch hochfahren)
# =============================================================================
if command -v systemctl >/dev/null 2>&1 && [ "${OMNIFM_SKIP_SYSTEMD:-0}" != "1" ]; then
  UNIT_FILE="/etc/systemd/system/omnifm.service"
  RUN_USER="$(id -un)"
  if [ ! -f "$UNIT_FILE" ]; then
    log "Richte systemd-Autostart ein (omnifm.service)..."
    $SUDO tee "$UNIT_FILE" >/dev/null <<UNIT
[Unit]
Description=OmniFM Full Stack (Website, API, Discord-Bot)
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${ROOT}
Environment=OMNIFM_SKIP_SYSTEMD=1
ExecStart=${ROOT}/start.sh
ExecStop=${ROOT}/stop.sh
User=${RUN_USER}
TimeoutStartSec=900

[Install]
WantedBy=multi-user.target
UNIT
    $SUDO systemctl daemon-reload >>"$LOG_DIR/setup.log" 2>&1 || true
    $SUDO systemctl enable omnifm.service >>"$LOG_DIR/setup.log" 2>&1 \
      && log "Autostart aktiv: OmniFM startet nach jedem Server-Neustart automatisch." \
      || warn "systemd-Autostart konnte nicht aktiviert werden (siehe logs/setup.log)."
  else
    log "systemd-Autostart bereits eingerichtet (omnifm.service)."
  fi
fi


# =============================================================================
# FERTIG
# =============================================================================
log "Fertig. Backend: ${BACKEND_URL}  |  Frontend: ${FRONTEND_ORIGIN}"
log "Logs: $LOG_DIR   Stoppen mit: ./stop.sh"
print_owner_box
