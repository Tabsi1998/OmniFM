# syntax=docker/dockerfile:1

# Keep the supported Node 22 runtime reproducible. Update this exact image tag
# through the documented dependency/image review process.
ARG NODE_IMAGE=node:22.23.1-bookworm-slim

FROM ${NODE_IMAGE} AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS runtime-deps

# Native audio packages may need a source build. Keep compilers and headers out
# of the final runtime image.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    g++ \
    libopus-dev \
    libsodium-dev \
    make \
    pkg-config \
    python3; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime

RUN set -eux; \
  apt-get update; \
  CHROMAPRINT_PKG="libchromaprint-tools"; \
  if ! apt-cache show "${CHROMAPRINT_PKG}" >/dev/null 2>&1; then \
    CHROMAPRINT_PKG="chromaprint-tools"; \
  fi; \
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    "${CHROMAPRINT_PKG}" \
    libopus0 \
    libsodium23; \
  command -v ffmpeg; \
  command -v fpcalc; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=runtime-deps /app/node_modules ./node_modules
COPY --chown=node:node src ./src
COPY --chown=node:node data ./data
COPY --chown=node:node web ./web
COPY --chown=node:node --from=frontend-builder /frontend/build ./frontend/build
COPY --chown=node:node stations.json ./stations.seed.json
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN set -eux; \
  mkdir -p /app/defaults /app/runtime-data/logs /app/runtime-data/bot-state /app/runtime-data/song-history; \
  mv /app/stations.seed.json /app/defaults/stations.json; \
  chmod +x /app/docker-entrypoint.sh; \
  chown -R node:node /app

ENV NODE_ENV=production
ENV OMNIFM_RUNTIME_DATA_DIR=/app/runtime-data

USER node

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "/app/src/index.js"]
