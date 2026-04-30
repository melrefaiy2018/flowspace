<div align="center">
<img src="src-tauri/icons/app-icon.png" width="96" height="96" alt="FlowSpace" />

# FlowSpace

**Your Google Workspace, unified. Powered by an AI agent that can actually act.**

Drive · Gmail · Calendar · Tasks — in one proactive dashboard.  
An AI assistant with 23 tools that reads, writes, and acts across all your Google services.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-69%20passing-22c55e)](src)
[![Node](https://img.shields.io/badge/node-20%2B-lightgrey)](https://nodejs.org)

</div>

---

## What is FlowSpace?

FlowSpace is an open-source personal dashboard for Google Workspace. It surfaces everything that needs your attention — unread emails, upcoming meetings, overdue tasks, flagged items — in a single operational view, and pairs it with an AI chat agent that can actually do things: draft replies, create calendar events, summarize threads, find documents, and more.

It runs as a **local web app** with zero cloud infrastructure. Your data stays between your machine and Google's APIs.

**The AI agent is genuinely useful.** It uses tool-calling to read and write across your workspace. Write operations (send email, create event, edit doc) go through an explicit approval step before anything is sent — you always stay in control.

---

## Features

- **Proactive dashboard** — System context band shows briefing summary, active flags, next meeting, and source health at a glance. Clicking flags scrolls directly to the flagged items.
- **AI daily briefing** — Morning summary with attention items, meeting prep notes, reply priorities, and deadline alerts.
- **AI chat agent with 23 tools** — Streamed responses with structured result blocks. Tool categories:
  - *Read:* search Drive, read Gmail threads, fetch calendar events, list tasks, read Sheets ranges
  - *Write (approval-gated):* send email, create calendar events, write to Docs, append to Sheets, upload files
  - *Workflow:* standup report, meeting prep, weekly digest, email-to-task
- **Smart inbox triage** — AI-categorized emails: needs reply, needs input, FYI, can ignore. Per-email actions: draft reply, accept/reject meetings, create tasks.
- **Follow-up tracker** — Tracks commitments across Gmail and Calendar. Snooze, complete, or delete.
- **Dense operational layout** — KPI signal cards, attention panel, your-day schedule, inbox triage, and follow-ups in one scrollable canvas.
- **Zero GCP setup** — Google auth via the `gws` CLI. No OAuth project, no client secrets, no `.env` for auth.
- **Configurable AI provider** — OpenAI, Anthropic, OpenRouter, LM Studio, or any OpenAI-compatible endpoint. Set in the Settings UI.

---

## Getting Started

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **A Google account** (personal or Workspace)
- **An AI API key** — OpenAI, Anthropic, OpenRouter, or a local model (optional for read-only use)

### 1. Clone and install

```bash
git clone https://github.com/mohamedelrefaiy/flowspace.git
cd FlowSpace
make install
```

### 2. Start the dev server

```bash
make dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 3. Connect Google

Click **"Sign in with Google"** in the app. FlowSpace will:

1. Install the `gws` CLI if it isn't present
2. Open your browser for Google OAuth consent
3. Import credentials — you're in

No GCP project, no client secrets, no environment variables needed for auth.

### 4. Configure your AI provider

Go to **Settings → AI Provider**, choose your provider, and paste your API key. Supported providers:

| Provider | Where to get a key |
|---|---|
| OpenAI | [platform.openai.com](https://platform.openai.com) |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) |
| OpenRouter | [openrouter.ai](https://openrouter.ai) |
| LM Studio | Local — no key needed |

Settings are saved to `~/.flowspace/.llm-settings.json`. You can change providers at any time.

---

## Running in Production

To run FlowSpace as a persistent background server (e.g. on a home server or VPS):

```bash
make build   # Build the frontend
make prod    # Start the production server at localhost:3000
```

Or with Docker:

```bash
make docker      # Build the image
make docker-run  # Run on port 3000 with ~/.flowspace as data volume
```

---

## Commands

| Task | Command |
|---|---|
| Install dependencies | `make install` |
| Dev server (HMR) | `make dev` |
| Production build | `make build` |
| Production server | `make prod` |
| Run tests | `npm test` |
| Tests with coverage | `npm run test:coverage` |
| Type check | `make typecheck` |
| Kill port 3000 | `make kill` |
| Docker build | `make docker` |
| Docker run | `make docker-run` |

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Browser  (localhost:3000)              │
│  ┌─────────────────────────────────┐    │
│  │  React 19 Frontend              │    │
│  │  Tailwind CSS v4 · Framer Motion│    │
│  └──────────────┬──────────────────┘    │
│                 │ fetch                 │
│  ┌──────────────┴──────────────────┐    │
│  │  Express Server (Node.js)       │    │
│  │  ├─ Google APIs (googleapis)    │    │
│  │  ├─ AI Agent  (23 tools)        │    │
│  │  └─ gws CLI  (auth + exec)      │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

A single Express process serves both the API and the frontend. In dev mode, Vite middleware is mounted on it for HMR. In production it serves the built `dist/` directory.

## Project Structure

```
flowspace/
├── server.ts              # Express API (20+ endpoints, in-memory cache)
├── src/
│   ├── App.tsx            # Auth gate → main layout
│   ├── components/        # HomeDashboard, AttentionPanel, InboxTriage,
│   │                      # ChatThread, FollowupPanel, DraftQueue …
│   ├── agent/
│   │   ├── chat.ts        # Streaming tool-call loop (max 5 rounds)
│   │   ├── tools.ts       # 23 tool definitions
│   │   └── __tests__/
│   ├── lib/               # Triage heuristics, importance scoring, chat utils
│   │   └── __tests__/
│   ├── hooks/             # useWorkspaceData, useBriefing, useDrafts …
│   ├── context/           # ChatContext (open/close, history, triggerAction)
│   └── services/api.ts    # Typed fetch wrappers for all endpoints
├── Makefile               # Dev/build/deploy targets
└── CLAUDE.md              # AI assistant context for this codebase
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Tailwind CSS v4, Framer Motion, Lucide React |
| Server | Express.js, TypeScript, tsx |
| Google APIs | googleapis, google-auth-library |
| AI providers | OpenAI SDK (compatible with all providers) |
| Auth | `gws` CLI (`@googleworkspace/cli`) |
| Testing | Vitest, @vitest/coverage-v8 — 69 unit tests |
| Build | Vite 6, esbuild |

---

## Contributing

Contributions are welcome. The codebase is TypeScript throughout with a clean separation between the Express API, the AI agent, and the React frontend.

**Good places to start:**
- Add a new AI tool in `src/agent/tools.ts` — follow the existing pattern (define schema, implement handler, add to tool map)
- Improve triage heuristics in `src/lib/triage.ts`
- Add a new dashboard panel component under `src/components/`

**Before submitting a PR:**

```bash
make typecheck   # tsc --noEmit must pass
npm test         # All 69 tests must pass
```

Open an issue first for anything beyond a small fix so we can align before you invest the time.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

If FlowSpace saves you time, a ⭐ on GitHub goes a long way.

</div>
