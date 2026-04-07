# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 needs native build tools
RUN apk add --no-cache python3 make g++ && npm ci
COPY . .
RUN npx vite build

# ── Stage 2: Production server ────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Install production deps (better-sqlite3 needs native build, then we clean up)
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev \
    && apk del python3 make g++

# Copy server code and built frontend
COPY server.ts tsconfig.json ./
COPY src/agent/ src/agent/
COPY --from=build /app/dist dist/

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
