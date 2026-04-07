# Implementation Plan: GWS CLI Auth Integration

**Branch**: `001-gws-auth-integration` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-gws-auth-integration/spec.md`

## Summary

Replace FlowSpace's custom OAuth sign-in (which requires users to create their own GCP project and configure client_id/secret) with `gws` CLI authentication. The `gws` CLI manages GCP project creation, OAuth consent, and encrypted credential storage. FlowSpace imports credentials via `gws auth export --unmasked`, eliminating all manual GCP setup for end users.

## Technical Context

**Language/Version**: TypeScript (Node.js 20+, React 19)
**Primary Dependencies**: Express.js, google-auth-library, googleapis, child_process (for gws CLI)
**Storage**: JSON files (`.gws-credentials.json`, `.tokens.json`) in `~/Library/Application Support/FlowSpace/`
**Testing**: Manual (no test framework configured)
**Target Platform**: macOS (Tauri desktop app) + browser (dev mode)
**Project Type**: Desktop app (Tauri + Express + React)
**Constraints**: gws CLI must be installed separately by user (npm -g or binary download)

## Constitution Check

*No constitution file found — skipping gate checks.*

## Project Structure

### Documentation (this feature)

```text
specs/001-gws-auth-integration/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Research findings
├── data-model.md        # Data model
├── quickstart.md        # Developer quickstart
└── contracts/
    └── api-endpoints.md # API contract
```

### Source Code (changes)

```text
server.ts                       # Modified: new gws auth functions + endpoints
src/services/api.ts             # Modified: new API methods for gws auth
src/components/AppRail.tsx      # Modified: updated sign-in button
src/components/ContextHeader.tsx # Modified: updated sign-in button
src/components/SignInScreen.tsx  # NEW: full-page auth gate
src/components/SignInModal.tsx   # NEW: auto-run gws auth state machine
```

## Implementation Phases

### Phase 1: Backend — GWS credential loading

**Goal**: FlowSpace server can load credentials from gws CLI at startup

Changes to `server.ts`:
1. Add `loadGwsCredentials()` — reads `.gws-credentials.json` from DATA_DIR, falls back to `execSync('gws auth export --unmasked')`
2. Modify `loadCredentials()` priority order:
   - First: try `.gws-credentials.json` (gws-imported)
   - Second: try `.tokens.json` + GOOGLE_CLIENT_ID/SECRET (existing OAuth)
   - Third: try ADC (dev fallback)
3. Store `authMethod: 'gws' | 'oauth' | 'adc'` alongside `authClient`

### Phase 2: Backend — New endpoints

**Goal**: Frontend can check gws status and trigger credential import

New endpoints:
1. `GET /api/auth/gws-status` — runs `which gws` and `gws auth status`, returns structured JSON
2. `POST /api/auth/gws-import` — runs `gws auth export --unmasked`, saves to `.gws-credentials.json`, creates OAuth2Client, fetches user profile
3. Modify `GET /api/auth/status` — add `auth_method` and `gws_available` fields

### Phase 3: Frontend — Sign-in UX

**Goal**: Users see a guided setup flow instead of broken OAuth redirect

Changes:
1. `SignInScreen` full-page auth gate — shown until authenticated
2. `SignInModal` state machine (checking → installing → login → polling → importing → success):
   - **Not installed**: auto-runs `POST /api/auth/gws-install`
   - **Not logged in**: auto-runs `POST /api/auth/gws-login` (opens browser for consent)
   - **Authenticated**: auto-runs `POST /api/auth/gws-import` to save credentials
   - User never opens Terminal — all gws commands run server-side via `execFile`
3. Poll `/api/auth/gws-status` between steps to track progress

### Phase 4: Cleanup & fallback

**Goal**: Clean separation between gws and legacy OAuth paths

1. Legacy `/auth/google` OAuth flow has been removed — gws is the only auth path (ADC fallback in dev only)
2. `.env` only needs `GLM_API_KEY` (no more GOOGLE_CLIENT_ID/SECRET)
3. Add gws detection to briefing startup log
4. Rebuild Tauri app + DMG

## Verification

1. Fresh install: no `.env`, no `.tokens.json` → sign-in shows GwsAuthGuide
2. User runs `gws auth login -s drive,gmail,calendar,tasks` → status endpoint detects auth
3. Click "Connect to FlowSpace" → credentials imported, user signed in
4. Restart app → credentials auto-loaded from `.gws-credentials.json`
5. Legacy OAuth flow has been removed — gws is the only auth path (ADC fallback in dev only)
6. Token refresh: after 1 hour, API calls still work (auto-refresh via refresh_token)
