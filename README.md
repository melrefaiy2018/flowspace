<div align="center">

# FlowSpace

**Your Google Workspace, in one tab — with an AI assistant that can actually do things.**

Drive, Gmail, Calendar, and Tasks in a single dashboard. Ask the AI to draft replies, schedule meetings, find files, or summarize your week — and it will.

```bash
curl -fsSL https://raw.githubusercontent.com/melrefaiy2018/flowspace/main/install.sh | bash
```

</div>

---

## What it does

- **Unified dashboard** — Calendar (now/soon/later), priority inbox, recent Drive files, and follow-up tracker in one view
- **AI daily briefing** — Morning summary with attention items, meeting prep, and deadline alerts
- **AI chat agent** — 23 tools across Drive, Gmail, Calendar, Tasks, and Sheets. Write actions (send email, create event, edit doc) require your explicit approval before executing
- **Smart inbox triage** — AI-categorized emails with inline actions: draft reply, accept/reject meetings, create tasks
- **Follow-up tracker** — Tracks commitments from Gmail and Calendar with snooze, complete, and delete

## Requirements

- **Node.js 20+**
- A **Google Cloud project** with OAuth credentials (free, takes ~5 minutes — instructions below)
- An **AI API key** (optional — the dashboard works without it)

## Quickstart

```bash
curl -fsSL https://raw.githubusercontent.com/melrefaiy2018/flowspace/main/install.sh | bash
```

Then run:

```bash
flowspace
```

On first run, a setup wizard walks you through:
1. Connecting your Google account (you'll need your `client_secret.json` — see below)
2. Choosing an AI provider (OpenAI, Anthropic, OpenRouter, LM Studio, or custom)

Then it opens `http://localhost:3000` in your browser.

After setup, `flowspace` starts immediately — no wizard.

## Google sign-in setup

FlowSpace uses your own Google Cloud project so your data goes directly between your machine and Google — no intermediary server.

You'll need a `client_secret.json` file from GCP. This is a one-time step.

**Steps (~5 minutes):**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (e.g., "FlowSpace")
2. Enable these APIs: **Google Drive**, **Gmail**, **Google Calendar**, **Tasks**
   - APIs & Services → Library → search each one → Enable
3. Configure the OAuth consent screen:
   - APIs & Services → OAuth consent screen
   - Choose **External**, fill in an app name (e.g., "FlowSpace")
   - Add your own email as a **test user**
   - No need to publish — test mode is fine for personal use
4. Create OAuth credentials:
   - APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   - Application type: **Desktop app**
   - Download the JSON file (it will be named `client_secret_*.json`)
5. Run `flowspace` and enter the path to that file when prompted

When you click **Sign in with Google** in the app, it opens your browser for Google's standard consent screen and stores the tokens locally at `~/.flowspace/`. Nothing goes to any external server.

## AI providers

The AI assistant is optional. Configure it during setup or later in the Settings panel.

| Provider | Notes |
|----------|-------|
| OpenAI | GPT-4o, GPT-4 |
| Anthropic | Claude |
| OpenRouter | Access to many models with one key |
| LM Studio | Local models, no API key needed |
| Custom | Any OpenAI-compatible endpoint |

The dashboard works without an AI key — you just won't have the chat agent or AI briefing.

## CLI reference

```bash
flowspace              # Start (runs setup on first use)
flowspace setup        # Re-run the setup wizard
flowspace doctor       # Check system health
flowspace --port 8080  # Use a custom port (default: 3000)
flowspace --version    # Show version
```

## Self-hosting / development

```bash
git clone https://github.com/melrefaiy2018/flowspace.git
cd flowspace
npm install
npm run dev       # Dev server with HMR at http://localhost:3000
npm test          # Run tests
npm run typecheck # Type check
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Framer Motion, Lucide React |
| Server | Express.js, TypeScript |
| Google APIs | googleapis, google-auth-library |
| AI | OpenAI-compatible client (any provider) |
| Build | Vite 6, esbuild |
| Testing | Vitest (69 unit tests) |

## Troubleshooting

**`flowspace doctor`** checks your setup and tells you what's wrong.

**Google sign-in fails:** Make sure you added your email as a test user in the OAuth consent screen, and that you enabled all four APIs (Drive, Gmail, Calendar, Tasks).

**Port 3000 in use:** The CLI will ask to kill the existing process or pick a different port.

**Re-run setup:** `flowspace setup` walks through configuration again without losing existing settings.

## License

MIT
