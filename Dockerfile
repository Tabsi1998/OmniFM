# escape=\

# Fix: Beide Stages nutzen dieselbe Node-LTS-Version (war: 24 vs 22)
FROM node:22-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
# npm ci für reproduzierbare Builds; package-lock.json muss aktuell sein
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM node:22-slim

RUN set -eux; \
  apt-get update; \
  CHROMAPRINT_PKG="libchromaprint-tools"; \
  if ! apt-cache show "${CHROMAPRINT_PKG}" >/dev/null 2>&1; then \
    CHROMAPRINT_PKG="chromaprint-tools"; \
  fi; \
  apt-get install -y --no-install-recommends \
    ffmpeg \
    "${CHROMAPRINT_PKG}" \
    ca-certificates \
    curl \
    libopus0 \
    libopus-dev \
    libsodium-dev \
    python3 \
    make \
    g++ \
    pkg-config; \
  command -v ffmpeg; \
  command -v fpcalc; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src
COPY web ./web
COPY --from=frontend-builder /frontend/build ./frontend/build
COPY stations.json ./stations.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production

CMD ["/app/docker-entrypoint.sh"]
