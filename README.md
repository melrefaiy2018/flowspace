<div align="center">
<img src="src-tauri/icons/app-icon.png" width="96" height="96" alt="FlowSpace" />

# FlowSpace

**Your Google Workspace, unified. Powered by an AI agent that can actually act.**

Drive · Gmail · Calendar · Tasks — in one proactive dashboard.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-69%20passing-22c55e)](src)
[![Node](https://img.shields.io/badge/node-20%2B-lightgrey)](https://nodejs.org)

</div>

---

## App Preview

<p align="center">
  <img src="docs/assets/readme/dashboard.png" alt="FlowSpace home dashboard with meeting prep and assistant delegation" width="100%" />
</p>

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/readme/mail.png" alt="FlowSpace smart mail workspace" />
    </td>
    <td width="50%">
      <img src="docs/assets/readme/tasks.png" alt="FlowSpace task board and task detail view" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Smart mail workspace</strong></td>
    <td align="center"><strong>Task board</strong></td>
  </tr>
  <tr>
    <td colspan="2">
      <img src="docs/assets/readme/calendar.png" alt="FlowSpace calendar timeline" />
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center"><strong>Calendar timeline</strong></td>
  </tr>
</table>

---

## What is FlowSpace?

FlowSpace is an open-source personal dashboard for Google Workspace. It surfaces everything that needs your attention — emails, meetings, overdue tasks, flagged items — in one operational view, paired with an AI agent that can actually do things.

It runs as a **local web app** with zero cloud infrastructure. Your data stays between your machine and Google's APIs. Note that prompts sent to the AI provider (OpenAI, Anthropic, etc.) are processed by that provider — choose one you trust.

---

## Features

- **Proactive dashboard** — Briefing summary, active flags, next meeting, and source health at a glance. Clicking flags scrolls directly to flagged items.
- **AI daily briefing** — Morning summary with attention items, meeting prep notes, reply priorities, and deadline alerts.
- **AI chat agent with 23 tools** — Streamed responses with structured result blocks:
  - *Read:* search Drive, read Gmail threads, fetch calendar events, list tasks, read Sheets ranges
  - *Write (approval-gated):* send email, create calendar events, write to Docs, append to Sheets, upload files
  - *Workflow:* standup report, meeting prep, weekly digest, email-to-task
- **Smart inbox triage** — AI-categorized emails: needs reply, needs input, FYI, can ignore. Per-email actions: draft reply, accept/reject meetings, create tasks.
- **Follow-up tracker** — Tracks commitments across Gmail and Calendar. Snooze, complete, or delete.
- **Configurable AI provider** — OpenAI, Anthropic, OpenRouter, LM Studio, or any OpenAI-compatible endpoint. Set in the Settings UI.

### What you can ask the agent

- *"Reply to Sarah's email about Q4 budget — say we're on track"*
- *"Find the project proposal doc from last week"*
- *"Schedule a 30-min sync with the team next Tuesday afternoon"*
- *"Summarize my unread threads and flag anything that needs a reply today"*
- *"Create a task: follow up with legal by Friday"*

Write operations always show an approval step before anything is sent or saved.

---

## Getting Started

> **Early beta:** FlowSpace is actively evolving. Google sign-in works out of the box for all users — no setup required.

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **A Google account** (personal or Workspace)
- **An AI API key** — OpenAI, Anthropic, OpenRouter, or a local model (optional for read-only use)
- **Platform:** Tested on macOS. Linux should work. Windows requires WSL.

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/mohamedelrefaiy/flowspace/main/install.sh | bash
```

Then run in the terminal:

```bash
flowspace
```

FlowSpace opens at **[http://localhost:3000](http://localhost:3000)** and walks you through first-time setup.

### Connect Google

Click **"Sign in with Google"** in the app. FlowSpace will:

1. Install the `gws` CLI if it isn't present
2. Open your browser for Google OAuth consent
3. Import credentials — you're in

No GCP project, no client secrets, no environment variables needed for auth.

### Configure your AI provider

Go to **Settings → AI Provider**, choose your provider, and paste your API key:

| Provider | Where to get a key |
|---|---|
| OpenAI | [platform.openai.com](https://platform.openai.com) |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) |
| OpenRouter | [openrouter.ai](https://openrouter.ai) |
| LM Studio | Local — no key needed |

Settings are saved to `~/.flowspace/.llm-settings.json`. You can change providers at any time.

### Update / Uninstall

To update to the latest version, re-run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/mohamedelrefaiy/flowspace/main/install.sh | bash
```

To uninstall:

```bash
rm -rf ~/.flowspace && sudo rm /usr/local/bin/flowspace
```

---

## Developing from source

```bash
git clone https://github.com/mohamedelrefaiy/flowspace.git
cd flowspace
make install
make dev
```

| Task | Command |
|---|---|
| Dev server (HMR) | `make dev` |
| Production build | `make build` |
| Production server | `make prod` |
| Run tests | `npm test` |
| Type check | `make typecheck` |
| Docker build + run | `make docker && make docker-run` |

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Browser  (localhost:3000)              │
│  ┌─────────────────────────────────┐    │
│  │  React 19 · Tailwind CSS v4     │    │
│  │  Framer Motion · Lucide React   │    │
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

A single Express process serves both the API and the React frontend. All Google auth is handled by the `gws` CLI — no OAuth project or client secrets required from the user.

---

## How It Works

Most "AI + productivity" tools are thin wrappers: you type, the LLM responds, nothing actually happens. FlowSpace is built differently — the LLM is a reasoning core wrapped by systems for safe execution, persistent memory, and autonomous scheduling.

### The agent loop

When you send a message, the agent doesn't just reply — it reasons in rounds. Each round it can call tools, inspect results, and decide what to do next. This repeats up to 5 times before returning a final answer.

```
User: "Find the Q4 budget doc and summarize the key numbers"

Round 1 → search_drive("Q4 budget")         → returns file list
Round 2 → read_document(fileId)              → returns doc content
Round 3 → (no more tools needed)             → generates summary
```

This means the agent can handle multi-step work — search, read, cross-reference, then act — without you having to break it into pieces.

### Approval-gated writes

Read tools (search, fetch, list) run instantly. Write tools (send email, create event, edit doc, append to sheet) always pause and show you an approval card first — with editable fields, so you can adjust before confirming. Nothing is sent or saved until you explicitly approve.

```
Agent: "Here's the draft reply to Sarah. Edit if needed — approve to send."
[Draft body] [Edit] [Approve] [Cancel]
```

The UX is not "are you sure?" — it's "here's what I built, make it yours."

### Composable workflows

Beyond one-shot commands, FlowSpace supports multi-step workflows defined as sequences of tool calls with output chaining. Each step can reference the output of any previous step:

```
Workflow: "Log credit card alerts to spreadsheet"
Step 1: gmail_search("from:bank subject:alert")  → threadIds
Step 2: gmail_read({{steps.0.threadIds}})         → email bodies
Step 3: sheets_append({{steps.1.parsed_amounts}}) → [approval required]
```

The scheduler runs these workflows on a configurable interval — autonomously, in the background — and tracks failures with retry state so nothing silently drops.

### Persistent memory across conversations

The agent remembers context across sessions. When you reference a file, a contact, or a decision — even from weeks ago — it retrieves the relevant memory using semantic search (embedding similarity, not keyword matching), so you don't have to re-explain your context every time.

Long conversations are automatically summarized when they approach the token limit, preserving key decisions and open questions without truncating history.

### Local-first, provider-agnostic

Everything runs on your machine. The server process, the Google API calls, the memory store — none of it touches a cloud service you don't control. The only external calls are to Google's APIs (for your data) and your chosen AI provider (for reasoning). Swap providers anytime from the Settings UI.

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
npm test         # all tests must pass
```

Open an issue first for anything beyond a small fix so we can align before you invest the time.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

If FlowSpace saves you time, a ⭐ on GitHub goes a long way.

</div>
