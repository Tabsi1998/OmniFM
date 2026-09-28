#!/usr/bin/env bash
# The jingle prototype's measurement (#309) on Linux with ffmpeg, like the
# server. From the repository root:
#   docker run --rm -v "$PWD:/src:ro" -v omnifm-local-check-npm:/root/.npm \
#     node:22-bookworm bash /src/scripts/jingle-prototype/run-in-docker.sh
# JINGLE_SECONDS, JINGLE_EVERY_S and JINGLE_SWITCHES change the run (-e).
set -euo pipefail

apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends ffmpeg >/dev/null
mkdir -p /app/scripts
cp /src/package.json /src/package-lock.json /app/
cp -r /src/scripts/jingle-prototype /app/scripts/
cd /app
npm ci --omit=dev --no-audit --no-fund --loglevel=error
ffmpeg -hide_banner -version | sed -n 1p
node scripts/jingle-prototype/measure.mjs
