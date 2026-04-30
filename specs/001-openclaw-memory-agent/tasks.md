# Tasks: OpenClaw Memory Agent — Proactive Meeting Prep

**Input**: Design documents from `/specs/001-openclaw-memory-agent/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/drafts-api.md

**Tests**: Included (22 critical paths identified in eng review).

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = Scanner, US2 = Draft Queue API, US3 = Draft Queue UI, US4 = Approve→Chat
- Include exact file paths in descriptions

## User Stories (from spec.md)

| ID | Story | Priority | Description |
|----|-------|----------|-------------|
| US1 | Horizon Scanner | P1 | Scan calendar 48h ahead, generate meeting prep briefs |
| US2 | Draft Queue API | P1 | CRUD endpoints for staged drafts |
| US3 | Draft Queue UI | P1 | Dashboard panel with cards, states, actions |
| US4 | Approve→Chat | P1 | Approve opens chat with brief as threadBrief |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Extract SharedJsonFileStore utility (DRY prerequisite for US2).

- [ ] T001 Define StagedDraft, ScanResult, ScanMeta, ScanError, DraftStatus, LinkedDoc, RelatedEmail types in `src/agent/draft-types.ts`
- [ ] T002 Extract SharedJsonFileStore from `src/agent/memory/memory-store.ts` into `src/lib/json-file-store.ts` — atomic read/write with temp-file + rename pattern
- [ ] T003 Write tests for SharedJsonFileStore in `src/lib/__tests__/json-file-store.test.ts` — atomic write, corrupt file recovery, concurrent access, empty file

**Independent test**: `npx vitest run src/lib/__tests__/json-file-store.test.ts` passes. Existing memory-store tests still pass after refactor.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Scanner tool guard — needed before US1 can execute any tools.

- [ ] T004 Create `ALLOWED_SCANNER_TOOLS` Set (`calendar_agenda`, `search_drive`, `search_emails`, `docs_read`) and `guardedExecuteTool()` wrapper in `src/agent/horizon-scanner.ts` — throws if tool not in whitelist
- [ ] T005 Write tests for tool guard in `src/agent/__tests__/horizon-scanner.test.ts` — allowed tools pass, write tools throw, unknown tools throw

**Independent test**: `npx vitest run src/agent/__tests__/horizon-scanner.test.ts` passes for guard tests.

---

## Phase 3: US1 — Horizon Scanner

**Story goal**: User triggers a scan and gets StagedDraft[] with meeting prep briefs for the next 48 hours.

- [ ] T006 [US1] Implement meeting filter logic in `src/agent/horizon-scanner.ts` — call `calendar_agenda(48h)`, filter >= 30min + >= 2 external attendees (domain differs from authenticated user), sort by start time, cap at 10
- [ ] T007 [US1] Implement per-meeting context gathering in `src/agent/horizon-scanner.ts` — for each meeting: `search_emails(attendee emails, 7 days)` + `search_drive(meeting title + attendee names)`
- [ ] T008 [US1] Implement LLM brief generation in `src/agent/horizon-scanner.ts` — build prompt with meeting details + email context + Drive files, call LLM, parse markdown brief (max 500 words), build StagedDraft object
- [ ] T009 [US1] Implement scan orchestrator `runHorizonScan()` in `src/agent/horizon-scanner.ts` — combines filter → gather → brief for each meeting, collects ScanMeta (meetingsFound, meetingsPrepped, errors[]), handles per-meeting LLM failure (skip + log + continue)
- [ ] T010 [US1] Write scanner tests in `src/agent/__tests__/horizon-scanner.test.ts` — mock Google APIs + LLM: test meeting filtering (>= 30min, >= 2 external), batch limit (max 10), LLM failure skip, empty calendar, scan metadata accuracy, external attendee domain detection

**Independent test**: `npx vitest run src/agent/__tests__/horizon-scanner.test.ts` — all scanner logic passes with mocked APIs.

---

## Phase 4: US2 — Draft Queue API

**Story goal**: 5 API endpoints for managing staged drafts, persisted via SharedJsonFileStore.

- [ ] T011 [US2] Implement draft store module in `src/agent/draft-store.ts` — read/write `DATA_DIR/staged-drafts.json` via SharedJsonFileStore, methods: `loadDrafts()`, `saveDrafts()`, `upsertByMeetingId()`, `purgeDrafts()` (>7 days or past meetingTime), `findById()`, `updateStatus()`
- [ ] T012 [US2] Implement `POST /api/drafts/scan` in `server.ts` — calls `runHorizonScan()` in-process, saves results via draft store, returns ScanResult. Returns 409 if scan already in progress (in-memory flag).
- [ ] T013 [P] [US2] Implement `GET /api/drafts` in `server.ts` — reads from draft store, sets `seenAt` on pending items, runs `purgeDrafts()`, returns `{ drafts, lastScan }`
- [ ] T014 [P] [US2] Implement `POST /api/drafts/:id/approve` in `server.ts` — finds draft by id, validates status is "pending", updates to "approved", builds `threadBrief` string from draft summary + meeting context, returns `{ draft, threadBrief }`. Returns 404/409 on missing/already-approved.
- [ ] T015 [P] [US2] Implement `POST /api/drafts/:id/dismiss` in `server.ts` — finds draft by id, updates to "dismissed", returns `{ success: true }`. Returns 404 on missing.
- [ ] T016 [P] [US2] Implement `PATCH /api/drafts/:id/useful` in `server.ts` — toggles `useful` boolean on draft, returns `{ success: true, useful }`. Returns 404 on missing.
- [ ] T017 [US2] Write API endpoint tests in `src/agent/__tests__/drafts-api.test.ts` — test each endpoint: scan trigger, dedup by meetingId on re-scan, auto-purge, GET sets seenAt, approve returns threadBrief, approve 404/409, dismiss 404, useful toggle, concurrent scan 409

**Independent test**: `npx vitest run src/agent/__tests__/drafts-api.test.ts` — all 5 endpoints work with mocked scanner.

---

## Phase 5: US3 — Draft Queue UI

**Story goal**: New panel in HomeDashboard showing meeting prep cards with 7 interaction states.

- [ ] T018 [P] [US3] Implement `useDrafts` hook in `src/hooks/useDrafts.ts` — fetches from `GET /api/drafts`, provides `scan()`, `approve(id)`, `dismiss(id)`, `toggleUseful(id)` actions, manages loading/error/scanning states
- [ ] T019 [P] [US3] Add API methods in `src/services/api.ts` — `scanDrafts()`, `getDrafts()`, `approveDraft(id)`, `dismissDraft(id)`, `toggleUseful(id, useful)`
- [ ] T020 [US3] Implement `DraftQueue` component in `src/components/DraftQueue.tsx` — panel with "Scan next 48h" button in header, scan metadata bar, card list sorted by meetingTime
- [ ] T021 [US3] Implement draft card in `src/components/DraftQueue.tsx` — card hierarchy: time (dim 12px) → title (bold 15px) → attendees (dim 12px) → brief preview (13px, 3 lines, expand on click) → context badges ([N docs] [N emails]) → action row (Approve green, Dismiss faint, Useful ThumbsUp toggle)
- [ ] T022 [US3] Implement 7 interaction states in `src/components/DraftQueue.tsx` — FIRST_RUN (invite + centered scan button), SCANNING (skeleton shimmer + progress "Prepping meeting 3 of 8..."), POPULATED (card list + meta bar), EMPTY (green check + "All caught up"), PARTIAL (cards + amber banner), ERROR (red banner + retry), ALL_ACTIONED ("Nice" + scan again)
- [ ] T023 [US3] Apply design system tokens in `src/components/DraftQueue.tsx` — card bg: var(--surface), border: var(--border), radius: var(--radius-md), shadow: var(--shadow-card), panel bg: var(--home-panel-bg), scan button: accent-dim/accent/accent-border text-[12px] radius-sm, useful toggle: ThumbsUp var(--text-faint) off / var(--accent) on, icons: Lucide (Calendar, Check, X, ThumbsUp, RefreshCw), animations: motion for card entrance/exit
- [ ] T024 [US3] Add accessibility attributes in `src/components/DraftQueue.tsx` — cards: role="article" aria-label="Meeting prep: {title} at {time}", buttons: aria-label, useful toggle: role="switch" aria-checked, scan button: aria-busy during scan, aria-live="polite" for status, tab navigation through cards, Enter to expand brief
- [ ] T025 [US3] Mount DraftQueue in `src/components/HomeDashboard.tsx` — import DraftQueue, render above AttentionPanel, pass useDrafts hook data

**Independent test**: DraftQueue renders in the dashboard. All 7 states visually correct. Cards display meeting data. Actions (approve/dismiss/useful) trigger API calls.

---

## Phase 6: US4 — Approve→Chat Integration

**Story goal**: Clicking "Approve" on a draft opens the AI chat panel with the meeting brief pre-loaded as conversation context.

- [ ] T026 [US4] Implement approve→chat bridge in `src/components/DraftQueue.tsx` — on approve: card shows green check animation (200ms via motion), calls `ChatContext.triggerAction()` with `threadBrief` from approve response, chat panel slides open, focus moves to chat input
- [ ] T027 [US4] Wire threadBrief injection in `src/context/ChatContext.tsx` — ensure `triggerAction()` accepts a `threadBrief` parameter and opens chat with it pre-loaded. If method already supports this, verify. If not, add parameter.
- [ ] T028 [US4] Write approve→chat integration test in `src/agent/__tests__/draft-approve-chat.test.ts` — test that approve returns threadBrief, test that ChatContext receives the brief, test focus management

**Independent test**: `npx vitest run src/agent/__tests__/draft-approve-chat.test.ts` — approve→chat flow works end-to-end.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Integration testing, type safety, responsive behavior.

- [ ] T029 Run `make typecheck` — verify no TypeScript errors across all new and modified files
- [ ] T030 Run full test suite `npm test` — verify all 22 critical paths pass, no regressions in existing tests
- [ ] T031 Manual smoke test: sign in → click "Scan next 48h" → verify cards appear → approve one → verify chat opens with brief → dismiss another → verify card removed
- [ ] T032 Update `TODOS.md` — mark P3 "Shared JsonFileStore Utility" as DONE, update P3 "Proactive Memory-Based Suggestions" to reference `docs/plans/openclaw-memory-agent.md`, add P2 "Cron Scheduling for Horizon Scanner (Phase 1.5)"

---

## Dependencies

```
Phase 1 (Setup)
  └─ T001 types ──→ T002 JsonFileStore ──→ T003 store tests
                         │
Phase 2 (Foundation)     │
  └─ T004 tool guard ──→ T005 guard tests
         │               │
Phase 3 (US1: Scanner)   │
  └─ T006─T009 scanner ──→ T010 scanner tests
         │
Phase 4 (US2: API)       ├──────────────────────────────┐
  └─ T011 draft store ───│──→ T012-T016 endpoints ──→ T017 API tests
                          │
Phase 5 (US3: UI)         │ (can start with mock API contract)
  └─ T018-T019 hooks ────│──→ T020-T024 components ──→ T025 mount
                          │
Phase 6 (US4: Chat)       │
  └─ T026-T027 bridge ───│──→ T028 integration test
                          │
Phase 7 (Polish)          │
  └─ T029-T032 ──────────┘
```

## Parallel Execution Opportunities

| Lane | Tasks | Can start when |
|------|-------|----------------|
| **Lane A** | T001 → T002 → T003 → T004 → T005 → T006-T010 → T011-T017 | Immediately |
| **Lane B** | T018 → T019 → T020-T025 | Immediately (mock API contract from contracts/drafts-api.md) |
| **Lane C** | T013, T014, T015, T016 | After T012 (scan endpoint). These 4 endpoints are independent of each other. |

**Merge points**: 
- Phase 6 (US4) requires both Lane A (API approve returns threadBrief) and Lane B (DraftQueue component) to be complete.
- Phase 7 (Polish) requires all lanes merged.

## Implementation Strategy

**MVP**: Phase 1 + Phase 2 + Phase 3 (US1) + Phase 4 (US2). Scanner works, API works, no UI yet. Testable via curl/Postman.

**First visual**: Add Phase 5 (US3). Full dashboard experience.

**Complete**: Add Phase 6 (US4). Approve→chat bridge. Ship-ready.

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 32 |
| US1 (Scanner) | 5 tasks |
| US2 (API) | 7 tasks |
| US3 (UI) | 8 tasks |
| US4 (Chat) | 3 tasks |
| Setup + Foundation | 5 tasks |
| Polish | 4 tasks |
| Parallel lanes | 3 (A: backend, B: frontend, C: independent endpoints) |
| Test tasks | 6 (T003, T005, T010, T017, T028, T030) |
