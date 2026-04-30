#!/usr/bin/env bash
set -euo pipefail

# FlowSpace installer
# Usage: curl -fsSL https://raw.githubusercontent.com/mohamedelrefaiy/flowspace/main/install.sh | bash

REPO="mohamedelrefaiy/flowspace"
INSTALL_DIR="$HOME/.flowspace"
BIN_DIR="/usr/local/bin"
BINARY="$BIN_DIR/flowspace"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "  ${BOLD}$*${RESET}"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}!${RESET} $*"; }
error()   { echo -e "  ${RED}✗${RESET} $*" >&2; }

echo ""
echo -e "  ${BOLD}FlowSpace Installer${RESET}"
echo ""

# ── Check Node.js ────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  error "Node.js not found."
  echo ""
  echo "  Install Node.js 20+ from https://nodejs.org and re-run this installer."
  echo ""
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  error "Node.js 20+ required. You have $(node --version)."
  echo ""
  echo "  Update Node.js at https://nodejs.org and re-run this installer."
  echo ""
  exit 1
fi
success "Node.js $(node --version)"

# ── Fetch latest release version ────────────────────────────────────
info "Fetching latest release..."
LATEST_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$LATEST_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"v\([^"]*\)".*/\1/')

if [ -z "$VERSION" ]; then
  error "Could not determine latest release version."
  exit 1
fi
success "Latest version: v${VERSION}"

# ── Download tarball ─────────────────────────────────────────────────
TARBALL="flowspace-v${VERSION}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${TARBALL}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

info "Downloading ${TARBALL}..."
if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/$TARBALL"; then
  error "Download failed: $DOWNLOAD_URL"
  exit 1
fi
success "Downloaded"

# ── Extract ──────────────────────────────────────────────────────────
info "Installing to ${INSTALL_DIR}..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/$TARBALL" -C "$INSTALL_DIR" --strip-components=1
success "Extracted"

# ── Make CLI executable ──────────────────────────────────────────────
chmod +x "$INSTALL_DIR/bin/cli.mjs"

# ── Create symlink ───────────────────────────────────────────────────
if [ -w "$BIN_DIR" ]; then
  ln -sf "$INSTALL_DIR/bin/cli.mjs" "$BINARY"
  success "Symlink created at $BINARY"
else
  # Try with sudo
  if command -v sudo &>/dev/null; then
    warn "Need sudo to write to $BIN_DIR"
    sudo ln -sf "$INSTALL_DIR/bin/cli.mjs" "$BINARY"
    success "Symlink created at $BINARY (via sudo)"
  else
    warn "Could not write to $BIN_DIR — add this to your PATH manually:"
    echo ""
    echo "    export PATH=\"\$HOME/.flowspace/bin:\$PATH\""
    echo ""
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}FlowSpace v${VERSION} installed!${RESET}"
echo ""
echo "  Run it:"
echo ""
echo -e "    ${BOLD}flowspace${RESET}"
echo ""
echo "  First run will walk you through Google sign-in setup."
echo ""
