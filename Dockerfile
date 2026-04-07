# syntax=docker/dockerfile:1.4
#
# FlowSpace — single-container production image
#
# Build (using BuildKit secret mounts — secrets never appear in layer history):
#   DOCKER_BUILDKIT=1 docker build \
#     --secret id=oauth_client_id,env=OAUTH_CLIENT_ID \
#     --secret id=oauth_client_secret,env=OAUTH_CLIENT_SECRET \
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
# Using BuildKit --mount=type=secret so credentials never appear in layer history.
ARG FLOWSPACE_VERSION=0.0.0-docker

RUN --mount=type=secret,id=oauth_client_id \
    --mount=type=secret,id=oauth_client_secret \
    OAUTH_CLIENT_ID="$(cat /run/secrets/oauth_client_id 2>/dev/null || echo '')" \
    OAUTH_CLIENT_SECRET="$(cat /run/secrets/oauth_client_secret 2>/dev/null || echo '')" \
    npx esbuild server.ts \
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
# In Docker, bind to 0.0.0.0 so the port forward from host works
ENV FLOWSPACE_BIND_HOST=0.0.0.0

EXPOSE 3000

# Drop to non-root user
USER flowspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "/app/dist-server/server.mjs"]
