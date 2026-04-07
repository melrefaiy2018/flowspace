# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## gstack

Use the `/browse` skill from gstack for all web browsing.

Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
- `/plan-ceo-review`
- `/plan-eng-review`
- `/review`
- `/ship`
- `/browse`
- `/qa`
- `/qa-only`
- `/setup-browser-cookies`
- `/retro`

## What is FlowSpace

FlowSpace is a personal Google Workspace dashboard (React 19 + Express + Vite) that shows live data from Drive, Gmail, Calendar, and Tasks. It includes an AI chat agent powered by configurable LLM providers (OpenAI, Anthropic, OpenRouter, LM Studio, or any OpenAI-compatible endpoint) that can read/write across all Google services using tool-calling. Ships as a native macOS app via Tauri v2.

## Commands

| Task | Command |
|------|---------|
| Install deps | `make install` (or `npm ci`) |
| Dev server (Express + Vite HMR) | `make dev` (or `npm run dev`) |
| Production build | `make build` |
| Production server | `make prod` |
| Type check | `make typecheck` (or `npm run lint`) |
| Kill port 3000 | `make kill` |
| Tauri dev | `npm run tauri dev` |
| Tauri build (app + dmg) | `npm run tauri build` |
| Docker build + run | `make docker && make docker-run` |

| Run tests | `npm test` (or `npx vitest run`) |
| Run tests (watch) | `npm run test:watch` |
| Run tests (coverage) | `npm run test:coverage` |

Tests use **Vitest** with `@vitest/coverage-v8`. Test files live in `__tests__/` directories adjacent to source. There is no linter beyond `tsc --noEmit`.

## Architecture

### Two-layer server (server.ts)

`server.ts` is a single Express server that serves both the API and the frontend:
- **Dev mode**: Vite dev server is mounted as Express middleware (HMR via WebSocket)
- **Prod mode**: Express serves the frontend from `http://localhost:3000` (Tauri WebView connects to it)

### Tauri macOS app (src-tauri/)

- `lib.rs` spawns the Express server as a child process via Tauri shell plugin, polls TCP port 3000 until ready, then opens the WebView.
- PATH is augmented with `/opt/homebrew/bin`, `/usr/local/bin`, etc. to find `node` and `gws` in macOS `.app` bundles.
- `tauri.conf.json` bundles `server.mjs`, `dist/`, and `client_secret.json` as resources. Targets: `app` + `dmg`.

### Authentication flow

Two auth paths, tried in order:
1. **gws CLI credentials** (primary) — User signs in via the app's "Sign in with Google" button, which orchestrates `gws auth login`. Credentials are exported via `gws auth export --unmasked` and saved to `.gws-credentials.json` in `DATA_DIR`.
2. **ADC fallback** (dev-only) — reads `~/.config/gcloud/application_default_credentials.json`.

Auth state is held in module-level `authClient` and `authMethod` variables. Google API clients (Drive, Gmail, Calendar, Tasks) are created lazily via helper functions that call `getAuthClient()`.

`DATA_DIR` is `~/Library/Application Support/FlowSpace/` in production, or the project root in dev mode.

### API endpoints (server.ts)

All endpoints use a 60-second in-memory cache. Key routes:
- `/api/auth/status` — check auth + user profile
- `/api/auth/gws-status` — check gws CLI install & auth state
- `/api/auth/gws-install` — install gws CLI globally via npm
- `/api/auth/gws-login` — trigger `gws auth login` (opens browser)
- `/api/auth/gws-import` — export gws creds and save to disk
- `/api/auth/logout` — clear auth state + run `gws auth logout`
- `/api/stats` — aggregated workspace stats (parallel Google API calls)
- `/api/drive/recent`, `/api/gmail/recent`, `/api/calendar/upcoming` — service-specific data
- `/api/activity/recent` — merged activity feed across Drive/Gmail/Calendar
- `/api/briefing` — AI-generated daily briefing (cached 10 min)
- `/api/followups`, `/api/followups/:taskId/complete|snooze|delete` — follow-up tracker
- `/api/draft-reply`, `/api/send-reply` — email drafting and sending
- `/api/create-doc` — create Google Docs
- `/api/chat` — AI chat (provider configured via Settings UI)

### AI chat agent (src/agent/)

- `chat.ts` — OpenAI-compatible client with configurable provider (any OpenAI-compatible endpoint, Anthropic, or Claude Code CLI). Implements a tool-calling loop (max 5 rounds).
- `tools.ts` — 23 tool definitions: 14 core tools (search_drive, send_email, create_calendar_event, etc.), 4 workflow tools (standup_report, meeting_prep, weekly_digest, email_to_task), and 9 gws skill-based tools split into two tiers. Tier 1: calendar_agenda (rich agenda with attendees/linked docs), gmail_triage (AI-bucketed inbox), sheets_read (cell ranges), docs_write (append/replace). Tier 2: sheets_append, drive_upload, review_overdue_tasks, save_email_to_doc. Write tools (docs_write, sheets_append, drive_upload, save_email_to_doc) go through the approval flow. All tools execute via `gws` CLI subprocess (`execFile`, not shell) with an access token passed via env var.

### Frontend (src/)

- **Entry**: `main.tsx` → `App.tsx` — auth gate (shows `SignInScreen` until authenticated, then `AppInner`)
- **Layout**: `AppRail` (sidebar with nav + user section), `ContextHeader` (greeting + AI briefing), main content area with `YourDayPanel`, `AttentionPanel`, `InboxTriage`, `FollowupPanel`
- **Sign-in**: `SignInScreen` (full-page gate) + `SignInModal` (state machine: checking → installing → login → polling → importing → success)
- **State**: `context/ChatContext.tsx` — chat panel open/close, message history, `triggerAction()` for inline action buttons
- **Data**: `hooks/useWorkspaceData.ts` — generic `useApiData<T>` hook with loading/error states; `hooks/useBriefing.ts` — briefing data hook; `services/api.ts` — typed fetch wrappers for all API endpoints
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite` plugin), CSS custom properties for theming in `index.css`
- **Animations**: `motion` (Framer Motion) for page transitions
- **Logo**: `FlowSpaceLogo.tsx` — reusable SVG component from `logo.svg`

### Path alias

`@/` maps to the project root (configured in both `tsconfig.json` and `vite.config.ts`).

## Environment variables

Optional in `.env` (or `.env.local`):
- `GLM_API_KEY` — deprecated; LLM provider is now configured via the Settings UI
- `GEMINI_API_KEY` — exposed to frontend via Vite `define` (legacy, may be unused)

Google auth is handled by the gws CLI — no `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` needed.

## Active Technologies
- TypeScript (Node.js 20+, React 19) + Express.js, google-auth-library, googleapis, child_process (for gws CLI)
- Tauri v2 with shell plugin for macOS desktop app
- Vite 6, Tailwind CSS v4, Framer Motion (motion), Lucide React
- Vitest + @vitest/coverage-v8 for unit testing
- In-memory cache (server.ts), Google Tasks API, `.followup-state.json` in DATA_DIR
- JSON files (`.gws-credentials.json`, `.tokens.json`) in `~/Library/Application Support/FlowSpace/`
