# Tasks: GWS CLI Auth Integration

**Input**: Design documents from `/specs/001-gws-auth-integration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-endpoints.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create the bundled client_secret.json and prepare gws config infrastructure

- [x] T001 Create bundled client_secret.json file at src-tauri/resources/client_secret.json with FlowSpace's OAuth client credentials in Google "installed" app format
- [x] T002 Add `src-tauri/resources/client_secret.json` to tauri.conf.json `bundle.resources` so it ships with the app
- [x] T003 Add `GwsStatus`, `GwsCredentials` TypeScript interfaces to src/services/api.ts matching data-model.md entities

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core gws utility functions in server.ts that all endpoints depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Add `GWS_CREDENTIALS_PATH` constant (`path.join(DATA_DIR, '.gws-credentials.json')`) and `GWS_CLIENT_SECRET_PATH` constant (`~/.config/gws/client_secret.json`) to server.ts
- [x] T005 Add `ensureGwsClientSecret()` function in server.ts that copies bundled client_secret.json to `~/.config/gws/client_secret.json` if not already present (creates `~/.config/gws/` directory if needed)
- [x] T006 Add `checkGwsInstalled()` function in server.ts that runs `which gws` via `execSync`, returns boolean
- [x] T007 Add `checkGwsAuthStatus()` function in server.ts that runs `gws auth status` via `execSync`, parses JSON output, returns `GwsStatus` object per data-model.md
- [x] T008 Add `exportGwsCredentials()` function in server.ts that runs `gws auth export --unmasked` via `execSync`, parses JSON, returns `GwsCredentials` object
- [x] T009 Add `installGws()` async function in server.ts that runs `npm install -g @googleworkspace/cli` via `exec`, returns Promise<boolean>
- [x] T010 Add `runGwsAuthLogin()` async function in server.ts that runs `gws auth login -s drive,gmail,calendar,tasks` via `exec` (non-blocking, opens browser), returns Promise with child process handle
- [x] T011 Add `authMethod` module-level variable (`'gws' | 'oauth' | 'adc' | null`) alongside existing `authClient` in server.ts

**Checkpoint**: All gws utility functions available — endpoint and credential loading work can begin

---

## Phase 3: User Story 1 — GWS Credential Loading at Startup (Priority: P1) 🎯 MVP

**Goal**: FlowSpace server can load credentials from gws at startup, eliminating the need for GOOGLE_CLIENT_ID/SECRET in .env

**Independent Test**: Start server with no .env and no .tokens.json but with gws authenticated → server logs "Loaded gws credentials" and `GET /api/auth/status` returns `authenticated: true`

### Implementation for User Story 1

- [x] T012 [US1] Add `loadGwsCredentials()` function in server.ts that reads `.gws-credentials.json` from DATA_DIR, creates OAuth2Client with client_id/client_secret/refresh_token, returns OAuth2Client or null
- [x] T013 [US1] Modify `loadCredentials()` in server.ts to try gws credentials FIRST: (1) `loadGwsCredentials()` → set authMethod='gws', (2) existing .tokens.json+env OAuth → set authMethod='oauth', (3) ADC fallback → set authMethod='adc'
- [x] T014 [US1] Modify `GET /api/auth/status` endpoint in server.ts to include `auth_method` field from authMethod variable and `gws_available` field from `checkGwsInstalled()` per contracts/api-endpoints.md
- [x] T015 [US1] Update `AuthStatus` interface in src/services/api.ts to add `auth_method: 'gws' | 'oauth' | 'adc' | null` and `gws_available: boolean` fields

**Checkpoint**: Server auto-loads gws credentials at startup. Auth status endpoint reports method used.

---

## Phase 4: User Story 2 — Backend GWS Auth Endpoints (Priority: P2)

**Goal**: Frontend can check gws status, trigger install, trigger login, and import credentials — all via API

**Independent Test**: Call `GET /api/auth/gws-status` → returns installed/authenticated state. Call `POST /api/auth/gws-import` → credentials saved to `.gws-credentials.json` and auth becomes active.

### Implementation for User Story 2

- [x] T016 [US2] Add `GET /api/auth/gws-status` endpoint in server.ts: calls `checkGwsInstalled()` + `checkGwsAuthStatus()`, returns GwsStatus JSON per contracts/api-endpoints.md
- [x] T017 [US2] Add `POST /api/auth/gws-install` endpoint in server.ts: calls `ensureGwsClientSecret()` then `installGws()`, returns `{ success: boolean, error?: string }`
- [x] T018 [US2] Add `POST /api/auth/gws-login` endpoint in server.ts: calls `ensureGwsClientSecret()` then `runGwsAuthLogin()`, returns `{ success: true, message: "Browser opened for sign-in" }`
- [x] T019 [US2] Add `POST /api/auth/gws-import` endpoint in server.ts: calls `exportGwsCredentials()`, saves to GWS_CREDENTIALS_PATH, creates OAuth2Client, sets authClient + authMethod='gws', fetches user profile via oauth2.userinfo.get(), returns `{ success: true, user: UserProfile }` per contracts/api-endpoints.md
- [x] T020 [P] [US2] Add `getGwsStatus()`, `installGws()`, `triggerGwsLogin()`, `importGwsCredentials()` API methods to src/services/api.ts

**Checkpoint**: All backend endpoints for the sign-in flow are functional. Can be tested with curl.

---

## Phase 5: User Story 3 — Sign-in Modal UI (Priority: P3)

**Goal**: User clicks "Sign in with Google" → polished modal handles entire flow automatically (install → client config → login → import)

**Independent Test**: Open app unauthenticated → click sign-in → modal appears → completes all steps → user is signed in with avatar shown

### Implementation for User Story 3

- [x] T021 [US3] Create src/components/SignInModal.tsx: polished centered modal with backdrop blur, animated FlowSpace logo (pulse animation using motion), single status line, error state with "Try again" button. Props: `isOpen`, `onClose`, `onSuccess(user: UserProfile)`
- [x] T022 [US3] Implement sign-in orchestration logic in SignInModal.tsx: sequential async flow that (1) checks gws status via `getGwsStatus()`, (2) auto-installs if needed via `installGws()`, (3) triggers login via `triggerGwsLogin()`, (4) polls `getGwsStatus()` every 2s until authenticated, (5) imports via `importGwsCredentials()`. Update status line at each step per spec Sign-in Modal UX section
- [x] T023 [US3] Replace sign-in `<button>` in src/components/AppRail.tsx: remove existing gws/oauth sign-in logic, add state for modal open/close, render `<SignInModal>` when open, call `onRefresh` on success
- [x] T024 [US3] Replace sign-in `<button>` in src/components/ContextHeader.tsx: remove existing gws/oauth sign-in logic, add state for modal open/close, render `<SignInModal>` when open, call `onRefresh` on success
- [x] T025 [US3] Add success animation to SignInModal.tsx: after import completes, show green checkmark animation, user avatar (if available), and "Welcome to FlowSpace!" text for 1.5s before auto-closing

**Checkpoint**: Full sign-in flow works end-to-end from the UI. Non-technical user can sign in with one click + browser approval.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Clean up legacy code, rebuild production app

- [x] T026 Remove legacy `/auth/google` OAuth routes and `/auth/google/callback` from server.ts (gws is now the only auth path)
- [x] T027 Remove `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` references from server.ts `loadCredentials()` (keep ADC fallback for dev only)
- [x] T028 [P] Update `.env.example` to remove GOOGLE_CLIENT_ID/SECRET entries and document that auth is handled by gws CLI
- [x] T029 [P] Remove `getAuthUrl()` method and legacy OAuth sign-in polling logic from src/services/api.ts
- [ ] T030 Rebuild server bundle with `make tauri-sidecar` and rebuild Tauri app with `npx tauri build` to verify production build works
- [ ] T031 Create DMG with `make tauri-build` and test fresh install sign-in flow on clean machine (or fresh user account)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T001 (client_secret.json) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 completion
- **US2 (Phase 4)**: Depends on Phase 2 completion. Can run in parallel with US1
- **US3 (Phase 5)**: Depends on US2 (needs API endpoints)
- **Polish (Phase 6)**: Depends on US3 completion

### User Story Dependencies

- **US1 (Credential Loading)**: Independent — can start after Phase 2
- **US2 (Auth Endpoints)**: Independent — can start after Phase 2, parallel with US1
- **US3 (Sign-in Modal)**: Depends on US2 (needs API endpoints to call)

### Within Each User Story

- Utility functions before endpoints
- Endpoints before frontend components
- Backend types before frontend API methods

### Parallel Opportunities

- T001, T002, T003 can all run in parallel (Phase 1)
- T006, T007, T008, T009, T010 can run in parallel (different functions)
- T012 and T015 can run in parallel (different files)
- T016, T017, T018, T019 are sequential (same file, related logic)
- T020 can run in parallel with T016–T019 (different file)
- T023 and T024 can run in parallel (different files)

---

## Parallel Example: Phase 2

```bash
# These foundational functions are independent and can be written in parallel:
Task T006: "checkGwsInstalled() in server.ts"
Task T007: "checkGwsAuthStatus() in server.ts"
Task T008: "exportGwsCredentials() in server.ts"
Task T009: "installGws() in server.ts"
Task T010: "runGwsAuthLogin() in server.ts"
# Note: all are in the same file but independent functions — can be written sequentially fast
```

## Parallel Example: User Story 3

```bash
# Frontend components in different files:
Task T023: "Update AppRail.tsx sign-in button"
Task T024: "Update ContextHeader.tsx sign-in button"
# These can be done in parallel after T021-T022 (SignInModal) is complete
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T011)
3. Complete Phase 3: US1 — Credential Loading (T012–T015)
4. **STOP and VALIDATE**: `gws auth export --unmasked` → credentials exist → restart server → `GET /api/auth/status` returns authenticated

### Incremental Delivery

1. Setup + Foundational → gws utilities ready
2. US1 → Server auto-loads gws credentials → Validate with curl
3. US2 → All auth endpoints available → Validate with curl
4. US3 → Full sign-in UI working → Validate in app
5. Polish → Remove legacy code, rebuild production app

---

## Notes

- All gws CLI calls use `execSync` (blocking) for status checks and `exec` (non-blocking) for install/login
- `ensureGwsClientSecret()` must run before any gws auth commands — it provides the OAuth app identity
- The sign-in modal blocks app interaction during the flow to prevent race conditions
- Token auto-refresh is handled by google-auth-library's OAuth2Client via the refresh_token — no custom refresh logic needed
