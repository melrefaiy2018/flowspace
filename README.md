<div align="center">
<img src="src-tauri/icons/app-icon.png" width="128" height="128" alt="FlowSpace icon" />

# FlowSpace

**A native macOS dashboard for Google Workspace with an AI assistant**

Drive, Gmail, Calendar, and Tasks in one view — powered by an AI agent that can read, write, and act across all your Google services.

Built with React 19 + Express + Tauri v2

</div>

---

## Features

- **Unified dashboard** — Smart calendar (now/soon/later grouping), priority inbox, recent files, and follow-ups in a single view
- **AI daily briefing** — Auto-generated morning summary with attention items, meeting prep notes, and deadline alerts
- **AI chat agent** — 23 tools across Drive, Gmail, Calendar, Tasks, and Sheets. Streamed responses with structured result blocks (agenda cards, triage buckets, sheet tables, email details). Write actions require explicit approval before execution
- **Smart inbox triage** — AI-categorized emails with per-email actions: draft reply, accept/reject meetings, create tasks, approve requests. Heuristic fallback when AI is unavailable
- **Follow-up tracker** — Tracks commitments across Gmail and Calendar with snooze, complete, and delete
- **Collapsible sidebar** — Icon-only rail mode to maximize workspace, with full-width expansion on hover
- **Resizable chat panel** — Drag to resize, persistent chat history across sessions
- **Native macOS app** — Lightweight Tauri v2 window (not Electron), with `.app` and `.dmg` builds
- **Zero GCP setup** — Sign in with Google via the `gws` CLI. No project creation, no client secrets, no `.env` configuration for auth
- **Tested** — 69 unit tests via Vitest covering agent logic, triage heuristics, chat utilities, and message normalization

## Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri v2 (Rust)                            │
│  ┌────────────────────────────────────────┐ │
│  │  WKWebView                             │ │
│  │  ┌──────────────────────────────────┐  │ │
│  │  │  React 19 Frontend               │  │ │
│  │  │  (Tailwind CSS v4, Framer Motion)│  │ │
│  │  └──────────┬───────────────────────┘  │ │
│  └─────────────┼──────────────────────────┘ │
│                │ fetch → localhost:3000     │
│  ┌─────────────┴──────────────────────────┐ │
│  │  Express Server (Node.js sidecar)      │ │
│  │  ├─ Google APIs (Drive, Gmail, Cal)    │ │
│  │  ├─ AI Agent ( 23 tools)               │ │
│  │  └─ gws CLI (auth + tool execution)    │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

The Tauri shell launches Express as a child process, then opens a native WebView pointing at `localhost:3000`. The frontend and server are identical in both desktop and browser modes.

## Getting Started

### Prerequisites

- **Node.js** 20+
- **Rust** toolchain (for Tauri builds): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### Install and Run

```bash
# Clone and install
git clone https://github.com/melrefaiy2018/FlowSpace.git
cd FlowSpace
make install

# Run in browser (dev mode with HMR)
make dev

# Run as native macOS app
make tauri-dev
```

Open `http://localhost:3000` (browser) or the FlowSpace window will appear automatically (Tauri).

### Sign In

Click **"Sign in with Google"** — the app handles everything automatically:
1. Installs the `gws` CLI if needed
2. Opens your browser for Google consent
3. Imports credentials — you're in

No GCP project, no client secrets, no environment variables needed for auth.

### Environment Variables

Create a `.env` file in the project root:

```env
API_KEY=your-ai-api-key    # Required for AI chat agent
```

Google auth is handled entirely by the `gws` CLI — no `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` needed.

## Commands

| Task | Command |
|------|---------|
| Install deps | `make install` |
| Dev server (browser) | `make dev` |
| Native macOS app (dev) | `make tauri-dev` |
| Build signed/notarized macOS `.app` + `.dmg` | `make tauri-build` |
| Build local-only ad-hoc macOS `.app` + `.dmg` | `make tauri-build-local` |
| Production build (web) | `make build` |
| Run tests | `npm test` |
| Run tests (watch mode) | `npm run test:watch` |
| Run tests (with coverage) | `npm run test:coverage` |
| Type check | `make typecheck` |
| Kill port 3000 | `make kill` |
| Generate app icons | `make tauri-icons` |
| Docker build + run | `make docker && make docker-run` |

### macOS Distribution

If you plan to send the app to another Mac, you must build a signed and notarized release. Ad-hoc or unsigned builds commonly show up as "is damaged" after download.

Recommended release command:

```bash
make tauri-build TAURI_BUILD_TARGET=universal-apple-darwin
```

Required environment variables before `make tauri-build`:

```bash
# Developer ID signing certificate name from `security find-identity -v -p codesigning`
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Notarization via App Store Connect API key (recommended)
export APPLE_API_KEY="ABC123XYZ"
export APPLE_API_KEY_PATH="$HOME/.private_keys/AuthKey_ABC123XYZ.p8"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"

# Alternative notarization auth (Apple ID flow)
# export APPLE_ID="name@example.com"
# export APPLE_PASSWORD="app-specific-password"
# export APPLE_TEAM_ID="TEAMID"
```

Notes:

- `make tauri-build` now expects a distributable build and will fail fast if signing or notarization credentials are missing.
- In CI you can provide `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` instead of `APPLE_SIGNING_IDENTITY`.
- `make tauri-build-local` is for local testing only. Do not share those artifacts.
- `TAURI_BUILD_TARGET=universal-apple-darwin` is recommended for distribution so the same app can run on both Apple Silicon and Intel Macs.
- `make tauri-build` automatically runs a post-build Gatekeeper verification step.

### Install for Testers

If you do not have an Apple Developer account, use this flow for trusted testers only.

Build the local macOS app:

```bash
make tauri-build-local TAURI_BUILD_TARGET=universal-apple-darwin
```

After the build finishes:

- Tauri build artifacts are written to `~/Library/Caches/FlowSpace/tauri-target/`.
- If a DMG was created, find it in [`~/Library/Caches/FlowSpace/tauri-target/release/bundle/dmg/`](~/Library/Caches/FlowSpace/tauri-target/release/bundle/dmg)
- If no DMG was created, use the app bundle in [`~/Library/Caches/FlowSpace/tauri-target/release/bundle/macos/FlowSpace.app`](~/Library/Caches/FlowSpace/tauri-target/release/bundle/macos/FlowSpace.app) and zip it:

```bash
cd ~/Library/Caches/FlowSpace/tauri-target/release/bundle/macos
ditto -c -k --sequesterRsrc --keepParent FlowSpace.app FlowSpace.app.zip
```

Tester install steps:

1. Download the DMG or ZIP file.
2. If it is a ZIP, unzip it first.
3. Move `FlowSpace.app` into `Applications`.
4. Open `Terminal` and run:

```bash
xattr -dr com.apple.quarantine /Applications/FlowSpace.app
```

5. Launch the app:

```bash
open /Applications/FlowSpace.app
```

If macOS still blocks the app:

1. Open `System Settings`.
2. Go to `Privacy & Security`.
3. Scroll to the security warning for `FlowSpace`.
4. Click `Open Anyway`.

### Google Sign-In Troubleshooting

If Google sign-in fails with a `gws auth login` error, verify that the bundled OAuth client file is present:

```bash
cat /Applications/FlowSpace.app/Contents/Resources/client_secret.json
```

The file should include a real `project_id` value. If the app bundle is correct but `gws` still reports:

```text
client_config_error: "Invalid client_secret.json format: missing field `project_id` ..."
```

the tester machine is still using a stale per-user config at `~/.config/gws/client_secret.json`.

Replace it with the bundled file:

```bash
rm -f ~/.config/gws/client_secret.json
mkdir -p ~/.config/gws
cp /Applications/FlowSpace.app/Contents/Resources/client_secret.json ~/.config/gws/client_secret.json
```

Then verify the gws config and retry login:

```bash
/Applications/FlowSpace.app/Contents/Resources/gws auth status --json
/Applications/FlowSpace.app/Contents/Resources/gws auth login -s drive,gmail,calendar,tasks,userinfo.email,userinfo.profile
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust, WKWebView) |
| Frontend | React 19, Tailwind CSS v4, Framer Motion, Lucide React |
| Server | Express.js, TypeScript, tsx |
| Google APIs | googleapis, google-auth-library |
| AI | Multi-provider (OpenAI, Anthropic, OpenRouter, custom) |
| Auth | gws CLI (`@anthropic-ai/gws`) |
| Testing | Vitest, @vitest/coverage-v8 |
| Build | Vite 6, esbuild (server bundle) |

## Project Structure

```
flowspace/
├── server.ts              # Express API server (20+ endpoints)
├── server.prod.ts         # Production entry point
├── src/
│   ├── App.tsx            # Main app with auth gate
│   ├── components/        # UI: YourDayPanel, InboxTriage, FollowupPanel, ChatThread...
│   ├── agent/             # AI chat agent (chat.ts, tools.ts — 23 tool definitions)
│   │   └── __tests__/     # Agent unit tests (chat, tools)
│   ├── context/           # React context (ChatContext)
│   ├── hooks/             # useWorkspaceData, useBriefing
│   ├── lib/               # Pure logic: triage heuristics, chat utilities
│   │   └── __tests__/     # Lib unit tests (triage, chat-utils)
│   ├── shared/            # Shared types (chat.ts — ToolEvent, ApprovalRequest, etc.)
│   └── services/          # Typed API client (api.ts)
├── src-tauri/
│   ├── src/lib.rs         # Tauri setup: spawn Express, manage lifecycle
│   ├── tauri.conf.json    # Window config, bundle settings, CSP
│   └── capabilities/      # Shell permissions for sidecar
├── specs/                 # Feature specs, plans, and task breakdowns
├── Makefile               # Dev/build/deploy commands
└── CLAUDE.md              # AI coding assistant instructions
```

## License

MIT
