.PHONY: help install dev build prod clean typecheck kill docker docker-run docker-stop docker-push tauri-dev tauri-sidecar tauri-build tauri-build-local tauri-verify-macos tauri-icons preview release

PORT             ?= 3000
IMAGE            ?= flowspace
REGISTRY         ?= ghcr.io/melrefaiy2018/flowspace
FLOWSPACE_DATA   ?= $(HOME)/.flowspace
VERSION          := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")

# Bundled OAuth client (Desktop app — loopback flow, safe to ship in open-source builds)
OAUTH_CLIENT_ID     ?= 653886158394-hn7ehagcd9i91s2vpl0qn59c79edgh42.apps.googleusercontent.com
OAUTH_CLIENT_SECRET ?= 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

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: node_modules ## Install dependencies

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

dev: node_modules ## Start dev server (Express + Vite HMR)
	npx tsx server.ts

build: node_modules ## Build frontend for production
	npm run build

prod: build ## Start production server (serves built frontend)
	NODE_ENV=production npx tsx server.ts

typecheck: node_modules ## Run TypeScript type check
	npx tsc --noEmit

synthesizer-eval: node_modules ## Evaluate workflow-synthesizer dogfood signal (SC-002)
	npx tsx scripts/synthesizer-eval.ts

docker: ## Build Docker image (set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET)
	@if [ -z "$(OAUTH_CLIENT_ID)" ] || [ -z "$(OAUTH_CLIENT_SECRET)" ]; then \
		echo "Error: OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET are required."; \
		echo ""; \
		echo "  export OAUTH_CLIENT_ID=your-client-id"; \
		echo "  export OAUTH_CLIENT_SECRET=your-client-secret"; \
		echo "  make docker"; \
		echo ""; \
		echo "  # Or inline (make reads from environment):"; \
		echo "  OAUTH_CLIENT_ID=xxx OAUTH_CLIENT_SECRET=yyy make docker"; \
		exit 1; \
	fi
	docker build \
		--build-arg OAUTH_CLIENT_ID="$(OAUTH_CLIENT_ID)" \
		--build-arg OAUTH_CLIENT_SECRET="$(OAUTH_CLIENT_SECRET)" \
		--build-arg FLOWSPACE_VERSION="$(VERSION)" \
		-t $(IMAGE) \
		-t $(REGISTRY):$(VERSION) \
		-t $(REGISTRY):latest \
		.

docker-run: ## Run container with local data volume
	docker run --rm -it \
		-p $(PORT):3000 \
		-v "$(FLOWSPACE_DATA):/data" \
		-e PORT=$(PORT) \
		--name flowspace \
		$(IMAGE)

docker-stop: ## Stop running container
	docker stop flowspace 2>/dev/null || true

docker-push: ## Push image to GitHub Container Registry
	docker push $(REGISTRY):$(VERSION)
	docker push $(REGISTRY):latest

kill: ## Kill any process on port 3000
	@lsof -ti :$(PORT) | xargs kill -9 2>/dev/null || true
	@echo "Port $(PORT) freed"

clean: ## Remove build artifacts and node_modules
	rm -rf dist node_modules

tauri-dev: node_modules ## Run as native macOS app (dev mode)
	npx tauri dev

tauri-sidecar: node_modules ## Bundle server for production
	npm run prepare:desktop-sidecars
	mkdir -p dist-server
	npx esbuild server.prod.ts --bundle --platform=node --format=esm --outfile=dist-server/server.mjs --external:vite --external:lightningcss --target=node20 \
		--define:__FLOWSPACE_VERSION__=\"$(VERSION)\" \
		--define:__OAUTH_CLIENT_ID__=\"$(OAUTH_CLIENT_ID)\" \
		--define:__OAUTH_CLIENT_SECRET__=\"$(OAUTH_CLIENT_SECRET)\" \
		--banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

TAURI_BUILD_TARGET ?=
TAURI_BUILD_ARGS := $(if $(TAURI_BUILD_TARGET),--target $(TAURI_BUILD_TARGET),)
TAURI_TARGET_DIR ?= $(HOME)/Library/Caches/FlowSpace/tauri-target
TAURI_ENV := CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)"
TAURI_APP_PATH := $(TAURI_TARGET_DIR)/$(if $(TAURI_BUILD_TARGET),$(TAURI_BUILD_TARGET)/,)release/bundle/macos/FlowSpace.app

tauri-build: tauri-sidecar ## Build signed + notarized macOS .app/.dmg for sharing
	@if [ -z "$$APPLE_SIGNING_IDENTITY" ] && [ -z "$$APPLE_CERTIFICATE" ]; then \
		echo "A macOS signing identity is required for distributable builds."; \
		echo "Set APPLE_SIGNING_IDENTITY locally, or APPLE_CERTIFICATE/APPLE_CERTIFICATE_PASSWORD in CI."; \
		echo "Use 'make tauri-build-local' for a local ad-hoc build only."; \
		exit 1; \
	fi
	@if [ -n "$$APPLE_API_KEY" ]; then \
		if [ -z "$$APPLE_API_ISSUER" ] || [ -z "$$APPLE_API_KEY_PATH" ]; then \
			echo "App Store Connect notarization requires APPLE_API_KEY, APPLE_API_ISSUER, and APPLE_API_KEY_PATH."; \
			exit 1; \
		fi; \
	elif [ -n "$$APPLE_ID" ]; then \
		if [ -z "$$APPLE_PASSWORD" ] || [ -z "$$APPLE_TEAM_ID" ]; then \
			echo "Apple ID notarization requires APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID."; \
			exit 1; \
		fi; \
	else \
		echo "Apple notarization credentials are required for shared macOS builds."; \
		echo "Set APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH or APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID before running make tauri-build."; \
		exit 1; \
	fi
	mkdir -p "$(TAURI_TARGET_DIR)"
	xattr -cr src-tauri/resources || true
	rm -rf "$(TAURI_APP_PATH)"
	$(TAURI_ENV) npx tauri build $(TAURI_BUILD_ARGS)
	@$(MAKE) tauri-verify-macos TAURI_BUILD_TARGET="$(TAURI_BUILD_TARGET)"

tauri-build-local: tauri-sidecar ## Build a local-only ad-hoc macOS .app/.dmg (not for sharing)
	mkdir -p "$(TAURI_TARGET_DIR)"
	xattr -cr src-tauri/resources || true
	rm -rf "$(TAURI_APP_PATH)"
	$(TAURI_ENV) APPLE_SIGNING_IDENTITY=- npx tauri build $(TAURI_BUILD_ARGS)
	@echo "Built ad-hoc signed artifacts for local testing only. Shared downloads will fail Gatekeeper on other Macs."

tauri-verify-macos: ## Verify the built macOS app signature and Gatekeeper assessment
	@if [ ! -d "$(TAURI_APP_PATH)" ]; then \
		echo "App bundle not found at $(TAURI_APP_PATH)"; \
		exit 1; \
	fi
	codesign --verify --deep --strict --verbose=2 "$(TAURI_APP_PATH)"
	spctl -a -vv "$(TAURI_APP_PATH)"

tauri-icons: ## Generate app icons from source PNG
	npx tauri icon src-tauri/icons/app-icon.png

release: node_modules ## Build release tarball with bundled OAuth credentials and publish to GitHub
	@echo "Building FlowSpace v$(VERSION) for release..."
	@# Build frontend
	npm run build
	@# Build CLI
	npx esbuild bin/cli.ts --bundle --platform=node --format=esm --outfile=bin/cli.mjs \
		--target=node20 \
		--define:__CLI_VERSION__=\"$(VERSION)\"
	@# Build server with credentials baked in
	mkdir -p dist-server
	npx esbuild server.prod.ts --bundle --platform=node --format=esm --outfile=dist-server/server.mjs \
		--external:vite --external:lightningcss --target=node20 \
		--define:__FLOWSPACE_VERSION__=\"$(VERSION)\" \
		--define:__OAUTH_CLIENT_ID__=\"$(OAUTH_CLIENT_ID)\" \
		--define:__OAUTH_CLIENT_SECRET__=\"$(OAUTH_CLIENT_SECRET)\" \
		--banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
	@# Package tarball
	mkdir -p releases
	tar -czf releases/flowspace-v$(VERSION).tar.gz \
		--exclude='.git' \
		--exclude='node_modules' \
		--exclude='src-tauri' \
		--exclude='.claude' \
		--exclude='releases' \
		--exclude='*.test.ts' \
		--exclude='*.test.tsx' \
		--exclude='__tests__' \
		--exclude='.env*' \
		--exclude='client_secret.json' \
		.
	@echo ""
	@echo "  Release tarball: releases/flowspace-v$(VERSION).tar.gz"
	@echo ""
	@# Publish to GitHub if gh CLI is available
	@if command -v gh &>/dev/null; then \
		echo "  Publishing to GitHub releases..."; \
		gh release create "v$(VERSION)" \
			--title "FlowSpace v$(VERSION)" \
			--notes "See CHANGELOG for details." \
			"releases/flowspace-v$(VERSION).tar.gz" || \
		gh release upload "v$(VERSION)" \
			"releases/flowspace-v$(VERSION).tar.gz" --clobber; \
		echo "  Published: v$(VERSION)"; \
	else \
		echo "  gh CLI not found — upload releases/flowspace-v$(VERSION).tar.gz to GitHub manually."; \
	fi

preview: tauri-sidecar build ## Rebuild & launch macOS app for local testing (no Apple subscription needed)
	mkdir -p "$(TAURI_TARGET_DIR)"
	xattr -cr src-tauri/resources || true
	rm -rf "$(TAURI_APP_PATH)"
	$(TAURI_ENV) APPLE_SIGNING_IDENTITY=- npx tauri build $(TAURI_BUILD_ARGS)
	xattr -cr "$(TAURI_APP_PATH)" || true
	@echo "Opening FlowSpace..."
	open "$(TAURI_APP_PATH)"
