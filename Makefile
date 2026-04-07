.PHONY: help install dev build prod clean typecheck kill docker docker-run docker-stop tauri-dev tauri-sidecar tauri-build tauri-build-local tauri-verify-macos tauri-icons

PORT  ?= 3000
IMAGE ?= flowspace

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

docker: ## Build Docker image
	docker build -t $(IMAGE) .

docker-run: ## Run container (pass .env and ADC credentials)
	docker run --rm -it \
		-p $(PORT):3000 \
		--env-file .env \
		-v $(HOME)/.config/gcloud:/root/.config/gcloud:ro \
		--name flowspace \
		$(IMAGE)

docker-stop: ## Stop running container
	docker stop flowspace 2>/dev/null || true

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
	npx esbuild server.prod.ts --bundle --platform=node --format=esm --outfile=dist-server/server.mjs --external:vite --external:lightningcss --target=node20 --define:__FLOWSPACE_VERSION__=\"$(shell node -p "require('./package.json').version")\" --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

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
