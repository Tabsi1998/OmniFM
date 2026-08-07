#!/usr/bin/env sh

# Host-side runtime data preparation. This is intentionally run before Compose
# starts so Docker never creates a directory in place of a JSON file mount.
set -eu
umask 077

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RUNTIME_DIR="${OMNIFM_HOST_RUNTIME_DATA_DIR:-$APP_DIR/runtime-data}"

fatal() {
  echo "[ERROR] $*" >&2
  exit 1
}

ensure_dir() {
  dirpath="$1"
  if [ -e "$dirpath" ] && [ ! -d "$dirpath" ]; then
    fatal "$dirpath must be a directory."
  fi
  mkdir -p "$dirpath" || fatal "Could not create $dirpath."
  chmod 700 "$dirpath" 2>/dev/null || true
}

migrate_legacy_dir() {
  dirname="$1"
  legacy_dir="$APP_DIR/$dirname"
  target_dir="$RUNTIME_DIR/$dirname"

  if [ -e "$legacy_dir" ] && [ ! -d "$legacy_dir" ]; then
    fatal "$legacy_dir must be a directory before it can be migrated."
  fi
  [ -d "$legacy_dir" ] || return 0

  ensure_dir "$target_dir"
  for legacy_entry in "$legacy_dir"/*; do
    [ -e "$legacy_entry" ] || continue
    [ -L "$legacy_entry" ] && fatal "$legacy_entry is a symlink. Refusing to migrate an ambiguous runtime artifact."
    entry_name=$(basename "$legacy_entry")
    target_entry="$target_dir/$entry_name"
    if [ -e "$target_entry" ]; then
      echo "[KEPT] runtime-data/$dirname/$entry_name already exists"
      continue
    fi
    cp -R "$legacy_entry" "$target_entry" || fatal "Could not migrate $legacy_entry."
    echo "[MIGRATED] $dirname/$entry_name -> runtime-data/$dirname/$entry_name"
  done
}

seed_json_file() {
  filename="$1"
  default_value="${2:-{}}"
  target="$RUNTIME_DIR/$filename"
  legacy="$APP_DIR/$filename"

  if [ -d "$target" ]; then
    fatal "$target is a directory. Move or remove it manually, then rerun bash ./init-data.sh."
  fi
  if [ -L "$target" ]; then
    fatal "$target is a symlink. Refusing to follow it for runtime data safety."
  fi

  if [ ! -e "$target" ]; then
    if [ -f "$legacy" ]; then
      cp "$legacy" "$target" || fatal "Could not migrate legacy $legacy."
      echo "[MIGRATED] $filename -> runtime-data/$filename"
    elif [ -d "$legacy" ]; then
      fatal "$legacy is a directory. Refusing to create an ambiguous runtime file."
    else
      printf '%s\n' "$default_value" > "$target" || fatal "Could not create $target."
      echo "[CREATED] runtime-data/$filename"
    fi
  fi

  if [ ! -s "$target" ]; then
    printf '%s\n' "$default_value" > "$target" || fatal "Could not initialize $target."
  fi
  chmod 600 "$target" 2>/dev/null || true
}

ensure_dir "$RUNTIME_DIR"
migrate_legacy_dir "logs"
migrate_legacy_dir "bot-state"
migrate_legacy_dir "song-history"
ensure_dir "$RUNTIME_DIR/logs"
ensure_dir "$RUNTIME_DIR/bot-state"
ensure_dir "$RUNTIME_DIR/song-history"

seed_json_file "stations.json" "{\"stations\":{},\"qualityPreset\":\"custom\"}"
seed_json_file "bot-state.json"
seed_json_file "custom-stations.json"
seed_json_file "command-permissions.json"
seed_json_file "guild-languages.json"
seed_json_file "song-history.json"
seed_json_file "listening-stats.json"
seed_json_file "dashboard.json"
seed_json_file "scheduled-events.json"
seed_json_file "coupons.json"
seed_json_file "premium.json"
seed_json_file "discordbotlist.json"
seed_json_file "botsgg.json"
seed_json_file "topgg.json"
seed_json_file "vote-events.json"
seed_json_file "operator-incidents.json"
seed_json_file "runtime-incidents.json"
seed_json_file "owner-audit.json"

echo "[OK] Runtime data is ready in $RUNTIME_DIR"
