#!/usr/bin/env bash
set -euo pipefail

# FlowSpace release script
# Creates a GitHub release on mohamedelrefaiy/flowspace with a bundled tarball.
#
# Usage:
#   ./scripts/release.sh           # uses version from package.json
#   ./scripts/release.sh --dry-run # builds and packages but does not publish

REPO="mohamedelrefaiy/flowspace"
DRY_RUN=false

for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=true
done

# ── Helpers ──────────────────────────────────────────────────────────
info()    { echo -e "\n  \033[1m$*\033[0m"; }
success() { echo -e "  \033[32m✓\033[0m $*"; }
error()   { echo -e "  \033[31m✗\033[0m $*" >&2; exit 1; }

# ── Version ──────────────────────────────────────────────────────────
VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
TAG="v${VERSION}"
TARBALL="flowspace-v${VERSION}.tar.gz"
BUNDLE_DIR="flowspace-v${VERSION}"

info "Building FlowSpace ${TAG}..."

# ── Check OAuth credentials ──────────────────────────────────────────
GWS_SECRET="$HOME/.config/gws/client_secret.json"
if [ ! -f "$GWS_SECRET" ]; then
  error "OAuth credentials not found at $GWS_SECRET — cannot build release."
fi
success "OAuth credentials found"

# ── Read credentials ─────────────────────────────────────────────────
OAUTH_CLIENT_ID=$(node -e "const f=require('fs'),p=JSON.parse(f.readFileSync('$GWS_SECRET','utf-8')); process.stdout.write(p.installed.client_id)")
OAUTH_CLIENT_SECRET=$(node -e "const f=require('fs'),p=JSON.parse(f.readFileSync('$GWS_SECRET','utf-8')); process.stdout.write(p.installed.client_secret)")

# ── Build ────────────────────────────────────────────────────────────
npm run build
# Build server with credentials injected (obfuscated in minified binary, no file on disk)
npx esbuild server.ts \
  --bundle --platform=node --format=esm \
  --outfile=dist-server/server.mjs \
  --target=node20 \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
  --define:__FLOWSPACE_VERSION__="\"$VERSION\"" \
  --define:__OAUTH_CLIENT_ID__="\"$OAUTH_CLIENT_ID\"" \
  --define:__OAUTH_CLIENT_SECRET__="\"$OAUTH_CLIENT_SECRET\""
npx esbuild bin/cli.ts \
  --bundle --platform=node --format=esm \
  --outfile=bin/cli.mjs \
  --target=node20 \
  --define:__CLI_VERSION__="\"$VERSION\""
success "Build complete (credentials injected)"

# ── Package ──────────────────────────────────────────────────────────
info "Packaging ${TARBALL}..."

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/$BUNDLE_DIR/bin"
mkdir -p "$TMP_DIR/$BUNDLE_DIR/dist-server"

# Copy files
cp -r dist/ "$TMP_DIR/$BUNDLE_DIR/dist/"
cp dist-server/server.mjs "$TMP_DIR/$BUNDLE_DIR/dist-server/server.mjs"
cp bin/cli.mjs "$TMP_DIR/$BUNDLE_DIR/bin/cli.mjs"
chmod +x "$TMP_DIR/$BUNDLE_DIR/bin/cli.mjs"

# Note: OAuth credentials are injected into server.mjs at build time via --define.
# No client_secret.json file is shipped. All deps are bundled into server.mjs.

# Create tarball
tar -czf "$TARBALL" -C "$TMP_DIR" "$BUNDLE_DIR"
success "Created ${TARBALL} ($(du -sh "$TARBALL" | cut -f1))"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "  Dry run complete. Tarball: $(pwd)/${TARBALL}"
  echo ""
  exit 0
fi

# ── GitHub Release ───────────────────────────────────────────────────
info "Creating GitHub release ${TAG}..."

if gh release view "$TAG" --repo "$REPO" &>/dev/null; then
  error "Release ${TAG} already exists. Bump the version in package.json first."
fi

gh release create "$TAG" \
  --repo "$REPO" \
  --title "FlowSpace ${TAG}" \
  --notes "## Install

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash
\`\`\`

Then run \`flowspace\`.

## What's new

See [CHANGELOG](https://github.com/${REPO}/blob/main/CHANGELOG.md) for details." \
  "$TARBALL"

success "Release ${TAG} published"
echo ""
echo "  https://github.com/${REPO}/releases/tag/${TAG}"
echo ""

# ── Cleanup ──────────────────────────────────────────────────────────
rm -f "$TARBALL"
