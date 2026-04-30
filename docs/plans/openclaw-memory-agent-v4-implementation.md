# Plan: OpenClaw Memory Agent — Proactive Workspace Intelligence (v4 post eng + design review)

## Context

FlowSpace has a reactive AI agent but no proactive layer. The user wants the agent to learn what matters over time and act autonomously. Startup mode: business model, distribution, and user validation matter. Nobody has used FlowSpace yet.

**Key insight:** Distribution is the immediate wall. Memory is the long-term moat.

**Eng review result:** Major architecture simplification. Cron/CLI scheduling removed from Phase 1. Manual "Scan now" button replaces automated scheduling. Approve = open chat with brief context (not execution). SharedJsonFileStore extracted as DRY utility.

**Design review result:** 3/10 → 8/10. 8 design decisions made. 7 interaction states specified. Full CSS token mapping, responsive spec, a11y spec, approve-to-chat transition.

**Full design doc:** `docs/plans/openclaw-memory-agent.md` (v3, business + technical gaps)

## Revised Phase 1 Architecture (post eng review)

```
User clicks "Scan next 48h" button in UI
  → POST /api/drafts/scan
       → horizon-scanner runs IN-PROCESS (no CLI, no cron)
       → calendar_agenda(48h)
       → Filter: >= 30min, >= 2 external attendees, max 10
       → For each meeting:
            search_emails + search_drive
            LLM generates brief
       → Write to staged-drafts.json via SharedJsonFileStore
       → Return { drafts, meta: { scannedAt, meetingsFound, meetingsPrepped, errors } }

User sees Draft Queue panel:
  → Cards: meeting title, time, brief preview
  → "Useful" / "Not useful" toggle per draft
  → Approve → opens AI chat pre-loaded with brief as threadBrief
  → Dismiss → marks as dismissed
  → Empty state / Error state / Scan metadata state
```

### What changed from v3 plan:

| v3 (pre-review) | v4 (post-review) | Why |
|------------------|-------------------|-----|
| CLI `flowspace horizon-scan` | No CLI. Server-side POST endpoint | Manual scan removes CLI/cron/lock complexity |
| node-cron scheduler | No scheduler in Phase 1 | Validate brief quality first, add cron in Phase 1.5 |
| Lock file + dedup | Dedup by meetingId only | No concurrent scans possible (single POST handler) |
| Auth bootstrap (standalone CLI) | Reuses server's auth context | Scanner runs in-process |
| Approve → executeApprovedAction | Approve → open chat with threadBrief | Brief is context, not action |
| Catch-up scan on server start | Not needed | Manual scan, user triggers when ready |
| Inline tool import restriction | Runtime ALLOWED_SCANNER_TOOLS guard | Can't import subset of tools.ts |
| Copy atomic write pattern | Extract SharedJsonFileStore utility | DRY: third store triggers TODOS.md P3 |
| Scan output to stdout | Scan returns directly to Express handler | No CLI, no stdout |

## Implementation Plan (Phase 1)

### Step 0: SharedJsonFileStore utility
**File:** `src/lib/json-file-store.ts` (new)
Extract from `memory-store.ts` (lines 119-122): atomic read/write/temp-rename pattern.
Used by: draft queue store, memory store, dynamic-tool-registry.

### Step 1: Horizon scanner (server-side)
**File:** `src/agent/horizon-scanner.ts` (new, ~200-300 lines)
- Runtime tool guard: `ALLOWED_SCANNER_TOOLS` set guards every `executeTool()` call
- Uses server's `getAuthClient()` directly (in-process, no CLI auth bootstrap)
- Scan metadata: `{ scannedAt, meetingsFound, meetingsPrepped, errors: [] }`
- "External" attendee = email domain differs from authenticated user's primary domain
- Batch limit: max 10 meetings, sorted by start time

### Step 2: API endpoints
**File:** `server.ts` (add routes)
- `POST /api/drafts/scan` — triggers horizon scanner in-process, returns results
- `GET /api/drafts` — returns drafts, sets `seenAt` on pending
- `POST /api/drafts/:id/approve` — marks approved, returns draft data for chat injection
- `POST /api/drafts/:id/dismiss` — marks dismissed
- `PATCH /api/drafts/:id/useful` — toggles boolean
- Auto-purge: drafts > 7 days or past meetingTime
- Dedup: upsert by meetingId on scan

### Step 3: Draft Queue UI (design-reviewed, 8/10)
**File:** `src/components/DraftQueue.tsx` + `src/hooks/useDrafts.ts` (new)

**Panel placement:** Above AttentionPanel (highest priority in dashboard).

**Information hierarchy per card:**
1. Meeting time (dim, 12px) — "Tomorrow 10:00am"
2. Meeting title (bold, 15px) — "Q3 Board Review"
3. Attendees (dim, 12px) — "sarah@, mike@, +2"
4. Brief preview (13px, 3 lines max, expand on click with animation)
5. Context badges — [3 docs] [5 emails]
6. Action row: Approve (green accent), Dismiss (faint), Useful toggle (ThumbsUp icon)

**Card sort:** Chronological by meetingTime (nearest first).

**7 interaction states:**
- FIRST RUN: "Scan your calendar to prep for upcoming meetings" + centered Scan button
- SCANNING: skeleton cards shimmer + "Prepping meeting 3 of 8..." progress
- POPULATED: card list + scan metadata bar
- EMPTY: green checkmark + "All caught up" + "Scan again" link
- PARTIAL: cards shown + amber banner "3 of 8 couldn't be prepped"
- ERROR: red banner + error message + "Try again" button
- ALL ACTIONED: "You've reviewed all meeting preps. Nice." + "Scan again"

**Approve transition:** Card shows green check animation (200ms), chat panel slides open with brief pre-loaded as threadBrief via ChatContext.triggerAction(). Focus moves to chat input.

**Design system tokens:**
- Card bg: var(--surface), border: var(--border), radius: var(--radius-md), shadow: var(--shadow-card)
- Panel bg: var(--home-panel-bg) gradient
- Scan button: bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent-border)] text-[12px] radius-sm
- Useful toggle: ThumbsUp icon, var(--text-faint) off / var(--accent) on
- Icons: Lucide React (Calendar, Check, X, ThumbsUp, RefreshCw)
- Animations: motion (Framer Motion) for card entrance/exit

**Responsive:** Full cards on all viewports. Panel stacks to full-width on tablet/mobile.

**Accessibility:**
- Cards: role="article", aria-label="Meeting prep: {title} at {time}"
- Approve/Dismiss: labeled buttons with aria-label
- Useful toggle: role="switch" with aria-checked
- Scan button: aria-busy during scan, aria-live="polite" for status
- Tab through cards, Enter to expand, focus to chat on approve

### Step 4: Tests (22 critical paths)
- Scanner: mock Google APIs + LLM. Test filtering, batch limit, tool guard, error handling, metadata.
- API: test each endpoint including dedup, purge, 404s, approval semantics.
- Approve → chat: test threadBrief injection into ChatContext.

## Key Files

| File | Change | Phase |
|------|--------|-------|
| `src/lib/json-file-store.ts` | **New** — shared atomic JSON store | 1 |
| `src/agent/horizon-scanner.ts` | **New** — scanner (server-side, no CLI) | 1 |
| `server.ts` | Add `/api/drafts` routes + scan trigger | 1 |
| `src/components/DraftQueue.tsx` | **New** — Draft Queue UI panel | 1 |
| `src/hooks/useDrafts.ts` | **New** — data hook for drafts | 1 |
| `src/agent/memory/importance-signals.ts` | **New** — Phase 2 only | 2 |

## Phase 1.5: Cron Scheduling (deferred, TODO)
After Phase 1 validates (10+ users or >3 active):
- Add `node-cron` in-process scheduler
- Add `flowspace horizon-scan` CLI command
- Lock file for concurrent scan prevention
- Catch-up scan on server start

## Phase 2: Memory + OpenClaw (gated on Phase 1)
- ImportanceSignal wraps `importance-feedback.ts` (don't build parallel)
- OpenClaw integration for background scheduling
- Confidence scoring from learned weights
- Bootstrap from Phase 1 `useful` booleans

## Verification

Phase 1:
- Click "Scan next 48h" → scanner runs, drafts appear in queue
- Draft card shows meeting title, time, brief, useful toggle
- Approve → chat opens with brief as context
- Dismiss → card removed
- Scan with 0 qualifying meetings → "No meetings need prep"
- Scan with LLM failures → metadata shows errors, partial results displayed
- Drafts auto-purge after 7 days
- Tests pass: 22 critical paths green

## Parallelization

- **Lane A:** `json-file-store.ts` → `horizon-scanner.ts` (sequential)
- **Lane B:** `DraftQueue.tsx` + `useDrafts.ts` (mock API, independent)
- **Lane C:** `server.ts` endpoints (depends on Lane A's store)

Launch A + B in parallel. C after A completes. Merge all.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Office Hours | `/office-hours` | Business + technical gap analysis | 2 | DONE | v3 plan with 2-phase split, distribution-first strategy |
| Codex Review | cold read (office-hours) | Independent 2nd opinion | 1 | DONE | "Wall is distribution, not memory." |
| Adversarial Review | subagent | Spec quality | 2 | DONE | v2: 5/10, v3: 7/10 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 6 issues, 0 unresolved. Manual scan replaces cron. |
| Outside Voice | Codex (eng-review) | Independent plan challenge | 1 | DONE | 16 findings. 2 tensions resolved. |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 3/10 → 8/10, 8 decisions |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** ENG + DESIGN CLEARED. Ready to implement Phase 1. Run `/ship` when done.
