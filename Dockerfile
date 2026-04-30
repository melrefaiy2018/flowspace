# syntax=docker/dockerfile:1.4
#
# FlowSpace — single-container production image
#
# Build:
#   docker build \
#     --build-arg OAUTH_CLIENT_ID=... \
#     --build-arg OAUTH_CLIENT_SECRET=... \
#     -t flowspace .
#
# Run:
#   docker run -p 3000:3000 -v ~/.flowspace:/data flowspace

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build the React frontend
RUN ./node_modules/.bin/vite build

# Bundle server.mjs with OAuth credentials injected at build time.
# Credentials are baked into the binary — not stored as files.
ARG OAUTH_CLIENT_ID=""
ARG OAUTH_CLIENT_SECRET=""
ARG FLOWSPACE_VERSION=0.0.0-docker

RUN printf '%s' "$OAUTH_CLIENT_ID"     > /tmp/oauth_id.txt && \
    printf '%s' "$OAUTH_CLIENT_SECRET"  > /tmp/oauth_sec.txt && \
    printf '%s' "$FLOWSPACE_VERSION"    > /tmp/version.txt && \
    node -e " \
      const fs = require('fs'); \
      const { execFileSync } = require('child_process'); \
      const id  = fs.readFileSync('/tmp/oauth_id.txt',  'utf8').trim(); \
      const sec = fs.readFileSync('/tmp/oauth_sec.txt', 'utf8').trim(); \
      const ver = fs.readFileSync('/tmp/version.txt',   'utf8').trim() || '0.0.0-docker'; \
      console.log('build: id_len=' + id.length + ' sec_len=' + sec.length); \
      execFileSync('./node_modules/.bin/esbuild', [ \
        'server.ts', \
        '--bundle', '--platform=node', '--format=esm', \
        '--outfile=dist-server/server.mjs', '--target=node22', \
        '--banner:js=import{createRequire}from\\'module\\';const require=createRequire(import.meta.url);', \
        '--define:__FLOWSPACE_VERSION__=' + JSON.stringify(ver), \
        '--define:__OAUTH_CLIENT_ID__='    + JSON.stringify(id), \
        '--define:__OAUTH_CLIENT_SECRET__='+ JSON.stringify(sec), \
      ], { stdio: 'inherit' }); \
      fs.rmSync('/tmp/oauth_id.txt'); fs.rmSync('/tmp/oauth_sec.txt'); fs.rmSync('/tmp/version.txt'); \
    "

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine

# Create non-root user
RUN addgroup -S flowspace && adduser -S flowspace -G flowspace

WORKDIR /app

# Copy only the built artifacts — no source, no node_modules
COPY --from=build --chown=flowspace:flowspace /app/dist        ./dist/
COPY --from=build --chown=flowspace:flowspace /app/dist-server ./dist-server/

# Data volume — all user data (tokens, settings) lives here
RUN mkdir -p /data && chown flowspace:flowspace /data
VOLUME ["/data"]

ENV NODE_ENV=production
ENV FLOWSPACE_PRODUCTION=1
ENV HOME=/data
ENV FLOWSPACE_DATA_DIR=/data
ENV PORT=3000
ENV FLOWSPACE_BIND_HOST=0.0.0.0

EXPOSE 3000

USER flowspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "/app/dist-server/server.mjs"]
