#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OmniFM canonical runtime start
# Builds the React frontend and starts the Node.js API + Discord runtime as one
# process. The archived Python backend is intentionally not started here.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/run"
LOG_DIR="$ROOT/logs"
ENV_FILE="$ROOT/.env"
LEGACY_BACKEND_ENV="$ROOT/backend/.env"
LEGACY_FRONTEND_ENV="$ROOT/frontend/.env"
OWNER_CONFIG_ENV="$ROOT/owner-config.env"
BACKUP_ROOT="$ROOT/.update-backups"

log() { printf "\033[1;36m[OmniFM]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[OmniFM]\033[0m %s\n" "$*" >&2; exit 1; }

mkdir -p "$RUN_DIR" "$LOG_DIR"
cd "$ROOT"

command -v node >/dev/null 2>&1 || die "Node.js 22 ist erforderlich."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" == "22" ]] || die "Node.js 22 ist erforderlich (gefunden: $(node -v))."
command -v npm >/dev/null 2>&1 || die "npm wurde nicht gefunden."

# Configuration is production data. A deployment must never replace it with
# defaults just because the layout of a release changed. Older OmniFM releases
# stored the runtime configuration in backend/.env; current releases use .env
# in the repository root. Keep a dated copy first, then migrate only values
# missing or still placeholders in the target file.
BACKUP_DIR="$BACKUP_ROOT/config-$(date +%Y%m%d-%H%M%S)"
backup_config() {
  local source="$1" name="$2"
  [[ -f "$source" ]] || return 0
  mkdir -p "$BACKUP_DIR"
  cp -p "$source" "$BACKUP_DIR/$name"
}

read_env_value() {
  local file="$1" key="$2" line value=""
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "$key"=*) value="${line#*=}" ;;
    esac
  done < "$file"
  printf '%s' "$value"
}

is_placeholder() {
  local value="$1"
  case "$value" in
    ''|change-me|your_*|your-*|'<'*|http://localhost*|http://127.0.0.1*|legal@example.com|privacy@example.com|terms@example.com)
      return 0
      ;;
    *) return 1 ;;
  esac
}

set_env_value() {
  local file="$1" key="$2" value="$3" temp
  temp="$(mktemp "$file.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    $0 ~ "^[[:space:]]*" key "=" {
      if (!written) print key "=" value
      written = 1
      next
    }
    { print }
    END { if (!written) print key "=" value }
  ' "$file" > "$temp"
  mv "$temp" "$file"
}

migrate_missing_values() {
  local source="$1" line key value current migrated=0
  [[ -f "$source" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    current="$(read_env_value "$ENV_FILE" "$key")"
    if is_placeholder "$current" && ! is_placeholder "$value"; then
      set_env_value "$ENV_FILE" "$key" "$value"
      migrated=$((migrated + 1))
    fi
  done < "$source"
  [[ "$migrated" -eq 0 ]] || log "$migrated vorhandene Werte aus $(basename "$source") uebernommen; bestehende Werte bleiben unveraendert."
}

migrate_alias() {
  local source="$1" source_key="$2" target_key="$3" value current
  value="$(read_env_value "$source" "$source_key")"
  current="$(read_env_value "$ENV_FILE" "$target_key")"
  if ! is_placeholder "$value" && is_placeholder "$current"; then
    set_env_value "$ENV_FILE" "$target_key" "$value"
    log "Bestehenden Wert $source_key nach $target_key migriert."
  fi
}

backup_config "$ENV_FILE" "root.env"
backup_config "$LEGACY_BACKEND_ENV" "backend.env"
backup_config "$LEGACY_FRONTEND_ENV" "frontend.env"
backup_config "$OWNER_CONFIG_ENV" "owner-config.env"
[[ ! -d "$BACKUP_DIR" ]] || log "Konfigurations-Backup: ${BACKUP_DIR#$ROOT/}"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$LEGACY_BACKEND_ENV" ]]; then
    cp -p "$LEGACY_BACKEND_ENV" "$ENV_FILE"
    log "Bestehende backend/.env als Root-Konfiguration uebernommen."
  else
    cp "$ROOT/.env.example" "$ENV_FILE"
    log ".env aus .env.example angelegt. Bitte die benoetigten Werte im Owner-Menue oder in .env setzen."
  fi
fi

# This also repairs the short-lived 29ed54e release: it created a root .env
# from the example even though backend/.env already held the live values.
migrate_missing_values "$LEGACY_BACKEND_ENV"
migrate_missing_values "$LEGACY_FRONTEND_ENV"
migrate_alias "$LEGACY_BACKEND_ENV" "DISCORD_BOT_TOKEN" "BOT_1_TOKEN"
migrate_alias "$LEGACY_BACKEND_ENV" "DISCORD_TOKEN" "BOT_1_TOKEN"
migrate_alias "$LEGACY_BACKEND_ENV" "BOT_TOKEN" "BOT_1_TOKEN"
migrate_alias "$LEGACY_BACKEND_ENV" "CLIENT_ID" "BOT_1_CLIENT_ID"
chmod 600 "$ENV_FILE" || true

if [[ -f "$RUN_DIR/omnifm.pid" ]] && kill -0 "$(cat "$RUN_DIR/omnifm.pid" 2>/dev/null)" 2>/dev/null; then
  die "OmniFM laeuft bereits (PID $(cat "$RUN_DIR/omnifm.pid")). Erst ./stop.sh ausfuehren."
fi
rm -f "$RUN_DIR/omnifm.pid"

log "Installiere Backend-Abhaengigkeiten ..."
npm ci --no-audit --no-fund --engine-strict=false
log "Installiere Frontend-Abhaengigkeiten und baue das Frontend ..."
npm --prefix frontend ci --no-audit --no-fund --engine-strict=false
npm run frontend:build

log "Starte Node.js API, Website und Discord-Runtime ..."
nohup node src/index.js >"$LOG_DIR/omnifm.log" 2>&1 &
echo $! >"$RUN_DIR/omnifm.pid"

sleep 2
if ! kill -0 "$(cat "$RUN_DIR/omnifm.pid")" 2>/dev/null; then
  tail -n 80 "$LOG_DIR/omnifm.log" >&2 || true
  rm -f "$RUN_DIR/omnifm.pid"
  die "OmniFM konnte nicht gestartet werden."
fi

log "OmniFM ist gestartet (PID $(cat "$RUN_DIR/omnifm.pid"))."
log "Website, API und Discord laufen aus demselben Release-Stand."
