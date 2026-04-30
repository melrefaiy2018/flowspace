# Implementation Plan: OpenClaw Memory Agent — Proactive Meeting Prep

**Branch**: `feat/open-source-cli` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-openclaw-memory-agent/spec.md`
**Design Docs**: `docs/plans/openclaw-memory-agent.md`, `docs/plans/openclaw-memory-agent-v4-implementation.md`, `docs/plans/architecture-current-vs-future.md`

## Summary

Add a proactive meeting prep system to FlowSpace. Phase 1 ships a manual "Scan next 48h" button that triggers an in-process horizon scanner, generates LLM-powered meeting briefs, and surfaces them in a Draft Queue panel. Approve opens chat with brief as context. A SharedJsonFileStore utility is extracted as DRY infrastructure. Phase 2 (gated on user validation) layers an importance memory model and OpenClaw scheduling.

## Technical Context

**Language/Version**: TypeScript (Node.js 20+, React 19)
**Primary Dependencies**: Express.js, googleapis, google-auth-library, motion (Framer Motion), Lucide React, Vitest
**Storage**: JSON files in DATA_DIR (`~/Library/Application Support/FlowSpace` in production, project root in dev). Atomic write pattern (temp file + rename).
**Testing**: Vitest + @vitest/coverage-v8. Tests in `__tests__/` directories adjacent to source.
**Target Platform**: macOS (Tauri v2), Web (Express + Vite), Docker
**Project Type**: Fullstack desktop/web app (React + Express + Tauri)
**Performance Goals**: Scan completes in <90s for 10 meetings. UI remains responsive during scan.
**Constraints**: No cron/scheduler in Phase 1. No CLI command. Scanner runs in-process only. All writes gated behind approval.
**Scale/Scope**: Single user per instance. Max 10 meetings per scan. Max 500 memory entries per user.

## Constitution Check

*No constitution file found. Proceeding with project CLAUDE.md constraints.*

| Gate | Status | Notes |
|------|--------|-------|
| Immutability | PASS | All new data structures are immutable (StagedDraft created once, status updates return new objects) |
| File size <800 lines | PASS | horizon-scanner.ts ~200-300, DraftQueue.tsx ~250, json-file-store.ts ~60, useDrafts.ts ~80 |
| Error handling | PASS | Every failure path handled (scan metadata captures errors, per-meeting skip on LLM failure) |
| Input validation | PASS | API endpoints validate JSON body, 404 on missing drafts, localhost-only for ingest |
| Security | PASS | No new secrets. Scanner uses existing auth. Runtime tool guard prevents write tool access. |
| TDD | TRACKED | 22 critical paths identified. Tests written alongside implementation. |

## Project Structure

### Documentation (this feature)

```text
specs/001-openclaw-memory-agent/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── agent/
│   ├── horizon-scanner.ts     # NEW — scan logic + tool guard + LLM brief gen
│   ├── chat.ts                # UNCHANGED in Phase 1
│   ├── tools.ts               # UNCHANGED (scanner imports executeTool, guards at runtime)
│   └── memory/
│       ├── memory-store.ts    # EXISTING — refactored to use SharedJsonFileStore
│       └── importance-signals.ts  # Phase 2 only
├── lib/
│   └── json-file-store.ts    # NEW — shared atomic JSON read/write utility
├── components/
│   ├── DraftQueue.tsx         # NEW — Draft Queue UI panel
│   └── HomeDashboard.tsx      # MODIFIED — import + render DraftQueue
├── hooks/
│   └── useDrafts.ts           # NEW — data hook for draft queue
└── services/
    └── api.ts                 # MODIFIED — add scanDrafts + getDrafts + approveDraft etc.

server.ts                      # MODIFIED — add /api/drafts/* endpoints (~170 lines)

__tests__/
├── horizon-scanner.test.ts    # Scanner unit tests
├── drafts-api.test.ts         # API endpoint tests
└── draft-queue.test.ts        # Approve→chat integration test
```

**Structure Decision**: Follows existing FlowSpace conventions. New files in existing directories. No new top-level directories. SharedJsonFileStore in `src/lib/` alongside other utilities.

## Complexity Tracking

No violations. Phase 1 touches 4 new files + 3 modified files (under 8-file threshold).

---

## Phase 0: Research

### R1: Tool System Import Pattern

**Decision**: Runtime guard with `ALLOWED_SCANNER_TOOLS` Set.
**Rationale**: `tools.ts` exports a single `TOOL_DEFINITIONS` array and `executeTool()` switch. Cannot import a subset at module level. Runtime guard matches existing `isWriteTool()` pattern.
**Alternatives considered**: Refactoring tool system for modular import (4hrs, touches 2200-line file, rejected as too invasive for Phase 1).

### R2: Scheduling Approach

**Decision**: Manual "Scan next 48h" button in Phase 1. Cron deferred to Phase 1.5.
**Rationale**: Cross-model consensus (Codex + Claude): for a product with zero users, validate brief quality before building scheduler infrastructure. Manual scan removes node-cron, CLI, lock files, timezone handling, catch-up scan. 40% complexity reduction.
**Alternatives considered**: node-cron in-process (deferred), system crontab + CLI (deferred), OpenClaw scheduling (Phase 2).

### R3: Approve Action Semantics

**Decision**: Approve opens chat with brief pre-loaded as `threadBrief`.
**Rationale**: The brief is context, not an action. Users want to ask follow-up questions ("what should I prepare?", "draft a reply to Sarah"). Opening chat reuses existing `ChatContext.triggerAction()` and `threadBrief` mechanism.
**Alternatives considered**: Create Google Doc with brief (concrete but not everyone wants a doc per meeting), just mark as approved (underwhelming).

### R4: Shared JSON File Store

**Decision**: Extract `SharedJsonFileStore` from memory-store.ts before building draft store.
**Rationale**: TODOS.md P3 says "wait until third store is needed." Draft queue IS the third store (after memory-store and dynamic-tool-registry). DRY: prevents copying atomic write pattern a third time.
**Alternatives considered**: Copy pattern inline (faster but third copy of same code).

### R5: Concurrent Scan Prevention

**Decision**: Dedup by meetingId on ingest. No lock file needed.
**Rationale**: Phase 1 scanner runs in-process via a POST endpoint. Only one request handler runs at a time. No concurrent scans possible without cron/CLI. Lock files were needed for the cron architecture (now deferred).
**Alternatives considered**: Lock file + dedup (was chosen for cron architecture, now unnecessary).

### R6: Auth for Scanner

**Decision**: Scanner reuses server's `getAuthClient()` directly.
**Rationale**: Scanner runs in-process inside the Express server. No standalone execution. No need for separate auth bootstrapping or token refresh logic.
**Alternatives considered**: Import auth module separately (was needed for CLI scanner, now unnecessary).

### R7: Importance Feedback Reuse (Phase 2)

**Decision**: Phase 2 ImportanceSignal wraps `importance-feedback.ts` instead of building parallel scoring.
**Rationale**: `importance-feedback.ts` (565 lines) already has `scorePreferenceTarget()`, `PreferenceFeatures`, `extractPreferenceFeatures()`. Building a parallel scoring system would create divergent models learning the same thing.
**Alternatives considered**: Separate ImportanceSignal store (simpler but diverges over time).

### R8: Scan Result Disambiguation

**Decision**: Scanner output includes metadata object: `{ scannedAt, meetingsFound, meetingsPrepped, errors: [] }`.
**Rationale**: Empty draft array is ambiguous (no meetings vs all meetings failed). Metadata lets the UI show different states for "all caught up" vs "scan failed."
**Alternatives considered**: Separate error log file (less clean), accept ambiguity (bad UX).

---

## Phase 1: Design & Contracts

*See: [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)*

### Entities

1. **StagedDraft** — A meeting prep brief generated by the scanner
2. **ScanResult** — Output of a horizon scan (drafts + metadata)
3. **ScanMeta** — Metadata about a scan run (counts, errors, timing)

### Interfaces

1. **POST /api/drafts/scan** — Trigger horizon scan
2. **GET /api/drafts** — List staged drafts
3. **POST /api/drafts/:id/approve** — Approve draft, return data for chat injection
4. **POST /api/drafts/:id/dismiss** — Dismiss draft
5. **PATCH /api/drafts/:id/useful** — Toggle useful boolean

### Key Design Decisions from Reviews

| Decision | Source | Impact |
|----------|--------|--------|
| Panel above AttentionPanel | Design review | Highest priority in dashboard |
| 3-line brief preview, expand on click | Design review | Consistent card heights |
| 7 interaction states | Design review | Complete state coverage |
| Green check animation on approve → chat slides open | Design review | Approve-to-chat transition |
| Design system tokens (var(--surface), etc.) | Design review | Matches existing panels |
| Full cards on mobile, stacked | Design review (user choice) | Simpler responsive |
| ThumbsUp icon for useful toggle | Design review | Matches importance feedback pattern |

---

## Implementation Order

```
Step 0: SharedJsonFileStore          (src/lib/json-file-store.ts)
  └─ Extract atomic read/write from memory-store.ts
  └─ Tests: atomic write, corrupt file, concurrent access

Step 1: Horizon Scanner              (src/agent/horizon-scanner.ts)
  └─ ALLOWED_SCANNER_TOOLS runtime guard
  └─ calendar_agenda → filter → search_emails + search_drive → LLM brief
  └─ ScanResult output with metadata
  └─ Tests: filtering, batch limit, tool guard, LLM failure, metadata

Step 2: API Endpoints                (server.ts)
  └─ POST /api/drafts/scan → calls scanner in-process
  └─ GET /api/drafts → reads staged-drafts.json, sets seenAt
  └─ POST /api/drafts/:id/approve → marks approved, returns draft
  └─ POST /api/drafts/:id/dismiss → marks dismissed
  └─ PATCH /api/drafts/:id/useful → toggles boolean
  └─ Auto-purge: >7 days or past meetingTime
  └─ Dedup: upsert by meetingId
  └─ Tests: each endpoint, dedup, purge, 404s, approve semantics

Step 3: Draft Queue UI               (src/components/DraftQueue.tsx + src/hooks/useDrafts.ts)
  └─ Panel placement above AttentionPanel
  └─ Card hierarchy: time → title → attendees → brief (3 lines) → badges → actions
  └─ 7 states: first-run, scanning, populated, empty, partial, error, all-actioned
  └─ Approve transition: green check (200ms) → chat opens with threadBrief
  └─ Design tokens from index.css
  └─ Responsive: full cards, stacked on mobile
  └─ Accessibility: role, aria-label, aria-busy, focus management

Step 4: Integration                  (HomeDashboard.tsx + api.ts)
  └─ Import DraftQueue into HomeDashboard
  └─ Add api methods: scanDrafts, getDrafts, approveDraft, dismissDraft, toggleUseful
  └─ Wire approve to ChatContext.triggerAction() with threadBrief
```

## Parallelization

| Lane | Steps | Modules touched | Depends on |
|------|-------|-----------------|------------|
| A | Step 0 → Step 1 | src/lib/, src/agent/ | — |
| B | Step 3 (mock API) | src/components/, src/hooks/ | API contract only |
| C | Step 2 | server.ts | Step 0 (JsonFileStore) |

Launch A + B in parallel. C after A's Step 0 completes. Step 4 after all merge.

## NOT in Scope

| Item | Rationale |
|------|-----------|
| Cron/scheduler | Phase 1.5 after user validation |
| CLI command (flowspace horizon-scan) | Phase 1.5 |
| Lock files | Unnecessary without cron |
| OpenClaw integration | Phase 2, blocked on API discovery |
| ImportanceSignal memory | Phase 2, gated on Phase 1 validation |
| Confidence scoring | Phase 2 |
| UI component tests | Deferred to /qa |
| E2E tests | Deferred to /qa (needs running server + browser) |
| Parallel API calls within meetings | Performance optimization, defer |

## What Already Exists (Reused)

| Existing Code | How Reused |
|---------------|------------|
| `executeTool()` (tools.ts:1692) | Scanner calls directly with runtime guard |
| `getAuthClient()` (server.ts:747) | Scanner uses server's auth context |
| `memory-store.ts` atomic write (lines 119-122) | Extracted to SharedJsonFileStore |
| `/api/followups` endpoint pattern (server.ts:2915) | Draft queue endpoints follow same structure |
| `ChatContext.triggerAction()` | Approve button opens chat with brief |
| `threadBrief` parameter | Brief injected as conversation context |
| `importance-feedback.ts` (565 lines) | Phase 2 wraps this for scoring |
| `FollowupPanel.tsx` + `AttentionPanel.tsx` | Card layout and action patterns |
| CSS variables in `index.css` | Full design token mapping |
| Lucide React icons | Calendar, Check, X, ThumbsUp, RefreshCw |
| `motion` (Framer Motion) | Card entrance/exit animations |

## Failure Modes

| Codepath | Failure | Test? | Error Handling? | User Sees |
|----------|---------|-------|-----------------|-----------|
| calendar_agenda API | Quota/timeout | ✅ | ✅ Scan metadata | "Scan failed" state |
| search_emails per meeting | API error | ✅ | ✅ Skip meeting | Missing draft for that meeting |
| LLM brief generation | Provider down | ✅ | ✅ Skip + log | Missing draft + partial state |
| staged-drafts.json write | Disk full | ❌ | ❌ | **Silent failure** (critical gap) |
| POST /api/drafts/scan | Invalid request | ✅ | ✅ 400 | Error response |
| Approve → chat injection | ChatContext fails | ❌ | ❌ | **Chat doesn't open** (critical gap) |
| GET /api/drafts | File missing | ✅ | ✅ Empty array | "No meetings" (correct) |
| GET /api/drafts | Corrupt JSON | ✅ | ✅ Error response | Error state in UI |

**Critical gaps: 2** — disk full (rare) and chat context injection (high priority, add test).

## Review History

| Review | Runs | Status | Key Findings |
|--------|------|--------|-------------|
| /office-hours | 2 | DONE | v3 plan: 2-phase split, distribution-first, startup mode |
| Codex cold read | 1 | DONE | "Wall is distribution, not memory." Premise revised. |
| Adversarial review | 2 | DONE | v2: 5/10 → v3: 7/10 |
| /plan-eng-review | 1 | CLEAR | 6 issues, 0 unresolved. Cron→manual, approve→chat. |
| Codex plan review | 1 | DONE | 16 findings. Major simplification adopted. |
| /plan-design-review | 1 | CLEAR | 3/10 → 8/10. 8 design decisions. |
