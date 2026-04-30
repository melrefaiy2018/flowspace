# Architecture: Current vs Post-Implementation

Generated: 2026-04-08
Branch: feat/open-source-cli
Related: `docs/plans/openclaw-memory-agent-v4-implementation.md`

## Current Architecture (Today)

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  USER ACTION     │     │          EXPRESS SERVER               │
│  (click, type)   │────→│  server.ts (3,931 lines)             │
└─────────────────┘     │                                      │
                        │  Auth Guard ──→ getActiveStoredAccount│
                        │                                      │
                        │  ┌──────────────────────────────────┐│
                        │  │ REACTIVE ENDPOINTS                ││
                        │  │ /api/stats         → Google APIs  ││
                        │  │ /api/briefing      → LLM + APIs   ││
                        │  │ /api/gmail/recent  → Gmail API    ││
                        │  │ /api/calendar/*    → Calendar API ││
                        │  │ /api/drive/*       → Drive API    ││
                        │  │ /api/chat/stream   → chat.ts      ││
                        │  │ /api/followups     → Tasks API    ││
                        │  │ /api/ai-triage     → LLM          ││
                        │  └──────────────────────────────────┘│
                        │                                      │
                        │  ┌──────────────────────────────────┐│
                        │  │ PERSISTENCE (DATA_DIR)            ││
                        │  │ .accounts.json                    ││
                        │  │ .gws-credentials.{email}.json     ││
                        │  │ .memory/{hash}.json                ││
                        │  │ .importance-preferences.{email}    ││
                        │  │ .persona.{email}.json              ││
                        │  │ .dynamic-tools.json                ││
                        │  └──────────────────────────────────┘│
                        └──────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React 19)                                        │
│                                                             │
│  App → AppInner                                             │
│    ├─ AppRail (nav)                                         │
│    ├─ HomeDashboard                                         │
│    │   ├─ YourDayPanel (briefing)                           │
│    │   ├─ TodayPanel (events)                               │
│    │   ├─ AttentionPanel (priority items)                   │
│    │   ├─ InboxTriage (email categories)                    │
│    │   ├─ FollowupPanel (commitments)                       │
│    │   └─ HomeActivityPanel (recent)                        │
│    ├─ ChatThread + CommandInput                             │
│    └─ Settings / Gmail / Tasks / Calendar views             │
│                                                             │
│  Data: useWorkspaceData → api.ts → server                  │
│  Chat: ChatContext → api.streamChat → NDJSON               │
│  Storage: localStorage (messages, conversations)            │
└─────────────────────────────────────────────────────────────┘

KEY CHARACTERISTIC: Everything is REACTIVE.
User asks → system responds. Nothing happens without a prompt.
```

### Entry Points
- **HTTP Server**: Express on port 3000 (configurable via PORT env var)
- **CLI**: `bin/cli.mjs` — bundled Node.js executable (setup, doctor, reset commands)
- **Tauri**: `src-tauri/lib.rs` spawns Express server as child process

### Auth Flow
```
Priority order for getAccessToken():
1. GWS imported credentials (.accounts.json → .gws-credentials.{email}.json)
2. Legacy .gws-credentials.json
3. OAuth2 .tokens.json + env vars
4. ADC (~/.config/gcloud/application_default_credentials.json)

Auth middleware (server.ts:116-123):
  Public paths exempt: /auth/*, /health, /version, /codex/*
  All other /api/* routes require active account
```

### Data Flow: AI Chat
```
Frontend User Input
  → ChatContext.sendMessage(content)
  → api.streamChat(messages, onEvent)
  → POST /api/chat/stream
  → handleChat() (src/agent/chat.ts)
    ├─ Load persona for user
    ├─ Initialize memory for user email
    ├─ Build system prompt with context + retrieved memories
    ├─ Call LLM client (configurable: Anthropic, OpenAI, OpenRouter, etc.)
    └─ Tool-calling loop (max 5 rounds):
        ├─ executeTool() → gws CLI → Google APIs
        ├─ Write tools → buildApprovalRequest() → pause for user
        └─ extractFromToolResult() → update memory
  → Stream NDJSON events back to frontend
  → Frontend updates RunRecord + UI
```

### Data Flow: Briefing
```
GET /api/briefing
  → Cache check (60s TTL, scoped by account)
  → Parallel fetch:
    ├─ Gmail: unread messages (last 24h, max 15)
    ├─ Calendar: today's events with attendees
    ├─ Drive: recently shared files (48h)
    └─ Tasks: active follow-up commitments
  → Assemble context message
  → LLM call (temperature 0.3)
  → JSON extraction + validation
  → Return Briefing object (greeting, day_at_a_glance, inbox, attention_items, followups)
```

### Persistence Layer (DATA_DIR)
```
DATA_DIR Resolution:
  Production:  ~/Library/Application Support/FlowSpace
  Development: project root
  Override:    FLOWSPACE_DATA_DIR env var

Files:
  .accounts.json                      — account manifest + active account
  .gws-credentials.{email}.json       — per-account OAuth tokens
  .persona.{email}.json               — per-account persona instructions
  .dynamic-tools.json                 — custom tool definitions
  .inbox-action-log.{email}.json      — audit trail of delegated actions
  .importance-preferences.{email}.json — trained feedback (max 400 examples)
  .followup-state.{email}.json        — commitment tracking
  .llm-settings.json                  — provider config + API keys
  .memory/{userHash}.json             — per-user memories (max 50 entries)
```

### Caching
```
Server-side: Map<string, CacheEntry> with 60s TTL
  Key: "accountId:endpoint"
  Cached: /api/stats, /api/briefing, /api/drive/recent, etc.

Frontend: localStorage per account
  Keys: flowspace.chat.${userKey}.{messages|conversations|runs}
```

### Tool System
```
src/agent/tools.ts (2,258 lines):
  TOOL_DEFINITIONS — single array of all ~40 tools
  executeTool() — single switch statement dispatching all tools
  isWriteTool() — Set of write tool names requiring approval
  buildApprovalRequest() — constructs approval UI for write tools
  
  All tools executed via gws CLI subprocess (execFile, not shell)
  Access token passed via GOOGLE_WORKSPACE_CLI_TOKEN env var
```

### Key Boundaries

| Boundary | Location | Purpose |
|----------|----------|---------|
| Auth Guard | server.ts:116 | Verify active account before data access |
| Cache | server.ts:845 | 60s TTL per scoped key |
| Stream Response | server.ts:2268 | NDJSON for long-lived chat |
| Memory Init | chat.ts:26 | Load user memories before LLM call |
| Token Refresh | tools.ts:8 | Refresh Google token before API call |
| Approval Gate | tools.ts:buildApprovalRequest | Block write tools until human approval |
| Tool Execution | tools.ts:executeTool | Chat → GWS CLI with access token |

---

## Post-Implementation Architecture (Phase 1)

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  USER ACTION     │     │          EXPRESS SERVER               │
│  (click, type)   │────→│  server.ts (~4,100 lines)            │
└─────────────────┘     │                                      │
                        │  Auth Guard ──→ getActiveStoredAccount│
                        │                                      │
                        │  ┌──────────────────────────────────┐│
                        │  │ REACTIVE ENDPOINTS (unchanged)    ││
                        │  │ /api/stats, /api/briefing, etc.   ││
                        │  │ /api/chat/stream → chat.ts        ││
                        │  │ /api/followups → Tasks API        ││
                        │  └──────────────────────────────────┘│
                        │                                      │
                        │  ┌──────────────────────────────────┐│
                        │  │ ★ NEW: PROACTIVE ENDPOINTS        ││
                        │  │ POST /api/drafts/scan             ││
                        │  │   └─→ horizon-scanner.ts           ││
                        │  │       ├─ ALLOWED_SCANNER_TOOLS    ││
                        │  │       │  guard (runtime)           ││
                        │  │       ├─ calendar_agenda(48h)     ││
                        │  │       ├─ search_emails per mtg    ││
                        │  │       ├─ search_drive per mtg     ││
                        │  │       ├─ LLM brief generation     ││
                        │  │       └─ → StagedDraft[]          ││
                        │  │                                    ││
                        │  │ GET  /api/drafts                  ││
                        │  │ POST /api/drafts/:id/approve      ││
                        │  │ POST /api/drafts/:id/dismiss      ││
                        │  │ PATCH /api/drafts/:id/useful      ││
                        │  └──────────────────────────────────┘│
                        │                                      │
                        │  ┌──────────────────────────────────┐│
                        │  │ PERSISTENCE (DATA_DIR)            ││
                        │  │ (existing files unchanged)        ││
                        │  │ ★ NEW: staged-drafts.json         ││
                        │  │   via SharedJsonFileStore          ││
                        │  └──────────────────────────────────┘│
                        │                                      │
                        │  ┌──────────────────────────────────┐│
                        │  │ ★ NEW: SharedJsonFileStore        ││
                        │  │ src/lib/json-file-store.ts        ││
                        │  │ Atomic read/write/temp-rename     ││
                        │  │ Used by: drafts, memory, tools    ││
                        │  └──────────────────────────────────┘│
                        └──────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React 19)                                        │
│                                                             │
│  App → AppInner                                             │
│    ├─ AppRail (nav)                                         │
│    ├─ HomeDashboard                                         │
│    │   ├─ ★ DraftQueue (NEW, above AttentionPanel)          │
│    │   │   ├─ "Scan next 48h" button                        │
│    │   │   ├─ Meeting prep cards (sorted by time)           │
│    │   │   │   ├─ Time → Title → Attendees → Brief (3 lines)│
│    │   │   │   ├─ [Approve] [Dismiss] [Useful?]             │
│    │   │   │   └─ Approve → chat opens with threadBrief     │
│    │   │   └─ 7 states: first-run, scanning, populated,     │
│    │   │       empty, partial, error, all-actioned           │
│    │   ├─ YourDayPanel                                      │
│    │   ├─ AttentionPanel                                    │
│    │   ├─ InboxTriage                                       │
│    │   ├─ FollowupPanel                                     │
│    │   └─ HomeActivityPanel                                 │
│    ├─ ChatThread + CommandInput                             │
│    └─ Settings / Gmail / Tasks / Calendar views             │
│                                                             │
│  ★ NEW: useDrafts hook → api.scanDrafts + api.getDrafts    │
│  Data: useWorkspaceData (unchanged)                         │
│  Chat: ChatContext (+ triggerAction for approve→chat)       │
└─────────────────────────────────────────────────────────────┘

KEY CHARACTERISTIC: First PROACTIVE capability.
User triggers scan → system does multi-step work autonomously.
Approve bridges proactive output → reactive chat.
```

### New Data Flow: Horizon Scanner
```
User clicks "Scan next 48h"
  → POST /api/drafts/scan
  → horizon-scanner.ts runs IN-PROCESS
    ├─ ALLOWED_SCANNER_TOOLS = { calendar_agenda, search_drive, search_emails, docs_read }
    ├─ Uses server's getAuthClient() directly (no standalone auth)
    ├─ calendar_agenda(48h window)
    ├─ Filter: >= 30min, >= 2 external attendees, max 10 meetings
    ├─ For each meeting:
    │   ├─ search_emails(attendee emails, last 7 days)
    │   ├─ search_drive(meeting title + attendee names)
    │   └─ LLM generates brief (max 500 words markdown)
    └─ Output: { drafts: StagedDraft[], meta: { scannedAt, meetingsFound, meetingsPrepped, errors } }
  → SharedJsonFileStore writes staged-drafts.json (atomic: temp file + rename)
  → Response returned to frontend
  → DraftQueue panel renders cards
```

### New Data Flow: Approve → Chat
```
User clicks "Approve" on a meeting prep card
  → POST /api/drafts/:id/approve
  → Draft status → "approved"
  → Response includes draft data (summary, linkedDocs, etc.)
  → Frontend: ChatContext.triggerAction() with brief as threadBrief
  → Card shows green check animation (200ms)
  → Chat panel slides open
  → Chat input focused, brief pre-loaded as conversation context
  → User asks follow-up questions about the meeting
```

---

## What Changes (Diff)

### New Files (4)
| File | Purpose | Lines (est) |
|------|---------|-------------|
| `src/lib/json-file-store.ts` | Shared atomic JSON read/write utility | ~60 |
| `src/agent/horizon-scanner.ts` | Scan logic + tool guard + LLM brief gen | ~200-300 |
| `src/components/DraftQueue.tsx` | Draft Queue UI panel (7 states) | ~250 |
| `src/hooks/useDrafts.ts` | Data hook for draft queue | ~80 |

### Modified Files (2)
| File | Change | Lines added (est) |
|------|--------|-------------------|
| `server.ts` | +5 endpoints (/api/drafts/*) | ~170 |
| `src/components/HomeDashboard.tsx` | Import + render DraftQueue above AttentionPanel | ~10 |

### New Data File (1)
| File | Location | Format |
|------|----------|--------|
| `staged-drafts.json` | DATA_DIR | Array of StagedDraft objects |

### Unchanged
- `chat.ts` — no modifications
- `tools.ts` — no modifications (scanner imports executeTool, guards at runtime)
- `memory-store.ts` — no modifications in Phase 1
- All existing components, auth flow, caching layer, all existing endpoints

---

## Evolution Path

```
Phase 1 (NOW):      User clicks "Scan" → scanner runs → drafts appear
                    100% manual trigger. No background work.

Phase 1.5 (LATER):  node-cron fires scan automatically at 6am
                    CLI command: flowspace horizon-scan
                    Lock file prevents concurrent scans
                    Catch-up scan on server start if stale
                    ┌──────────┐
                    │ node-cron│──→ same scanner, same endpoints
                    └──────────┘

Phase 2 (GATED):    OpenClaw schedules scans externally
                    ImportanceSignal wraps importance-feedback.ts
                    Confidence scoring from learned weights
                    "useful" booleans bootstrap into real weights
                    ┌──────────┐     ┌──────────────────┐
                    │ OpenClaw │──→  │ importance-       │
                    │ scheduler│     │ signals.ts        │
                    └──────────┘     │ (bounded weights, │
                                     │  30-day decay,    │
                                     │  skip threshold)  │
                                     └──────────────────┘
```

### Architectural Principle

The key shift: **FlowSpace goes from purely reactive to having its first proactive capability.** Phase 1 keeps the trigger manual (button click). Phases 1.5 and 2 progressively automate the trigger while the scanner logic, endpoints, UI, and data model remain the same.

The surface area is deliberately small: 4 new files, 2 modified, 1 new data file. The scanner reuses existing tools and auth. The UI follows existing panel patterns (FollowupPanel, AttentionPanel). The approve flow bridges to the existing chat system via threadBrief.
