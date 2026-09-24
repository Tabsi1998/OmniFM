#!/usr/bin/env bash
# One-time move of the runtime files from the repository root into
# runtime-data/ (#227). Before this, the stores fell back to the repository
# root, and update.sh backed up only runtime-data/, so these files were never
# in a backup.
#
# start.sh runs it while every OmniFM process is stopped. It first writes one
# tar archive of every file it is going to move to .update-backups/runtime-root/.
# A file that already exists in runtime-data/ is never overwritten: the root
# copy stays where it is and is reported.
#
#   scripts/migrate-runtime-data.sh [ROOT]          move; one line per file
#   scripts/migrate-runtime-data.sh --list [ROOT]   only list what is left in the root
set -euo pipefail

LIST_ONLY=0
if [ "${1:-}" = "--list" ]; then
  LIST_ONLY=1
  shift
fi
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TARGET="$ROOT/runtime-data"

# Every file and folder the Node stores keep through resolveRuntimeDataPath.
RUNTIME_NAMES=(
  bot-state.json bot-state
  song-history.json song-history
  custom-stations.json premium.json dashboard.json command-permissions.json
  botsgg.json coupons.json discordbotlist.json guild-languages.json
  owner-audit.json listening-stats.json operator-incidents.json
  runtime-incidents.json scheduled-events.json topgg.json vote-events.json
)

found=()
for name in "${RUNTIME_NAMES[@]}"; do
  for entry in "$name" "$name.bak"; do
    [ -e "$ROOT/$entry" ] && found+=("$entry")
  done
done

if [ "$LIST_ONLY" -eq 1 ]; then
  for entry in "${found[@]}"; do
    printf 'left in root: %s\n' "$entry"
  done
  exit 0
fi

[ "${#found[@]}" -gt 0 ] || exit 0

to_move=()
for entry in "${found[@]}"; do
  if [ -e "$TARGET/$entry" ]; then
    printf 'kept %s (runtime-data/%s already exists, the root copy stays)\n' "$entry" "$entry"
  else
    to_move+=("$entry")
  fi
done
[ "${#to_move[@]}" -gt 0 ] || exit 0

mkdir -p "$TARGET" "$ROOT/.update-backups/runtime-root"
# Relative archive path: GNU tar reads "C:/..." as host:path.
archive_rel=".update-backups/runtime-root/runtime-root-$(date +%Y%m%d-%H%M%S).tar.gz"
archive="$ROOT/$archive_rel"
(cd "$ROOT" && tar -czf "$archive_rel" "${to_move[@]}") || {
  printf 'error: could not archive the runtime files; nothing was moved\n' >&2
  exit 1
}
printf 'backup %s\n' "$archive"

for entry in "${to_move[@]}"; do
  mv "$ROOT/$entry" "$TARGET/$entry"
  printf 'moved %s\n' "$entry"
done
