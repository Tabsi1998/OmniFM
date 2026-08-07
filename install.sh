#!/usr/bin/env bash
set -uo pipefail
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# shellcheck source=/dev/null
source "$APP_DIR/scripts/runtime-compose.sh"
refresh_omnifm_compose_env "$APP_DIR"

report_runtime_tools_status() {
  refresh_omnifm_compose_env "$APP_DIR"
  if ! docker compose ps --services --filter status=running 2>/dev/null | grep -q "^omnifm$"; then
    return 0
  fi

  if docker compose exec -T omnifm sh -lc 'command -v ffmpeg >/dev/null 2>&1' >/dev/null 2>&1; then
    ok "Container-Tooling: ffmpeg verfuegbar."
  else
    warn "Container-Tooling: ffmpeg fehlt."
  fi

  if docker compose exec -T omnifm sh -lc 'command -v fpcalc >/dev/null 2>&1' >/dev/null 2>&1; then
    ok "Container-Tooling: fpcalc/Chromaprint verfuegbar."
  else
    warn "Container-Tooling: fpcalc/Chromaprint fehlt."
  fi
}

compose_up_with_build() {
  refresh_omnifm_compose_env "$APP_DIR"
  prepare_omnifm_runtime_data "$APP_DIR"
  info "$(compose_deployment_summary "$APP_DIR")"
  if docker compose up -d --build --remove-orphans; then
    report_runtime_tools_status
    return 0
  fi
  fail "Docker Compose Build/Start fehlgeschlagen."
  return 1
}

prompt_nonempty() {
  local label="$1"
  local val=""
  while [[ -z "$val" ]]; do
    read -r -p "$(echo -e "${CYAN}?${NC} ${BOLD}${label}${NC}: ")" val
    val="${val//$'\r'/}"
    val="${val//$'\n'/}"
    val="${val//$'\t'/}"
    if [[ -z "$val" ]]; then
      echo -e "  ${RED}Dieses Feld ist erforderlich.${NC}"
    fi
  done
  printf "%s" "$val"
}

prompt_default() {
  local label="$1"
  local def="$2"
  local val
  read -r -p "$(echo -e "${CYAN}?${NC} ${BOLD}${label}${NC} ${DIM}[${def}]${NC}: ")" val
  val="${val//$'\r'/}"
  val="${val//$'\n'/}"
  val="${val//$'\t'/}"
  if [[ -z "$val" ]]; then
    printf "%s" "$def"
  else
    printf "%s" "$val"
  fi
}

prompt_int_range() {
  local label="$1"
  local def="$2"
  local min="$3"
  local max="$4"
  local val
  while true; do
    val="$(prompt_default "$label" "$def")"
    if [[ "$val" =~ ^[0-9]+$ ]] && (( val >= min && val <= max )); then
      printf "%s" "$val"
      return
    fi
    echo -e "  ${RED}Bitte Zahl zwischen $min und $max eingeben.${NC}"
  done
}

prompt_yes_no() {
  local label="$1"
  local def="${2:-j}"
  local val
  read -r -p "$(echo -e "${CYAN}?${NC} ${BOLD}${label}${NC} ${DIM}[${def}]${NC}: ")" val
  val="${val,,}"
  if [[ -z "$val" ]]; then
    val="$def"
  fi
  [[ "$val" == "y" || "$val" == "yes" || "$val" == "j" || "$val" == "ja" ]]
}

write_env_line() {
  local key="$1"
  local value="$2"
  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

validate_token() {
  local token="$1"
  if [[ ${#token} -lt 50 ]]; then
    return 1
  fi
  if [[ ! "$token" =~ \. ]]; then
    return 1
  fi
  return 0
}

validate_client_id() {
  local cid="$1"
  if [[ ! "$cid" =~ ^[0-9]{17,22}$ ]]; then
    return 1
  fi
  return 0
}

clear
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║                                           ║"
echo "  ║    OmniFM - Installer v4.0                 ║"
echo "  ║    Zero-Lag Audio + Premium System         ║"
echo "  ║                                           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

ensure_sudo() {
  if [[ $EUID -eq 0 ]]; then
    SUDO=""
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    fail "sudo fehlt. Bitte als root ausfuehren."
    exit 1
  fi
}

install_docker() {
  info "Installiere Docker..."
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq ca-certificates curl gnupg
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  local arch
  arch="$(dpkg --print-architecture)"
  echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
  ok "Docker installiert."
}

ensure_sudo

# ====================================
# Step 1: Docker pruefen
# ====================================
echo -e "${BOLD}Schritt 1/6: Docker pruefen${NC}"
echo "─────────────────────────────────────"

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker nicht gefunden."
  if prompt_yes_no "Docker jetzt automatisch installieren?" "j"; then
    install_docker
  else
    fail "Docker wird benoetigt. Bitte manuell installieren."
    exit 1
  fi
else
  ok "Docker gefunden: $(docker --version | head -1)"
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose Plugin fehlt."
  echo "  Installiere es mit: sudo apt-get install docker-compose-plugin"
  exit 1
fi
ok "Docker Compose verfuegbar."

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="$SUDO docker"
fi

echo ""

# ====================================
# Step 2: Bestehende .env pruefen
# ====================================
echo -e "${BOLD}Schritt 2/6: Bot-Konfiguration${NC}"
echo "─────────────────────────────────────"

existing_bots=0
if [[ -f .env ]]; then
  # Count existing bots
  while true; do
    local_n=$((existing_bots + 1))
    if grep -q "^BOT_${local_n}_TOKEN=" .env 2>/dev/null; then
      existing_bots=$local_n
    else
      break
    fi
  done
fi

if [[ $existing_bots -gt 0 ]]; then
  ok "Bestehende Konfiguration gefunden ($existing_bots Bots)."
  if prompt_yes_no "Bestehende .env beibehalten und erweitern?" "j"; then
    echo ""
    if prompt_yes_no "Weitere Bots hinzufuegen?" "n"; then
      add_count="$(prompt_int_range "Wie viele neue Bots hinzufuegen" "1" 1 16)"
      for ((i=1; i<=add_count; i++)); do
        idx=$((existing_bots + i))
        echo ""
        echo -e "${YELLOW}--- Neuer Bot $idx ---${NC}"
        name="$(prompt_default "Name" "OmniFM Bot $idx")"
        while true; do
          token="$(prompt_nonempty "Token")"
          if validate_token "$token"; then break; fi
          echo -e "  ${RED}Token sieht ungueltig aus (mind. 50 Zeichen mit Punkt). Bitte pruefen.${NC}"
        done
        while true; do
          client_id="$(prompt_nonempty "Client ID")"
          if validate_client_id "$client_id"; then break; fi
          echo -e "  ${RED}Client ID muss 17-22 Ziffern sein. Bitte pruefen.${NC}"
        done
        perms="$(prompt_default "Permissions" "35186522836032")"
        echo ""
        echo -e "  ${DIM}Bot-Tier bestimmt ob dieser Bot frei oder Premium ist:${NC}"
        echo -e "    ${DIM}free${NC}     = Jeder kann einladen (Standard)"
        echo -e "    ${YELLOW}pro${NC}      = Nur Pro-Abonnenten"
        echo -e "    ${CYAN}ultimate${NC} = Nur Ultimate-Abonnenten"
        bot_tier="$(prompt_default "Tier (free/pro/ultimate)" "free")"
        write_env_line "BOT_${idx}_NAME" "$name"
        write_env_line "BOT_${idx}_TOKEN" "$token"
        write_env_line "BOT_${idx}_CLIENT_ID" "$client_id"
        write_env_line "BOT_${idx}_PERMISSIONS" "${perms:-35186522836032}"
        write_env_line "BOT_${idx}_TIER" "${bot_tier:-free}"
        ok "Bot $idx konfiguriert (Tier: ${bot_tier:-free})."
      done
    fi
    echo ""
    # Skip to stations
  else
    info "Erstelle neue Konfiguration..."
    cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
    # Fall through to full config
    existing_bots=0
  fi
fi

if [[ $existing_bots -eq 0 ]]; then
  bot_count="$(prompt_int_range "Wie viele Bot-Accounts konfigurieren" "4" 1 20)"
  web_port="$(prompt_int_range "Web-Port" "8081" 1 65535)"
  public_url="$(prompt_default "Oeffentliche URL (optional)" "")"

  if [[ -n "$public_url" ]]; then
    public_url="${public_url%%/}"
  fi

  : > .env
  write_env_line "REGISTER_COMMANDS_ON_BOOT" "1"
  write_env_line "CLEAN_GUILD_COMMANDS_ON_BOOT" "0"
  write_env_line "SYNC_GUILD_COMMANDS_ON_BOOT" "1"
  write_env_line "CLEAN_GLOBAL_COMMANDS_ON_BOOT" "1"
  write_env_line "GUILD_COMMAND_SYNC_RETRIES" "3"
  write_env_line "GUILD_COMMAND_SYNC_RETRY_MS" "1200"
  write_env_line "PERIODIC_GUILD_COMMAND_SYNC_MS" "1800000"
  write_env_line "LOG_MAX_MB" "5"
  write_env_line "LOG_MAX_FILES" "30"
  write_env_line "LOG_MAX_DAYS" "14"
  write_env_line "LOG_PRUNE_CHECK_MS" "600000"
  write_env_line "UPDATE_BUILD_NO_CACHE" "0"
  write_env_line "AUTO_DOCKER_PRUNE" "1"
  write_env_line "DOCKER_BUILDER_PRUNE_UNTIL" "168h"
  write_env_line "DEFAULT_LANGUAGE" "en"
  write_env_line "NOW_PLAYING_RECOGNITION_ENABLED" "0"
  write_env_line "NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS" "18"
  write_env_line "NOW_PLAYING_RECOGNITION_MIN_SECONDS" "10"
  write_env_line "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "28000"
  write_env_line "NOW_PLAYING_RECOGNITION_CACHE_TTL_MS" "90000"
  write_env_line "NOW_PLAYING_RECOGNITION_FAILURE_TTL_MS" "180000"
  write_env_line "NOW_PLAYING_RECOGNITION_SCORE_THRESHOLD" "0.55"
  write_env_line "NOW_PLAYING_MUSICBRAINZ_ENABLED" "1"
  write_env_line "ACOUSTID_API_KEY" ""
  write_env_line "WEB_PORT" "$web_port"
  write_env_line "WEB_INTERNAL_PORT" "8080"
  write_env_line "WEB_BIND" "0.0.0.0"
  write_env_line "PUBLIC_WEB_URL" "$public_url"

  for ((i=1; i<=bot_count; i++)); do
    echo ""
    echo -e "${YELLOW}--- Bot $i von $bot_count ---${NC}"
    echo -e "${DIM}Erstelle einen Bot unter https://discord.com/developers/applications${NC}"
    echo ""
    name="$(prompt_default "Name" "OmniFM Bot $i")"

    while true; do
      token="$(prompt_nonempty "Token (aus Bot-Sektion im Dev-Portal)")"
      if validate_token "$token"; then
        ok "Token Format ok."
        break
      fi
      warn "Token sieht ungueltig aus (mind. 50 Zeichen mit Punkt). Nochmal versuchen."
    done

    while true; do
      client_id="$(prompt_nonempty "Client ID (Application ID)")"
      if validate_client_id "$client_id"; then
        ok "Client ID Format ok."
        break
      fi
      warn "Client ID muss 17-22 Ziffern sein. Nochmal versuchen."
    done

    perms="$(prompt_default "Permissions (Standard: 35186522836032)" "35186522836032")"

    echo ""
    echo -e "  ${DIM}Bot-Tier bestimmt ob dieser Bot frei oder Premium ist:${NC}"
    echo -e "    ${DIM}free${NC}     = Jeder kann einladen (Standard)"
    echo -e "    ${YELLOW}pro${NC}      = Nur Pro-Abonnenten"
    echo -e "    ${CYAN}ultimate${NC} = Nur Ultimate-Abonnenten"
    bot_tier="$(prompt_default "Tier (free/pro/ultimate)" "free")"

    write_env_line "BOT_${i}_NAME" "$name"
    write_env_line "BOT_${i}_TOKEN" "$token"
    write_env_line "BOT_${i}_CLIENT_ID" "$client_id"
    write_env_line "BOT_${i}_PERMISSIONS" "${perms}"
    write_env_line "BOT_${i}_TIER" "${bot_tier:-free}"
    ok "Bot $i konfiguriert (Tier: ${bot_tier:-free})."
  done
fi

configured_bot_count="$(compose_count_bots "$APP_DIR")"
resolved_commander_idx="$(compose_resolve_commander_index "$APP_DIR")"
deployment_mode_setting="$(compose_read_env_value "$APP_DIR" "OMNIFM_DEPLOYMENT_MODE" "auto")"

write_env_line "BOT_COUNT" "$configured_bot_count"
write_env_line "COMMANDER_BOT_INDEX" "$resolved_commander_idx"
write_env_line "OMNIFM_DEPLOYMENT_MODE" "${deployment_mode_setting:-auto}"
write_env_line "REMOTE_WORKER_HEARTBEAT_MS" "$(compose_read_env_value "$APP_DIR" "REMOTE_WORKER_HEARTBEAT_MS" "5000")"
write_env_line "REMOTE_WORKER_COMMAND_POLL_MS" "$(compose_read_env_value "$APP_DIR" "REMOTE_WORKER_COMMAND_POLL_MS" "1000")"
write_env_line "REMOTE_WORKER_COMMAND_TTL_MS" "$(compose_read_env_value "$APP_DIR" "REMOTE_WORKER_COMMAND_TTL_MS" "300000")"
write_env_line "REMOTE_WORKER_STATUS_POLL_MS" "$(compose_read_env_value "$APP_DIR" "REMOTE_WORKER_STATUS_POLL_MS" "2000")"
write_env_line "REMOTE_WORKER_STATUS_STALE_MS" "$(compose_read_env_value "$APP_DIR" "REMOTE_WORKER_STATUS_STALE_MS" "45000")"
write_env_line "BOT_STATE_SPLIT_DIR" "$(compose_read_env_value "$APP_DIR" "BOT_STATE_SPLIT_DIR" "runtime-data/bot-state")"

refresh_omnifm_compose_env "$APP_DIR"
ok "$(compose_deployment_summary "$APP_DIR")"
if [[ "${OMNIFM_DEPLOYMENT_ACTIVE:-monolith}" == "split" ]]; then
  info "Neue Bots werden kuenftig automatisch als eigene Worker-Container gestartet, sobald du install.sh oder update.sh erneut laufen laesst."
fi

echo ""

# ====================================
# Step 3: Stations
# ====================================
echo -e "${BOLD}Schritt 3/6: OmniFM-Stationen${NC}"
echo "─────────────────────────────────────"

if [[ ! -f stations.json ]]; then
  info "Erstelle stations.json mit Standard-Stationen..."
  cat > stations.json <<'STATIONS_EOF'
{
  "defaultStationKey": "oneworldradio",
  "qualityPreset": "high",
  "locked": false,
  "fallbackKeys": ["lofi", "pop"],
  "stations": {
    "oneworldradio": {
      "name": "Tomorrowland - One World Radio",
      "url": "https://tomorrowland.my105.ch/oneworldradio.mp3",
      "genre": "Electronic / Festival"
    },
    "lofi": {
      "name": "Lofi Hip Hop Radio",
      "url": "https://streams.ilovemusic.de/iloveradio17.mp3",
      "genre": "Lo-Fi / Chill"
    },
    "classicrock": {
      "name": "Classic Rock Radio",
      "url": "https://streams.ilovemusic.de/iloveradio21.mp3",
      "genre": "Rock / Classic"
    },
    "chillout": {
      "name": "Chillout Lounge",
      "url": "https://streams.ilovemusic.de/iloveradio7.mp3",
      "genre": "Chill / Ambient"
    },
    "dance": {
      "name": "Dance Radio",
      "url": "https://streams.ilovemusic.de/iloveradio2.mp3",
      "genre": "Dance / EDM"
    },
    "hiphop": {
      "name": "Hip Hop Channel",
      "url": "https://streams.ilovemusic.de/iloveradio3.mp3",
      "genre": "Hip Hop / Rap"
    },
    "techno": {
      "name": "Techno Bunker",
      "url": "https://streams.ilovemusic.de/iloveradio12.mp3",
      "genre": "Techno / House"
    },
    "pop": {
      "name": "Pop Hits",
      "url": "https://streams.ilovemusic.de/iloveradio.mp3",
      "genre": "Pop / Charts"
    },
    "rock": {
      "name": "Rock Nation",
      "url": "https://streams.ilovemusic.de/iloveradio4.mp3",
      "genre": "Rock / Alternative"
    },
    "bass": {
      "name": "Bass Boost FM",
      "url": "https://streams.ilovemusic.de/iloveradio16.mp3",
      "genre": "Bass / Dubstep"
    },
    "deutschrap": {
      "name": "Deutsch Rap",
      "url": "https://streams.ilovemusic.de/iloveradio6.mp3",
      "genre": "Deutsch Rap"
    }
  }
}
STATIONS_EOF
  ok "11 Standard-Stationen erstellt."
else
  ok "stations.json vorhanden (wird beibehalten)."
  count=$(python3 -c "import json;d=json.load(open('stations.json'));print(len(d.get('stations',{})))" 2>/dev/null || echo "?")
  info "Stationen: $count"
fi

mkdir -p logs

echo ""

# ====================================
# Step 4: Audio-Qualitaet
# ====================================
echo -e "${BOLD}Schritt 4/6: Audio-Qualitaet${NC}"
echo "─────────────────────────────────────"

if ! grep -q "^TRANSCODE=" .env 2>/dev/null; then
  if prompt_yes_no "Opus-Transcoding aktivieren? (Bessere Qualitaet, braucht mehr CPU)" "j"; then
    write_env_line "TRANSCODE" "1"
    write_env_line "TRANSCODE_MODE" "opus"
    echo ""
    echo -e "  ${CYAN}Qualitaets-Stufen:${NC}"
    echo -e "    ${GREEN}1${NC}) Low    (96k)  - Wenig CPU"
    echo -e "    ${YELLOW}2${NC}) Medium (128k) - Ausgewogen"
    echo -e "    ${CYAN}3${NC}) High   (192k) - Empfohlen"
    echo -e "    ${BOLD}4${NC}) Ultra  (320k) - Maximum"
    echo ""
    quality_choice="$(prompt_default "Qualitaet waehlen" "3")"
    case "$quality_choice" in
      1) write_env_line "OPUS_BITRATE" "96k" ;;
      2) write_env_line "OPUS_BITRATE" "128k" ;;
      4) write_env_line "OPUS_BITRATE" "320k" ;;
      *) write_env_line "OPUS_BITRATE" "192k" ;;
    esac
    ok "Opus-Transcoding konfiguriert."
  else
    info "Transcoding deaktiviert (Standard-Qualitaet)."
  fi
else
  ok "Audio-Einstellungen bereits konfiguriert."
fi

echo ""

# ====================================
# Step 5: Premium / Stripe (Optional)
# ====================================
echo -e "${BOLD}Schritt 5/8: Premium / Stripe (Optional)${NC}"
echo "─────────────────────────────────────"

if ! grep -q "^STRIPE_SECRET_KEY=" .env 2>/dev/null; then
  if prompt_yes_no "Premium-Zahlungen mit Stripe einrichten? (Optional)" "n"; then
    echo ""
    echo -e "  ${CYAN}Erstelle einen Stripe-Account unter https://stripe.com${NC}"
    echo -e "  ${DIM}Du findest deine Keys unter: Dashboard > Developers > API keys${NC}"
    echo ""
    stripe_key="$(prompt_nonempty "Stripe Secret Key (sk_test_... oder sk_live_...)")"
    write_env_line "STRIPE_SECRET_KEY" "$stripe_key"
    stripe_pub="$(prompt_default "Stripe Public Key (pk_test_... optional)" "")"
    if [[ -n "$stripe_pub" ]]; then
      write_env_line "STRIPE_PUBLIC_KEY" "$stripe_pub"
    fi
    ok "Stripe konfiguriert."
  else
    info "Stripe uebersprungen. Kann spaeter mit setup-stripe.sh eingerichtet werden."
  fi
else
  ok "Stripe bereits konfiguriert."
fi

echo ""

# ====================================
# Step 6: DiscordBotList (Optional)
# ====================================
echo -e "${BOLD}Schritt 6/8: DiscordBotList (Optional)${NC}"
echo "--------------------------------------"

if ! grep -q "^DISCORDBOTLIST_TOKEN=" .env 2>/dev/null; then
  if prompt_yes_no "DiscordBotList Integration einrichten? (Optional)" "n"; then
    echo ""
    echo -e "  ${CYAN}Docs: https://docs.discordbotlist.com/${NC}"
    echo -e "  ${DIM}Webhook Endpoint: /api/discordbotlist/vote${NC}"
    echo ""
    dbl_token="$(prompt_nonempty "DiscordBotList API Token")"
    dbl_secret="$(prompt_nonempty "DiscordBotList Webhook Secret")"
    dbl_scope="$(prompt_default "Stats Scope (commander/aggregate)" "aggregate")"
    if [[ "$dbl_scope" != "commander" && "$dbl_scope" != "aggregate" ]]; then
      dbl_scope="aggregate"
    fi
    write_env_line "DISCORDBOTLIST_ENABLED" "1"
    write_env_line "DISCORDBOTLIST_TOKEN" "$dbl_token"
    write_env_line "DISCORDBOTLIST_WEBHOOK_SECRET" "$dbl_secret"
    write_env_line "DISCORDBOTLIST_STATS_SCOPE" "$dbl_scope"
    current_public_url="$(grep -E '^PUBLIC_WEB_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
    if [[ -n "$current_public_url" ]]; then
      info "Webhook URL fuer DiscordBotList: ${current_public_url}/api/discordbotlist/vote"
    fi
    ok "DiscordBotList konfiguriert."
  else
    info "DiscordBotList uebersprungen. Kann spaeter mit ./update.sh --settings eingerichtet werden."
  fi
else
  ok "DiscordBotList bereits konfiguriert."
fi

info "Top.gg und discord.bots.gg koennen spaeter getrennt ueber ./update.sh --settings eingerichtet werden."
info "Gemeinsame Vote-Rewards sind intern bereits ueber vote-events.json vorbereitet."

echo ""

# ====================================
# Step 7: Track Recognition (Optional)
# ====================================
echo -e "${BOLD}Schritt 7/8: Track-Erkennung (Optional)${NC}"
echo "------------------------------------------"

if ! grep -q "^ACOUSTID_API_KEY=.*[^[:space:]]" .env 2>/dev/null; then
  if prompt_yes_no "Audio-Fingerprint-Erkennung via AcoustID und MusicBrainz einrichten? (Optional)" "n"; then
    echo ""
    warn "Die freie AcoustID-Web-API ist laut offizieller Doku nur fuer nicht-kommerzielle Nutzung gedacht."
    info "Chromaprint/fpcalc wird beim Docker-Build automatisch im Container installiert."
    echo -e "  ${CYAN}Chromaprint: https://github.com/acoustid/chromaprint${NC}"
    echo -e "  ${CYAN}AcoustID: https://acoustid.org/webservice${NC}"
    echo -e "  ${CYAN}MusicBrainz Rate Limits: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting${NC}"
    echo ""
    acoustid_key="$(prompt_nonempty "AcoustID API Key")"
    recognition_sample="$(prompt_default "Fingerprint Sample in Sekunden" "18")"
    recognition_min="$(prompt_default "Minimale brauchbare Audio-Dauer in Sekunden" "10")"
    recognition_timeout="$(prompt_default "Timeout in Millisekunden" "28000")"
    write_env_line "NOW_PLAYING_RECOGNITION_ENABLED" "1"
    write_env_line "ACOUSTID_API_KEY" "$acoustid_key"
    write_env_line "NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS" "$recognition_sample"
    write_env_line "NOW_PLAYING_RECOGNITION_MIN_SECONDS" "$recognition_min"
    write_env_line "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "$recognition_timeout"
    write_env_line "NOW_PLAYING_MUSICBRAINZ_ENABLED" "1"
    ok "Track-Erkennung konfiguriert."
  else
    info "Track-Erkennung uebersprungen."
  fi
else
  ok "Track-Erkennung bereits konfiguriert."
fi

echo ""

# ====================================
# Step 8: Docker starten
# ====================================
echo -e "${BOLD}Schritt 8/8: Docker Compose starten${NC}"
echo "─────────────────────────────────────"

info "Baue und starte Container..."
# Sicherstellen dass gemountete JSON-Dateien VOR Docker-Start existieren
# Docker bind-mount erstellt sonst ein VERZEICHNIS statt einer Datei!
for jf in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json dashboard.json discordbotlist.json botsgg.json topgg.json vote-events.json; do
  if [[ -d "$jf" ]]; then rm -rf "$jf" 2>/dev/null || true; fi
done
if [[ -f bot-state ]]; then rm -f bot-state 2>/dev/null || true; fi
if [[ -f song-history ]]; then rm -f song-history 2>/dev/null || true; fi
[[ -f premium.json ]]         || echo '{"licenses":{}}' > premium.json
[[ -f bot-state.json ]]       || echo '{}' > bot-state.json
[[ -f custom-stations.json ]] || echo '{}' > custom-stations.json
[[ -f command-permissions.json ]] || echo '{"guilds":{}}' > command-permissions.json
[[ -f guild-languages.json ]] || echo '{"version":1,"guilds":{}}' > guild-languages.json
[[ -f song-history.json ]] || echo '{"guilds":{}}' > song-history.json
[[ -f listening-stats.json ]] || echo '{"version":1,"guilds":{}}' > listening-stats.json
[[ -f scheduled-events.json ]] || echo '{"version":1,"events":[]}' > scheduled-events.json
[[ -f coupons.json ]] || echo '{"offers":{},"redemptions":{}}' > coupons.json
[[ -f dashboard.json ]] || echo '{"version":1,"events":{},"perms":{},"telemetry":{},"authSessions":{},"oauthStates":{}}' > dashboard.json
[[ -f discordbotlist.json ]] || echo '{"version":1,"totalVotes":0,"votes":[],"lastWebhookVoteAt":null,"lastCommandsSync":null,"lastStatsSync":null,"lastVoteSync":null}' > discordbotlist.json
[[ -f botsgg.json ]] || echo '{"version":1,"lastStatsSync":null}' > botsgg.json
[[ -f topgg.json ]] || echo '{"version":1,"project":null,"lastProjectSync":null,"lastCommandsSync":null,"lastStatsSync":null,"lastVoteSync":null,"lastWebhookVoteAt":null,"lastWebhookTestAt":null}' > topgg.json
[[ -f vote-events.json ]] || echo '{"version":1,"totalVotes":0,"votes":[],"providers":{"discordbotlist":{"totalVotes":0,"lastVoteAt":null,"lastReceivedAt":null},"topgg":{"totalVotes":0,"lastVoteAt":null,"lastReceivedAt":null}}}' > vote-events.json
mkdir -p logs bot-state song-history

compose_up_with_build || exit 1

echo ""
info "Warte auf Health-Check (max 30 Sekunden)..."

web_port="${web_port:-$(grep -E '^WEB_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || echo "8081")}"
health_ok=false

for attempt in 1 2 3 4 5 6; do
  sleep 5
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 5 "http://127.0.0.1:${web_port}/api/health" >/dev/null 2>&1; then
      health_ok=true
      break
    fi
  fi
  echo -e "  ${DIM}Versuch $attempt/6 - warte...${NC}"
done

echo ""
if $health_ok; then
  ok "Health-Check bestanden!"
else
  warn "Health-Check nicht bestanden. Das kann normal sein wenn Bot-Tokens noch nicht verifiziert sind."
  echo -e "  ${DIM}Pruefe Logs:  bash ./scripts/compose.sh logs --tail=100 omnifm${NC}"
  if [[ "${OMNIFM_DEPLOYMENT_ACTIVE:-monolith}" == "split" ]]; then
    echo -e "  ${DIM}Komplettstatus: bash ./update.sh --status quick${NC}"
  fi
fi

# ====================================
# Zusammenfassung
# ====================================
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║                                           ║"
echo "  ║    Installation abgeschlossen!            ║"
echo "  ║                                           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "  ${CYAN}Webseite:${NC}           http://<server-ip>:${web_port}"
public_url_display="$(grep -E '^PUBLIC_WEB_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [[ -n "$public_url_display" ]]; then
  echo -e "  ${CYAN}Public URL:${NC}         ${public_url_display}"
fi
echo ""
echo -e "  ${BOLD}Nuetzliche Befehle:${NC}"
echo -e "    Stationen:        ${GREEN}bash ./stations.sh${NC}"
echo -e "    Bot bearbeiten:   ${GREEN}bash ./update.sh --edit-bot${NC}"
echo -e "    Bots verwalten:   ${GREEN}bash ./update.sh --bots${NC}"
echo -e "    Premium:          ${GREEN}bash ./update.sh --premium${NC}"
echo -e "    Stripe Setup:     ${GREEN}bash ./setup-stripe.sh${NC}"
echo -e "    Update:           ${GREEN}bash ./update.sh${NC}"
echo -e "    Logs:             ${GREEN}bash ./scripts/compose.sh logs -f omnifm${NC}"
echo -e "    Status:           ${GREEN}bash ./scripts/compose.sh ps${NC}"
echo -e "    Neustart:         ${GREEN}bash ./scripts/compose.sh restart${NC}"
if [[ "${OMNIFM_DEPLOYMENT_ACTIVE:-monolith}" == "split" ]]; then
  echo -e "    Worker-Logs:      ${GREEN}bash ./scripts/compose.sh logs -f omnifm-worker-<bot-index>${NC}"
  echo -e "    Hinweis:          ${DIM}Neue Bots aus ./update.sh --add-bot werden automatisch als neue Worker-Container gestartet.${NC}"
fi
echo ""
