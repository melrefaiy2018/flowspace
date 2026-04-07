# Tasks: Nail the Briefing

**Input**: Design documents from `/specs/002-briefing-redesign/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: No test framework configured. Manual verification only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Type updates and shared data model changes that all user stories depend on

- [x] T001 Add `LinkedDoc` interface and update `DayEvent` with `priority_group` and `linked_docs` fields in `src/services/api.ts`
- [x] T002 Add `FallbackTriageResult` type alias (reuses existing `InboxTriageItem`) in `src/services/api.ts`

**Checkpoint**: Types ready — all user stories can now reference the updated interfaces

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend briefing prompt + retry logic that MUST be complete before frontend stories can work

**CRITICAL**: US1, US2, US3, and US4 all depend on the backend returning the new response shape

- [x] T003 Add retry helper function `callWithRetry(fn, retries, delayMs)` in `server.ts` — wraps async calls with 1 retry on 5xx/network errors, 2s delay, no retry on 4xx
- [x] T004 Harden JSON extraction in `/api/briefing` handler in `server.ts` — add fallback `JSON.parse()` on raw response when regex `/\{[\s\S]*\}/` fails
- [x] T005 Update `BRIEFING_SYSTEM_PROMPT` in `server.ts` to add `priority_group` field ("needs_prep" | "show_up" | "fyi") to the `day_at_a_glance` schema with classification rules: needs_prep (external attendees, >3 attendees, no notes doc, 1-on-1s), show_up (recurring standups, <3 internal attendees), fyi (all-hands, optional events)
- [x] T006 Update `BRIEFING_SYSTEM_PROMPT` in `server.ts` to add `linked_docs` array field to `day_at_a_glance` schema — each doc has `name`, `url`, `type` ("notes" | "agenda" | "shared_file"); instruct AI to only populate when Drive file is directly relevant to the event
- [x] T007 Update `BRIEFING_SYSTEM_PROMPT` in `server.ts` to add contextual Drive instruction: "Only include drive_file attention items when the file is directly relevant to today's events or requires action. Do not list all recently shared files."
- [x] T008 Update `BRIEFING_SYSTEM_PROMPT` in `server.ts` to add max event count instruction: "Return a maximum of 8 events in day_at_a_glance: up to 3 needs_prep, up to 3 show_up, remainder fyi (max 2)"
- [x] T009 Add post-processing in `/api/briefing` handler in `server.ts` — after parsing AI JSON, enforce 8-event cap: keep needs_prep (max 3), show_up (max 3), fill fyi (max 2); ensure every event has a valid `priority_group` (default to "show_up" if missing)
- [x] T010 Wrap the GLM API call in `/api/briefing` handler with `callWithRetry()` from T003 in `server.ts`

**Checkpoint**: Backend returns new briefing shape with priority_group, linked_docs, 8-event cap, and retry resilience

---

## Phase 3: User Story 1 - Reliable AI Briefing on Every Load (Priority: P1)

**Goal**: Briefing loads reliably every time. Frontend retries once on failure, then falls back gracefully to raw data in the same layout (not different panels).

**Independent Test**: Open the app 10 times — briefing renders 10/10. Unset GLM_API_KEY — fallback panels appear within 5s with triaged inbox + calendar.

### Implementation for User Story 1

- [x] T011 [US1] Add `retrying` boolean state to `useBriefing` hook in `src/hooks/useBriefing.ts` — expose in returned `BriefingState`
- [x] T012 [US1] Implement frontend retry logic in `useBriefing` hook in `src/hooks/useBriefing.ts` — on error from backend, set `retrying: true`, wait 3s, call `api.getBriefing()` again; on success set briefing, on failure set `error: true` and `retrying: false`
- [x] T013 [US1] Update fallback UI in `src/App.tsx` — when `briefingError && !briefingLoading`, render the same briefing layout (YourDayPanel + InboxTriage) but with raw `data.events` and heuristic triage data instead of showing different fallback panels (TodayPanel + InboxPreview + RecentFiles)
- [x] T014 [US1] Show "Retrying..." indicator in the topbar in `src/App.tsx` — when `briefingState.retrying === true`, display a small spinner + "Retrying briefing..." next to the existing loading indicator

**Checkpoint**: Briefing is reliable — retries once, falls back gracefully, never shows blank screen

---

## Phase 4: User Story 2 - Smart Calendar Prioritization (Priority: P1)

**Goal**: YourDay panel shows max 8 events grouped by "Needs prep", "Just show up", "FYI" — not a flat chronological list

**Independent Test**: Load briefing with 15+ calendar events — max 8 shown with clear priority grouping and section headers

### Implementation for User Story 2

- [x] T015 [US2] Refactor `YourDayPanel` in `src/components/YourDayPanel.tsx` — replace flat event list with grouped rendering: split `events` array by `priority_group` into three groups
- [x] T016 [US2] Add section headers to `YourDayPanel` in `src/components/YourDayPanel.tsx` — render "Needs prep" (with amber accent), "Just show up" (default), "FYI" (dimmed) section labels above each group; skip empty groups
- [x] T017 [US2] Implement FYI collapse in `YourDayPanel` in `src/components/YourDayPanel.tsx` — if `fyi` group has >2 events, show first 2 with "Show X more" toggle; use local `useState` for expand state
- [x] T018 [US2] Render `linked_docs` in event cards in `src/components/YourDayPanel.tsx` — for each event with `linked_docs?.length > 0`, render clickable doc links (FileText icon + doc name) that open in new tab; style based on `type` (notes=green, agenda=blue, shared_file=default)
- [x] T019 [US2] Add defensive 8-event cap in `YourDayPanel` in `src/components/YourDayPanel.tsx` — before grouping, slice events to max 8 (redundant with backend, protects against stale cache or direct API calls)
- [x] T020 [US2] Handle <=3 events case in `YourDayPanel` in `src/components/YourDayPanel.tsx` — when total events <=3, render all without section headers (no need to group)

**Checkpoint**: Calendar shows prioritized, grouped events capped at 8 — "wall of events" problem solved

---

## Phase 5: User Story 3 - Pre-triaged Inbox as Default State (Priority: P1)

**Goal**: Inbox triage is the primary email view on load — no click required. Fallback mode uses heuristic triage instead of flat email list.

**Independent Test**: Open the app with 20 unread emails — InboxTriage panel visible immediately with categorized emails, zero clicks

### Implementation for User Story 3

- [x] T021 [US3] Create `triageEmailsHeuristic` utility function in `src/App.tsx` — takes `GmailMessage[]`, returns `FallbackTriageResult` using heuristics: needs_reply (user in To, human sender — no noreply@/notifications@/no-reply@), fyi_only (user in CC or known person), can_ignore (automated senders, newsletter patterns)
- [x] T022 [US3] Update fallback rendering in `src/App.tsx` — in the `!hasBriefing && !briefingLoading` branch, replace `<InboxPreview>` with `<InboxTriage>` fed by `triageEmailsHeuristic(data.emails)` results
- [x] T023 [US3] Remove `<InboxPreview>` import and rendering from `src/App.tsx` — remove from both briefing and fallback views (keep the component file for potential reuse)
- [x] T024 [US3] Ensure InboxTriage renders with fallback data in `src/components/InboxTriage.tsx` — verified: component already handles undefined thread_id and missing summary

**Checkpoint**: Inbox triage visible on every load — AI-triaged when available, heuristic-triaged as fallback

---

## Phase 6: User Story 4 - Contextual Drive Files (Priority: P2)

**Goal**: No standalone "Recent Files" panel. Drive files only appear inline in meeting cards or as contextual attention items.

**Independent Test**: Load briefing — no "Recent files" section visible. Files appear in YourDay event cards when linked to meetings.

### Implementation for User Story 4

- [x] T025 [P] [US4] Remove `<RecentFiles>` rendering from fallback view in `src/App.tsx` — removed from fallback branch
- [x] T026 [P] [US4] Remove `RecentFiles` import from `src/App.tsx` — removed unused import (component file kept for chat usage)

**Checkpoint**: No "Recent files" noise — Drive files only surface when contextually relevant via linked_docs or attention items

---

## Phase 7: User Story 5 - Clean Assistant Output (Priority: P2)

**Goal**: Chat responses show clean content without tool execution logs. Compact "Working..." indicator replaces verbose ToolTimeline. Expandable detail view for debugging.

**Independent Test**: Send "Summarize my emails" in chat — see clean summary, no "Searching Gmail — COMPLETED" lines. Click "Show details" to reveal tool log.

### Implementation for User Story 5

- [x] T027 [US5] Add `toolsExpanded` local state to `MessageBubble` component in `src/components/ChatThread.tsx` — default `false`; only relevant for assistant messages with `toolEvents`
- [x] T028 [US5] Replace inline ToolTimeline rendering with compact indicator in `src/components/ChatThread.tsx` — when `message.toolEvents?.length > 0` and `message.status === 'streaming'`, show a single-line "Working..." with `RefreshCw` spinner icon (11px, animate-spin) instead of the full ToolTimeline
- [x] T029 [US5] Hide ToolTimeline when message is complete in `src/components/ChatThread.tsx` — when `message.status === 'complete'` and `toolsExpanded === false`, do not render ToolTimeline at all; only show content + blocks
- [x] T030 [US5] Add "Show details" toggle link in `src/components/ChatThread.tsx` — below the assistant message content, if `toolEvents?.length > 0`, render a small clickable text "Show details" / "Hide details" (ChevronRight icon, 10px, rotated when expanded) that toggles `toolsExpanded` state; render ToolTimeline only when expanded
- [x] T031 [US5] Surface tool errors inline in `src/components/ChatThread.tsx` — if any `toolEvent` has `status === 'error'`, show a brief red-tinted inline message below the content, without expanding the full timeline

**Checkpoint**: Chat output is clean and professional — debug info available but hidden by default

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [x] T032 [P] Verify `vite build` succeeds with all changes — build passed (2091 modules, 1.83s)
- [ ] T033 [P] Verify briefing loads from clean state (no cache) by clearing in-memory cache and reloading
- [ ] T034 Run through quickstart.md verification checklist in `specs/002-briefing-redesign/quickstart.md` — confirm all 9 items pass
- [x] T035 Remove unused imports across all modified files — InboxPreview and RecentFiles removed from App.tsx, all imports verified clean

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories (backend must return new shape)
- **US1 (Phase 3)**: Depends on Phase 2 — frontend retry needs backend retry in place
- **US2 (Phase 4)**: Depends on Phase 2 — needs `priority_group` in backend response
- **US3 (Phase 5)**: Depends on Phase 2 — needs InboxTriage data from backend; also benefits from US1 fallback logic (T013)
- **US4 (Phase 6)**: Can start after Phase 1 — only removes frontend components, no backend dependency
- **US5 (Phase 7)**: No dependencies on other stories — can start after Phase 1
- **Polish (Phase 8)**: Depends on all stories being complete

### User Story Dependencies

- **US1 (P1)**: Foundational → US1 (no other story deps)
- **US2 (P1)**: Foundational → US2 (no other story deps)
- **US3 (P1)**: Foundational → US3 (benefits from US1's fallback logic in T013, but independently testable)
- **US4 (P2)**: Setup → US4 (independent of backend changes)
- **US5 (P2)**: Setup → US5 (independent of briefing changes)

### Within Each User Story

- Backend changes (Phase 2) before frontend changes
- Type updates before component updates
- Core implementation before polish

### Parallel Opportunities

- T001 and T002 can run in parallel (same file but different sections)
- T005, T006, T007, T008 are prompt updates to the same string — run sequentially
- T025 and T026 (US4) can run in parallel with any US1/US2/US3 task
- T027-T031 (US5) can run in parallel with any US1-US4 task
- US4 and US5 are fully independent and can run in parallel with each other and with US1-US3

---

## Parallel Example: After Foundational Phase

```bash
# These can all start simultaneously after Phase 2 completes:

# Stream 1: US1 (Briefing Reliability)
Task: T011 "Add retrying state to useBriefing hook in src/hooks/useBriefing.ts"
Task: T012 "Implement frontend retry logic in src/hooks/useBriefing.ts"
Task: T013 "Update fallback UI in src/App.tsx"
Task: T014 "Show retrying indicator in src/App.tsx"

# Stream 2: US2 (Smart Calendar) — different file
Task: T015 "Refactor YourDayPanel grouped rendering in src/components/YourDayPanel.tsx"
Task: T016 "Add section headers in src/components/YourDayPanel.tsx"
...

# Stream 3: US5 (Clean Chat) — different file, no deps
Task: T027 "Add toolsExpanded state in src/components/ChatThread.tsx"
Task: T028 "Replace inline ToolTimeline with compact indicator"
...
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T010)
3. Complete Phase 3: US1 - Briefing Reliability (T011-T014)
4. **STOP and VALIDATE**: Briefing loads reliably, retries work, fallback renders
5. Deploy/demo if ready — this alone makes the product viable

### Incremental Delivery

1. Setup + Foundational → Backend returns improved briefing shape
2. Add US1 (Reliability) → Briefing never fails silently → **MVP!**
3. Add US2 (Smart Calendar) → Events are prioritized and grouped
4. Add US3 (Pre-triaged Inbox) → Inbox triage visible on load
5. Add US4 (Contextual Drive) → No more "Recent Files" noise
6. Add US5 (Clean Chat) → Professional, clean assistant output
7. Polish → Final validation

### Single Developer Strategy

Execute in this order for maximum impact:
1. Phase 1 → Phase 2 (foundation, ~2-3 hours)
2. US1 (reliability, ~1 hour)
3. US2 (calendar, ~1.5 hours)
4. US3 (inbox, ~1 hour)
5. US4 + US5 in parallel (~1 hour each)
6. Polish (~30 min)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- No test framework — manual verification against quickstart.md checklist
- All changes are modifications to existing files — no new components
- Backend prompt changes (T005-T008) must be applied to the single `BRIEFING_SYSTEM_PROMPT` string — coordinate edits
- RecentFiles component is kept in codebase for chat access — only removed from briefing rendering
- ToolTimeline component is kept — only wrapped in collapsible, not deleted
