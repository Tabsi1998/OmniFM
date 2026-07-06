#!/usr/bin/env sh

# KEIN set -e hier! Wir behandeln Fehler selbst.
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

init_runtime_dir() {
  local dirpath="$1"

  if [ -f "$dirpath" ]; then
    echo "[WARN] $dirpath ist eine Datei statt ein Verzeichnis."
    echo "[WARN] Bitte auf dem Host korrigieren und den Container neu starten."
    return 0
  fi

  mkdir -p "$dirpath" 2>/dev/null || true
}

init_runtime_dir "/app/logs"
init_runtime_dir "/app/bot-state"
init_runtime_dir "/app/song-history"

# === JSON-Dateien sicherstellen ===
# Docker bind-mount erstellt ein VERZEICHNIS wenn die Datei auf dem Host fehlt.
# Ein Verzeichnis-Mount kann NICHT geloescht werden (Device or resource busy).
# Loesung: Wenn es ein Verzeichnis ist, pruefen ob darin geschrieben werden kann,
# ansonsten eine Warnung ausgeben und trotzdem starten.

init_json_file() {
  local filepath="$1"
  local filename=$(basename "$filepath")

  if [ -d "$filepath" ]; then
    # Es ist ein Verzeichnis (Docker hat es erstellt weil die Datei fehlte)
    echo "[WARN] $filepath ist ein Verzeichnis statt einer Datei!"
    echo "[WARN] Erstelle $filename auf dem Host und starte neu:"
    echo "[WARN]   echo '{}' > ./$filename"
    echo "[WARN]   docker compose up -d"
    # Versuche NICHT zu loeschen - das schlaegt fehl bei Docker-Mounts
    # Statt dessen starten wir trotzdem - der Code nutzt In-Memory-Fallback
    return 0
  fi

  if [ ! -f "$filepath" ]; then
    echo '{}' > "$filepath" 2>/dev/null || true
  fi

  # Leere Datei? Initialisieren
  if [ -f "$filepath" ] && [ ! -s "$filepath" ]; then
    echo '{}' > "$filepath" 2>/dev/null || true
  fi

  # Validate JSON content
  if [ -f "$filepath" ] && [ -s "$filepath" ]; then
    if ! node -e "JSON.parse(require('fs').readFileSync('$filepath','utf8'))" 2>/dev/null; then
      echo "[WARN] $filename enthaelt ungueltiges JSON. Erstelle Backup und initialisiere neu."
      cp "$filepath" "${filepath}.corrupt-$(date +%s)" 2>/dev/null || true
      echo '{}' > "$filepath" 2>/dev/null || true
    fi
  fi
}

init_json_file "/app/bot-state.json"
init_json_file "/app/custom-stations.json"
init_json_file "/app/command-permissions.json"
init_json_file "/app/guild-languages.json"
init_json_file "/app/song-history.json"
init_json_file "/app/listening-stats.json"
init_json_file "/app/dashboard.json"
init_json_file "/app/scheduled-events.json"
init_json_file "/app/coupons.json"
init_json_file "/app/premium.json"
init_json_file "/app/stations.json"
# Fix: Fehlende JSON-Dateien ergaenzt (wurden vorher nicht initialisiert)
init_json_file "/app/discordbotlist.json"
init_json_file "/app/botsgg.json"
init_json_file "/app/topgg.json"
init_json_file "/app/vote-events.json"

if command -v ffmpeg >/dev/null 2>&1; then
  echo "[INFO] ffmpeg verfuegbar: $(ffmpeg -version | head -n 1)"
else
  echo "[WARN] ffmpeg fehlt im Container."
fi

if [ "${NOW_PLAYING_RECOGNITION_ENABLED:-0}" != "0" ]; then
  if command -v fpcalc >/dev/null 2>&1; then
    echo "[INFO] Audio-Erkennung bereit: $(fpcalc -version 2>/dev/null | head -n 1)"
  else
    echo "[WARN] Audio-Erkennung ist aktiviert, aber fpcalc/Chromaprint fehlt im Container."
    echo "[WARN] Bitte Docker-Image neu bauen oder die Build-Logs auf Paketfehler pruefen."
  fi
fi

# === MongoDB-Verfuegbarkeit pruefen ===
if [ -n "$MONGO_URL" ]; then
  MONGO_WAIT_SECONDS="${MONGO_WAIT_SECONDS:-30}"
  echo "[INFO] Warte auf MongoDB ($MONGO_URL) fuer maximal ${MONGO_WAIT_SECONDS}s..."
  WAITED=0
  while [ "$WAITED" -lt "$MONGO_WAIT_SECONDS" ]; do
    if node -e "
      const { MongoClient } = require('mongodb');
      const c = new MongoClient('$MONGO_URL', { serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000 });
      c.connect().then(() => { c.close(); process.exit(0); }).catch(() => process.exit(1));
    " 2>/dev/null; then
      echo "[INFO] MongoDB ist erreichbar."
      break
    fi
    WAITED=$((WAITED + 2))
    sleep 2
  done
  if [ "$WAITED" -ge "$MONGO_WAIT_SECONDS" ]; then
    echo "[WARN] MongoDB nicht erreichbar nach ${MONGO_WAIT_SECONDS}s. Starte trotzdem mit Datei-basierten Stores."
  fi
fi

if [ "${REGISTER_COMMANDS_ON_BOOT:-1}" = "1" ] && [ "${BOT_PROCESS_ROLE:-}" != "worker" ]; then
  echo "[INFO] Registriere Discord-Commands..."
  node /app/src/deploy-commands.js || echo "[WARN] Command-Registrierung fehlgeschlagen (ueberspringe)"
fi

echo "[INFO] Starte OmniFM..."
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node /app/src/index.js
