# Quickstart: Nail the Briefing

**Feature**: `002-briefing-redesign`
**Date**: 2026-03-07

## Prerequisites

- Node.js 20+
- `GLM_API_KEY` in `.env` (Z.AI API key for GLM-4.7)
- Google Workspace auth via `gws` CLI (run `gws auth login` if not already authenticated)

## Setup

```bash
git checkout 002-briefing-redesign
npm install
make dev
```

Open http://localhost:3000. Sign in with Google if prompted.

## What Changed

### 1. Briefing Reliability (server.ts)

The `/api/briefing` endpoint now retries failed GLM API calls once (2s delay) before returning an error. The JSON extraction is hardened to handle common malformed responses.

**Test**: Stop GLM API (unset `GLM_API_KEY`) → app should show fallback triage panels within 5s, not a blank screen.

### 2. Smart Calendar (server.ts + YourDayPanel.tsx)

The AI prompt now classifies each event with `priority_group`: "needs_prep", "show_up", or "fyi". Backend caps at 8 events. Frontend groups by priority with section headers.

**Test**: Load with 15+ events → max 8 shown, grouped. "Needs prep" events at top.

### 3. Pre-triaged Inbox (App.tsx + InboxTriage.tsx)

InboxTriage is now the default email view. In fallback mode (no AI), emails are triaged by simple heuristics (To/CC/automated sender detection). The old `InboxPreview` flat list is removed from the default view.

**Test**: Load briefing → inbox categories visible immediately. No click needed.

### 4. Contextual Drive Files (App.tsx)

RecentFiles panel removed from briefing. Drive files only appear inline in meeting prep cards or as attention items when contextually relevant.

**Test**: Load briefing → no "Recent files" section. Files appear in YourDay cards when linked to meetings.

### 5. Clean Chat Output (ChatThread.tsx)

ToolTimeline hidden by default. Compact "Working..." spinner shown during tool execution. Expandable detail view available via "Show details" link.

**Test**: Send "Summarize my emails" in chat → see clean response, no "Searching Gmail — COMPLETED" lines.

## Files Modified

| File | Change |
|------|--------|
| `server.ts` | Retry logic in `/api/briefing`, updated BRIEFING_SYSTEM_PROMPT with priority_group and contextual Drive rules |
| `src/hooks/useBriefing.ts` | Frontend retry (1 attempt, 3s delay), `retrying` state |
| `src/services/api.ts` | `DayEvent` type updated with `priority_group` and `linked_docs` |
| `src/components/YourDayPanel.tsx` | Group events by priority_group, section headers, 8-event cap |
| `src/components/ChatThread.tsx` | ToolTimeline hidden by default, compact progress indicator |
| `src/App.tsx` | Remove RecentFiles from briefing, add fallback triage logic |
| `src/components/InboxTriage.tsx` | Minor: ensure always rendered in briefing layout |

## Verification Checklist

- [ ] Briefing loads on clean start (no cache)
- [ ] Briefing loads from cache (reload within 10 min)
- [ ] Fallback renders when GLM_API_KEY is unset
- [ ] Calendar shows max 8 events with grouping
- [ ] Inbox triage visible on first load (no click)
- [ ] No "Recent files" panel in briefing view
- [ ] Chat responses hide tool timeline
- [ ] "Show details" expands tool timeline in chat
- [ ] 30-minute silent refresh works without UI flash
