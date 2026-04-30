# Feature Spec: OpenClaw Memory Agent — Proactive Meeting Prep

## Overview

Add a proactive meeting prep system to FlowSpace: a horizon scanner that scans the calendar 24-72h ahead, pulls attendee emails and Drive files, generates LLM briefs for each qualifying meeting, and surfaces them in a Draft Queue UI panel. Users approve (opens chat with brief as context), dismiss, or mark as useful. Phase 2 layers an importance memory model on top of validated usage.

## Target User

Executives, founders, and senior ICs who can't afford a human chief of staff or EA. Solo startup founders, VPs at Series A companies, heads of product with 15+ meetings/week.

## Requirements

### Phase 1: Ship Day-One Value (Manual Scan)

1. **Horizon Scanner** — Server-side function triggered by POST endpoint. Scans calendar 48h ahead. For each qualifying meeting (>= 30min, >= 2 external attendees, max 10), searches attendee emails (7 days) and Drive files, generates an LLM brief (max 500 words markdown).
2. **Draft Queue API** — POST /api/drafts/scan (trigger), GET /api/drafts (list), POST /api/drafts/:id/approve, POST /api/drafts/:id/dismiss, PATCH /api/drafts/:id/useful.
3. **Draft Queue UI** — New panel above AttentionPanel in HomeDashboard. Cards sorted by meetingTime. 7 interaction states. Approve opens chat with brief as threadBrief.
4. **SharedJsonFileStore** — Extract atomic read/write utility from memory-store.ts. Used by drafts, memory, tool registry.
5. **Tests** — 22 critical paths: scanner logic + API endpoints + approve-to-chat flow.

### Phase 1.5: Automated Scheduling (deferred)

- node-cron in-process scheduler
- CLI command: flowspace horizon-scan
- Lock file, catch-up scan on server start

### Phase 2: Memory + OpenClaw (gated on Phase 1 validation)

- ImportanceSignal wraps importance-feedback.ts
- OpenClaw integration for background scheduling
- Confidence scoring from learned weights
- Bootstrap from Phase 1 "useful" booleans

## Constraints

- Must work with existing approval gate (no autonomous writes)
- Phase 1: no OpenClaw dependency, no cron, no CLI command
- Scanner runs in-process, reuses server's auth context
- Read-only scanner (runtime ALLOWED_SCANNER_TOOLS guard)
- Approve = open chat with brief context (not execution)

## Success Criteria

- Click "Scan next 48h" → drafts appear in queue
- Approve → chat opens with brief as context
- Dismiss → card removed
- Empty/error/scanning states render correctly
- 22 test paths green
- 10+ external users connect accounts in first 2 weeks (Phase 1 validation gate)
