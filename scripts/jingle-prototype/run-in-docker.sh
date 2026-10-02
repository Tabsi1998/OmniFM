#!/usr/bin/env bash
# The jingle prototype's measurement (#309) on Linux with ffmpeg, like the
# server. From the repository root:
#   docker run --rm -v "$PWD:/src:ro" -v omnifm-local-check-npm:/root/.npm \
#     node:22-bookworm bash /src/scripts/jingle-prototype/run-in-docker.sh --seconds 180
# The arguments go to measure.mjs: --seconds, --every, --switches, --stations.
set -euo pipefail

apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends ffmpeg >/dev/null
mkdir -p /app/scripts /app/src/lib
cp /src/package.json /src/package-lock.json /app/
cp -r /src/scripts/jingle-prototype /app/scripts/
cp /src/src/lib/jingle-mixer.js /app/src/lib/
cd /app
npm ci --omit=dev --no-audit --no-fund --loglevel=error
ffmpeg -hide_banner -version | sed -n 1p
node scripts/jingle-prototype/measure.mjs "$@"
