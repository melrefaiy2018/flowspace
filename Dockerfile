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
# Credentials are baked into the binary — not stored in any file or layer.
ARG OAUTH_CLIENT_ID
ARG OAUTH_CLIENT_SECRET
ARG FLOWSPACE_VERSION=0.0.0-docker

RUN npx esbuild server.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --outfile=dist-server/server.mjs \
      --target=node22 \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
      "--define:__FLOWSPACE_VERSION__=\"${FLOWSPACE_VERSION}\"" \
      "--define:__OAUTH_CLIENT_ID__=\"${OAUTH_CLIENT_ID}\"" \
      "--define:__OAUTH_CLIENT_SECRET__=\"${OAUTH_CLIENT_SECRET}\""

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Copy only the built artifacts — no source, no node_modules
COPY --from=build /app/dist        ./dist/
COPY --from=build /app/dist-server ./dist-server/

# Data volume — all user data (tokens, settings) lives here
VOLUME ["/data"]

ENV NODE_ENV=production
ENV FLOWSPACE_PRODUCTION=1
ENV HOME=/data
ENV FLOWSPACE_DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "/app/dist-server/server.mjs"]
