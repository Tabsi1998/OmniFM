#!/usr/bin/env sh

set -u

export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"
export OMNIFM_RUNTIME_DATA_DIR="${OMNIFM_RUNTIME_DATA_DIR:-/app/runtime-data}"

fatal() {
  echo "[ERROR] $*" >&2
  exit 1
}

ensure_runtime_dir() {
  dirpath="$1"

  if [ -e "$dirpath" ] && [ ! -d "$dirpath" ]; then
    fatal "$dirpath must be a writable directory. Run bash ./init-data.sh on the host before starting Compose."
  fi

  mkdir -p "$dirpath" || fatal "Could not create runtime directory $dirpath."
  [ -w "$dirpath" ] || fatal "$dirpath is not writable by the unprivileged container user. Run bash ./init-data.sh on the host."
}

init_json_file() {
  filepath="$1"
  default_file="${2:-}"
  filename=$(basename "$filepath")

  if [ -d "$filepath" ]; then
    fatal "$filepath is a directory, not a JSON file. Fix the runtime-data mount on the host; refusing an in-memory fallback."
  fi

  if [ ! -e "$filepath" ]; then
    if [ -n "$default_file" ] && [ -f "$default_file" ]; then
      cp "$default_file" "$filepath" || fatal "Could not seed $filename from $default_file."
    else
      printf '{}\n' > "$filepath" || fatal "Could not initialize $filename."
    fi
  fi

  if [ ! -s "$filepath" ]; then
    printf '{}\n' > "$filepath" || fatal "Could not initialize empty $filename."
  fi

  if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$filepath" 2>/dev/null; then
    backup="${filepath}.corrupt-$(date +%s)"
    cp "$filepath" "$backup" 2>/dev/null || true
    fatal "$filename contains invalid JSON. A best-effort backup was written to $backup; repair the file before restarting."
  fi
}

ensure_runtime_dir "$OMNIFM_RUNTIME_DATA_DIR"
ensure_runtime_dir "$OMNIFM_RUNTIME_DATA_DIR/logs"
ensure_runtime_dir "$OMNIFM_RUNTIME_DATA_DIR/bot-state"
ensure_runtime_dir "$OMNIFM_RUNTIME_DATA_DIR/song-history"

init_json_file "$OMNIFM_RUNTIME_DATA_DIR/stations.json" "/app/defaults/stations.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/bot-state.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/custom-stations.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/command-permissions.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/guild-languages.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/song-history.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/listening-stats.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/dashboard.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/scheduled-events.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/coupons.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/premium.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/discordbotlist.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/botsgg.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/topgg.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/vote-events.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/operator-incidents.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/runtime-incidents.json"
init_json_file "$OMNIFM_RUNTIME_DATA_DIR/owner-audit.json"

if command -v ffmpeg >/dev/null 2>&1; then
  echo "[INFO] ffmpeg available: $(ffmpeg -version | head -n 1)"
else
  fatal "ffmpeg is missing from the runtime image."
fi

if [ "${NOW_PLAYING_RECOGNITION_ENABLED:-0}" != "0" ]; then
  if command -v fpcalc >/dev/null 2>&1; then
    echo "[INFO] Audio recognition ready: $(fpcalc -version 2>/dev/null | head -n 1)"
  else
    fatal "Audio recognition is enabled but fpcalc/Chromaprint is missing."
  fi
fi

is_default_app_command() {
  [ "$#" -eq 2 ] && [ "$1" = "node" ] && [ "$2" = "/app/src/index.js" ]
}

# Docker Compose uses `command` for the commander and worker roles. With an
# ENTRYPOINT those commands still get the data-dir validation above, but should
# not perform the monolith-only command registration below.
if [ "$#" -gt 0 ] && ! is_default_app_command "$@"; then
  exec "$@"
fi

if [ -n "${MONGO_URL:-}" ]; then
  MONGO_WAIT_SECONDS="${MONGO_WAIT_SECONDS:-30}"
  echo "[INFO] Waiting for MongoDB for up to ${MONGO_WAIT_SECONDS}s..."
  waited=0
  while [ "$waited" -lt "$MONGO_WAIT_SECONDS" ]; do
    if node -e "
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000 });
      client.connect().then(() => client.close()).then(() => process.exit(0)).catch(() => process.exit(1));
    " 2>/dev/null; then
      echo "[INFO] MongoDB is reachable."
      break
    fi
    waited=$((waited + 2))
    sleep 2
  done
  if [ "$waited" -ge "$MONGO_WAIT_SECONDS" ]; then
    echo "[WARN] MongoDB was not reachable after ${MONGO_WAIT_SECONDS}s; starting with the configured runtime policy."
  fi
fi

if [ "${REGISTER_COMMANDS_ON_BOOT:-1}" = "1" ]; then
  echo "[INFO] Registering Discord commands..."
  node /app/src/deploy-commands.js || echo "[WARN] Command registration failed; continuing startup."
fi

echo "[INFO] Starting OmniFM..."
exec node /app/src/index.js
