---
description: "Task list for Gmail Tab v1 — Action-First Work Surface"
---

# Tasks: Gmail Tab v1 — Action-First Work Surface

**Input**: Design documents from `/specs/004-gmail-tab-v1/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ (2 files) ✅, quickstart.md ✅

**Tests**: Included per project rules (`/Users/mohamed/.claude/rules/common/testing.md`: 80% coverage, TDD workflow) and the saved project feedback `feedback_tdd_first.md` ("Always use TDD workflow before writing implementation code"). Every implementation task has a preceding test task in the same story phase.

**Organization**: Tasks grouped by user story. US1 and US2 are both P1 (flagship MVP). US3 and US4 are P2 (follow-up on the same milestone).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4 — maps to the user story in spec.md
- File paths are absolute

## Path Conventions

Fullstack single-project layout:
- Backend: `server.ts` at repo root, `src/lib/`, `src/agent/prompts/`
- Frontend: `src/pages/`, `src/components/gmail/`, `src/hooks/`, `src/services/api.ts`
- Tests: colocated under `__tests__/` adjacent to source (Vitest convention)
- Contract tests: `tests/contract/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add dev tooling and directories that all downstream work depends on. No source code changes yet.

- [x] T001 Install `jest-axe` and `@types/jest-axe` as dev dependencies via `npm install --save-dev jest-axe @types/jest-axe`, then update `package.json` scripts and verify `npx vitest run` still passes in the baseline state
- [x] T002 [P] Create the directory `src/agent/prompts/` (for the new shared gmail enrichment prompt module, per research Decision 2)
- [x] T003 [P] Create the directory `tests/contract/` at the repo root (for the two new contract test files)

**Checkpoint**: Tooling and directories in place. No user story work yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that every user story in this feature depends on. MUST complete before Phase 3+.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Shared types and utilities

- [x] T004 [P] Add the `Bucket`, `Priority`, `RecommendedAction`, `EffortBucket`, `ThreadEnrichment`, `ThreadBrief`, `ContextChip`, `FirstClassAction`, `FreeSlot`, `EnrichedThreadsResponse`, `ThreadBriefResponse` types to `src/shared/gmail-enrichment-types.ts` (new file) exactly as defined in `specs/004-gmail-tab-v1/data-model.md`. Do not extend `src/shared/chat.ts` — `ApprovalRequest` stays untouched.

- [x] T005 [P] Add `GET`/`PUT` helper types `EnrichmentCacheFile` and `EnrichmentCacheEntry` to `src/lib/enrichment-cache-types.ts` (new file) per data-model.md section 2.

- [x] T006 Extend `src/services/api.ts` to import the new types from `src/shared/gmail-enrichment-types.ts` and export a new client method stub: `getThreadEnrichments(threads: GmailThreadSummary[]): Promise<EnrichedThreadsResponse>` and `getThreadBrief(threadId: string): Promise<ThreadBriefResponse>`. Stubs throw `Error('not implemented')` for now; real implementation lands in Phase 3.

### Shared prompt module

- [x] T007 Write a unit test at `src/agent/prompts/__tests__/gmail-enrichment.test.ts` (new file) that asserts: (a) `buildListEnrichmentPrompt(threads)` returns `{ system, user }` strings; (b) the system prompt contains the phrase "specific" and the list of allowed `RecommendedAction` values; (c) the user prompt contains each thread's subject, sender, snippet, date, and label ids but NOT any body text; (d) `buildThreadBriefPrompt(threadDetail)` returns a prompt whose user message concatenates message senders + dates + bodies capped at 2000 chars per message and 5 messages total. This test will fail until T008 lands.

- [x] T008 Create `src/agent/prompts/gmail-enrichment.ts` (new file) exporting `buildListEnrichmentPrompt(threads: GmailThreadSummary[]): { system: string; user: string }` and `buildThreadBriefPrompt(thread: GmailThreadDetail): { system: string; user: string }`. Move the current system prompt body and user-message builder from `src/lib/ai-triage.ts:15-40` into this module, extending the system prompt per research Decision 2 with: (a) the full `RecommendedAction` vocabulary from data-model.md; (b) the specificity rule from FR-019a (quote generic-verb prohibition); (c) the Quick wins vs Reference/FYI tie-breaker rule from FR-007a / clarification Q4; (d) the privacy rule — metadata only, no bodies; (e) the exact JSON output shape from contracts/ai-triage-enriched.md. Make `src/lib/ai-triage.ts` re-export these for backwards compatibility. Confirm T007 now passes.

### Enrichment cache

- [x] T009 Write a unit test at `src/lib/__tests__/enrichment-cache.test.ts` (new file) that covers: (a) cold read returns empty; (b) write + read roundtrip; (c) tmp-file + rename atomic write pattern (assert no intermediate partial file after write completes); (d) 24h TTL expiry — seed an entry with `cachedAt` 25h ago and assert read returns empty for that key; (e) `invalidateEnrichmentForThread(threadId)` removes all entries whose key starts with `{threadId}:`; (f) version-mismatch on `version: 2` discards the file and starts fresh. Test must fail initially.

- [x] T010 Create `src/lib/enrichment-cache.ts` (new file) implementing: `loadEnrichmentCache(accountKey)`, `saveEnrichmentCache(accountKey, cache)`, `getEnrichment(accountKey, threadId, lastMessageId)`, `putEnrichment(accountKey, threadId, lastMessageId, enrichment)`, `invalidateEnrichmentForThread(accountKey, threadId)`. Use `getScopedDataPath('gmail-enrichment', accountKey)` for the file path (same helper as `server.ts:463-469`). Writes go through the tmp-file + rename pattern (write to `{path}.tmp` via `fs.writeFileSync`, then `fs.renameSync({path}.tmp, path)`). TTL is 24h on `cachedAt + expiresAt`. Confirm T009 passes.

### Graceful-fallback plumbing

- [x] T011 Add a helper `invalidateEnrichmentForThread` to the bulk-action pipeline in `server.ts` — specifically, the handler at `server.ts:1761` (`POST /api/inbox-actions`) and the reply send path (wherever `/api/send-reply` lives): after a successful write, call the helper from `src/lib/enrichment-cache.ts` to drop the cache entry for the affected thread id (FR-004). Add a matching unit test in `server.test.ts` (or create it if it doesn't exist) that mocks `performInboxAction` and asserts `invalidateEnrichmentForThread` is called with the correct thread id after archive/trash/mark-read/mute.

- [x] T012 [P] Add two telemetry endpoints to `server.ts`: `POST /api/telemetry/fallback` (body: `{ reason: 'upstream_error' | 'timeout' | 'rate_limited' }`) and `POST /api/telemetry/gmail-interactive` (body: `{ msFromOpen: number, threadCount: number }`). Both validate their body shape, emit a structured JSON log line (`console.log(JSON.stringify({ event, ...body, timestamp, accountKey }))`), and return `200 OK`. Reference contracts/ai-triage-enriched.md section 5 and contracts/thread-brief.md section 6 for exact event names.

**Checkpoint**: Foundational infrastructure ready. User stories can now start in parallel.

---

## Phase 3: User Story 1 — Action-first rows replace a chronological inbox (Priority: P1) 🎯 MVP

**Goal**: Every Gmail tab thread row carries a priority indicator, recommended action chip, one-sentence "why" line, and effort estimate — computed via the extended `/api/ai-triage` endpoint with disk-persisted 24h cache.

**Independent Test**: Open the Gmail tab with an inbox of 20+ threads. Plain rows render in ≤1s. Enriched fields (priority bar, action chip, why line, effort estimate) appear progressively within 5s. Reopening within 24h loads enriched rows on first paint. Per-thread enrichment failures degrade gracefully to plain rows.

### Tests for User Story 1 (TDD — write first, confirm they fail)

- [x] T013 [P] [US1] Write contract test at `tests/contract/ai-triage-enriched.test.ts` (new file) covering all 8 fixtures from `specs/004-gmail-tab-v1/contracts/ai-triage-enriched.md` section 7: cold cache all misses; warm cache all hits; partial cache; specificity rejection (3 threads fail); Quick wins → Reference/FYI rewrite; LLM timeout 500; invalidation; legacy compatibility. Use a fixture DATA_DIR, mock `createLLMClient()`. Test must fail (endpoint not yet extended).

- [x] T014 [P] [US1] Write unit test at `src/lib/__tests__/triage.test.ts` (extend existing if present, create if not) for the new function `assignBucketsFromEnrichment(threads, enrichmentMap)`: (a) threads with priority `high` + action `draft_reply` → `needs_reply`; (b) threads with action `nudge` / `mark_done` → `waiting`; (c) threads with action `archive_subscription` / `unsubscribe` → `quick_wins`; (d) threads with priority `none` (receipts, notifications) → `reference_fyi`; (e) tie-breaker: an LLM-assigned `quick_wins` for a receipt gets rewritten to `reference_fyi`; (f) missing enrichment (failed thread) gets dropped from buckets and keeps a plain-row representation. Test must fail.

- [x] T015 [P] [US1] Write component test at `src/components/gmail/__tests__/EnrichedThreadRow.test.tsx` (new file) using `@testing-library/react` + `jest-axe`: (a) renders sender, subject, snippet, date from the base thread props; (b) renders priority bar color matching `priority` prop; (c) renders recommended action chip with the correct label from the `RecommendedAction` → display-label map; (d) renders one-line `whyItMatters` truncated at 120 chars; (e) renders effort estimate; (f) when enrichment is missing, falls back to plain row with no priority bar / chip / why line; (g) row is keyboard-focusable (`tabIndex={0}`); (h) row's `aria-label` concatenates sender, subject, priority, recommendedAction, effort; (i) `jest-axe` assertion passes. Test must fail.

- [x] T016 [P] [US1] Write hook test at `src/hooks/__tests__/useGmailPage.test.ts` (new file or extend) for the new parallel enrichment fetch: (a) `getGmailThreads` resolves first, list state populates; (b) `getThreadEnrichments` resolves later, enrichment map populates; (c) order guaranteed: list is interactive before enrichment resolves; (d) on enrichment failure, enrichment map stays empty and a `fallback` flag is set; (e) write actions (archive, reply sent) invalidate the cache entry via a new `invalidateLocalEnrichment(threadId)` method. Test must fail.

### Backend implementation for User Story 1

- [x] T017 [US1] Extend `src/lib/ai-triage.ts` to accept the richer response shape: rewrite `parseAiTriageResponse` to accept the new JSON shape from contracts/ai-triage-enriched.md (enrichments[], failed[], bucketCounts, etc.). Preserve the legacy `categories[]` path: the parser accepts either legacy or enriched LLM JSON output and normalizes to the enriched shape. Unit test the parser against 4 cases: valid enriched JSON; valid legacy JSON; malformed JSON; JSON with a generic `recommendedAction` (should end up in `failed`).

- [x] T018 [US1] Add function `assignBucketsFromEnrichment(threads, enrichmentMap)` to `src/lib/triage.ts`. Implement the 6 rules from T014. Keep the existing `triageThreads` heuristic function intact (FR-025 fallback path). Confirm T014 passes.

- [x] T019 [US1] Extend the `POST /api/ai-triage` handler in `server.ts` around line 3516 to implement the enriched contract:
  1. Accept `{ threads, legacy?, requestId? }` body.
  2. Validate and truncate `threads` to max 25.
  3. For each thread, compute cache key `{threadId}:{lastMessageId}` and look up in `loadEnrichmentCache()`.
  4. Collect cache hits into the response; collect misses into a batch to pass to the LLM.
  5. Call `buildListEnrichmentPrompt()` + `createLLMClient().complete(...)` for the misses (same `callWithRetry` pattern as existing code at `server.ts:3527-3535`, 2000ms timeout).
  6. Parse the LLM response via the extended `parseAiTriageResponse`. Apply specificity rejection (generic verbs → failed) and the Quick wins tie-breaker rewrite.
  7. `putEnrichment()` each successful result back into the disk cache.
  8. Assemble the `EnrichedThreadsResponse` envelope with enrichments[], failed[], cacheStats, bucketCounts, durationMs. Include legacy `categories[]` when `legacy: true` or as a safety default.
  9. Emit a structured log line `{ event: "gmail_enrichment_batch", ... }` with all fields from contracts/ai-triage-enriched.md section 5.
  10. On LLM timeout / failure, return 500 with `{ error, failed: [...all threadIds] }`.
  
  Confirm T013 passes (all 8 contract scenarios).

### Frontend implementation for User Story 1

- [x] T020 [US1] Implement the real `getThreadEnrichments` method in `src/services/api.ts`, replacing the T006 stub. Signature: `getThreadEnrichments(threads: GmailThreadSummary[]): Promise<EnrichedThreadsResponse>`. Posts to `/api/ai-triage` and returns the typed envelope. Add a minimal test in `src/services/__tests__/api.test.ts` (extend existing or create) that mocks `fetch` and verifies the call shape.

- [x] T021 [US1] Extend `src/hooks/useGmailPage.ts` (lines 60-94) with parallel enrichment fetch. After `Promise.all([getGmailLabels, getGmailThreads, getInboxActionHistory])` resolves, fire `getThreadEnrichments(threads)` in a detached promise that updates a new `enrichmentMap: Map<string, ThreadEnrichment>` state via a functional setter. Also add `fallbackReason: string | null` state that is set when enrichment rejects or returns non-2xx. Expose `enrichmentMap` and `fallbackReason` from the hook return. Add `invalidateLocalEnrichment(threadId)` method that removes the entry from the map. Wire it to fire after each successful bulk action. Confirm T016 passes.

- [x] T022 [US1] Create `src/components/gmail/EnrichedThreadRow.tsx` (new file, ≤250 lines). Props: `{ thread: GmailThreadSummary, enrichment?: ThreadEnrichment, selected, onSelect, onToggleSelect, isSelected, focused }`. Render:
  - 4px left priority bar (red/amber/blue/gray based on `enrichment?.priority`, absent if no enrichment)
  - Sender avatar + name (reuse the pattern from `ThreadList.tsx:106-114`)
  - Subject line
  - Recommended action chip below subject (using a new small `ActionChip` presentational sub-component in the same file; map `RecommendedAction` to display labels per data-model.md)
  - Dim one-line "why" below snippet
  - Tiny effort estimate right-aligned
  - Attachment icon + unread dot (preserve existing patterns)
  
  Row is `tabIndex={0}` with Enter/Space keyboard handlers (copy the pattern from `ThreadList.tsx:80-85`). `aria-label` concatenates sender, subject, priority, recommended action, effort. `focus-visible:ring-2 focus-visible:ring-white/20`. Skeleton fields shown when `enrichment === undefined` and `fallbackReason === null` (cold state). Confirm T015 passes.

- [x] T023 [US1] Modify `src/components/gmail/ThreadList.tsx` to accept `enrichmentMap: Map<string, ThreadEnrichment>` and `fallbackReason: string | null` as new props, then render `<EnrichedThreadRow>` for each thread instead of the inline row body (current lines 46-143). Keep the loading skeleton and empty state unchanged. Thread the props through the existing `SelectedThreadContainer` / selection patterns. Update the existing test `src/components/gmail/__tests__/ThreadList.test.tsx` to pass enrichment props.

- [x] T024 [US1] Create `src/components/gmail/SmartViewUnavailableBanner.tsx` (new file, ≤80 lines). Renders a small pill-shaped banner at the top of the Gmail tab when `fallbackReason !== null`. Copy: "Smart view unavailable — showing standard inbox." Uses existing color tokens (muted background, dim text). Dismissible via an X button that clears the banner until the next reload. Add a component test in `src/components/gmail/__tests__/SmartViewUnavailableBanner.test.tsx`.

- [x] T025 [US1] Wire the banner and fallback detection into `src/pages/GmailPage.tsx`. When `fallbackReason !== null` from the hook, render `<SmartViewUnavailableBanner />` at the top of the page AND render the existing `ThreadList` without enrichment props (the fallback path just passes an empty enrichment map). Do not yet touch the three-tab header — that's US2's job. Also call the observability telemetry endpoint `POST /api/telemetry/gmail-interactive` from a `useEffect` on first successful paint, measuring `performance.now() - mountTime`.

**Checkpoint**: User Story 1 is fully functional. Open Gmail tab → plain rows in ≤1s → enrichment fills in → reopen within 24h shows enriched rows on first paint → failure falls back to plain rows with banner.

---

## Phase 4: User Story 2 — Bucketed view replaces three tabs (Priority: P1)

**Goal**: Replace the Gmail tab's three-tab header (Inbox / Triage / Saved) with four action-oriented buckets: Needs reply, Waiting on others, Quick wins, Reference/FYI. Saved moves behind a header dropdown. "Show raw inbox" toggle remains available.

**Independent Test**: Open the Gmail tab. See four bucket sections with counts, Reference/FYI collapsed, no three-tab header. Toggle raw inbox to flatten. Open Saved from the header dropdown. Send a reply to a thread in Needs reply — confirm the thread relocates to Waiting on others on next refresh.

### Tests for User Story 2

- [ ] T026 [P] [US2] Write component test at `src/components/gmail/__tests__/BucketSection.test.tsx` (new file): (a) renders header with bucket label, count, chevron; (b) `defaultExpanded: false` starts collapsed, clicking header expands; (c) `aria-expanded` updates; (d) keyboard Enter/Space on header toggles; (e) jest-axe passes. Test must fail.

- [ ] T027 [P] [US2] Write component test at `src/components/gmail/__tests__/BucketedThreadList.test.tsx` (new file): (a) groups threads by bucket via `assignBucketsFromEnrichment`; (b) renders exactly four sections in the order Needs reply / Waiting / Quick wins / Reference/FYI; (c) each section header shows count from `bucketCounts`; (d) Reference/FYI collapsed by default; (e) `Show raw inbox` toggle flattens to chronological list; (f) toggling back restores expansion state; (g) graceful fallback: when `fallbackReason !== null`, renders the legacy `<GmailTriageView>` three-tab fallback instead of buckets; (h) jest-axe passes. Test must fail.

- [ ] T028 [P] [US2] Write integration test at `src/pages/__tests__/GmailPage.test.tsx` (extend existing or create) for the bucket-relocation flow: (a) mount page with a mocked threads + enrichments payload where thread A is in Needs reply; (b) simulate a reply-sent action on thread A via the hook's `invalidateLocalEnrichment`; (c) mock the next enrichment refetch to return thread A with action `nudge` / bucket `waiting`; (d) assert thread A renders in the Waiting bucket, Needs reply count decrements, Waiting count increments. Test must fail.

### Implementation for User Story 2

- [ ] T029 [P] [US2] Create `src/components/gmail/BucketSection.tsx` (new file, ≤150 lines). Collapsible section with header (label + count badge + chevron) and children. Uses `aria-expanded`, Enter/Space keyboard toggle — copy the pattern from `InboxTriage.tsx:125-132`. Accepts `defaultExpanded` prop and internal `open` state. Confirm T026 passes.

- [ ] T030 [US2] Create `src/components/gmail/BucketedThreadList.tsx` (new file, ≤250 lines). Props: `{ threads, enrichmentMap, bucketCounts, fallbackReason, showRawInbox, onToggleRawInbox, ...rowProps }`. Implementation:
  1. If `fallbackReason !== null`, render `<GmailTriageView>` (existing fallback path) instead of buckets.
  2. If `showRawInbox`, render a flat `<ThreadList>` with all threads + enrichment map.
  3. Otherwise, call `assignBucketsFromEnrichment(threads, enrichmentMap)` from `src/lib/triage.ts`, then render one `<BucketSection>` per bucket in the fixed order from data-model.md section 4. Within each section, render `<EnrichedThreadRow>` for each thread in that bucket.
  4. Expose a "Show raw inbox" toggle button at the top of the section list.
  
  Confirm T027 passes.

- [ ] T031 [US2] Modify `src/pages/GmailPage.tsx` to replace the three-tab header (the tabs state + tab bar JSX around lines 38-52 and 164-168) with:
  - The `<BucketedThreadList>` component
  - A "Show raw inbox" toggle at the top
  - A "Saved" header dropdown that opens a popover containing the existing `<SavedThreadList>` component (no change to that component's internals)
  - The smart-view banner from T024 stays in place
  
  Preserve all existing header elements: search box, label filter, bulk action bar, refresh button. The raw-inbox toggle flips `showRawInbox` state in a `useState` inside `GmailPage`. Confirm T028 passes.

- [ ] T032 [US2] Add a `useEffect` in `GmailPage.tsx` (or extend `useGmailPage`) that re-fetches enrichment when the user performs a write action on any thread, ensuring the bucket relocation (FR-012) happens on the next refresh. Verify via the T028 test that the relocation works end-to-end.

**Checkpoint**: User Story 2 is fully functional. Gmail tab shows four buckets by default, Saved behind dropdown, raw-inbox toggle works, actions cause bucket relocation.

---

## Phase 5: User Story 3 — Inline quick actions eliminate routine chat trips (Priority: P2)

**Goal**: Each row exposes bucket-specific quick actions on hover/focus. Read-only actions fire directly with undo. Write actions route through the reused `ApprovalCard` from `ChatThread.tsx:578-701`. "Draft reply" renders inline via the reused `InlineReplyCompose.tsx`.

**Independent Test**: Hover over a Needs reply row → see Draft reply / Snooze 1 day / Delegate buttons. Click Archive on a Quick wins row → row disappears with undo toast. Click Unsubscribe → see the existing approval card. Click Draft reply → inline composer appears under the row with the draft prepopulated.

### Tests for User Story 3

- [ ] T033 [P] [US3] Write component test at `src/components/gmail/__tests__/QuickActionMenu.test.tsx` (new file): (a) renders nothing when not hovered/focused; (b) renders Needs reply action set when `bucket: 'needs_reply'`; (c) renders Quick wins set when `bucket: 'quick_wins'`; (d) renders Waiting set when `bucket: 'waiting'`; (e) keyboard focus (Tab) reaches every button; (f) clicking a direct action fires `onDirectAction` with the action id; (g) clicking an approval action fires `onRequestApproval` with an `ApprovalRequest` built from the quick action's `buildApproval` function; (h) jest-axe passes. Test must fail.

- [ ] T034 [P] [US3] Write integration test at `src/components/gmail/__tests__/QuickActionFlow.test.tsx` (new file) covering the three end-to-end flows: (a) direct archive + undo — mock `performBulkAction`, click Archive, assert thread removed + undo toast shown, click undo, assert thread restored; (b) approval-card unsubscribe — click Unsubscribe, assert `ApprovalCard` (imported from `ChatThread.tsx`) renders with the correct `ApprovalRequest`, click Confirm, assert direct API call fires; (c) inline draft reply — click Draft reply, assert `api.draftReply(threadId)` is called, assert `InlineReplyCompose` mounts beneath the row with the returned draft. Test must fail.

- [ ] T035 [P] [US3] Write component test at `src/components/gmail/__tests__/EnrichedThreadRow.accessibility.test.tsx` (new file, or extend T015) specifically for Q1 clarification: (a) Tab from outside the row list walks into the first row, then into its quick-action buttons in order; (b) focus ring visible (assert computed style has an outline or ring); (c) screen-reader accessible name includes sender + subject + priority + recommended action + effort. Test must fail.

### Implementation for User Story 3

- [ ] T036 [US3] Add a thin wrapper `api.performApprovedToolAction(toolName, approval): Promise<void>` to `src/services/api.ts`. It POSTs `{ toolName, approval }` to a new `POST /api/tools/approve` endpoint and throws on non-2xx. The purpose is to execute an approved tool action from the Gmail tab without the ChatContext `approveAction` path (which requires a chat message id). Add a minimal test in `src/services/__tests__/api.test.ts`.

- [ ] T037 [US3] Add `POST /api/tools/approve` handler in `server.ts`. Body: `{ toolName, approval: ApprovalRequest }`. It dispatches to the same server-side tool handlers that chat approvals use. For v1, implement only the tool names used by the quick actions: `unsubscribe_from_sender`, `create_gmail_filter`, `delegate_thread`. Each dispatches via `executeGws` (following the pattern in `src/agent/tools.ts:1962-1965`). Add a contract test at `tests/contract/tools-approve.test.ts` covering happy path + each tool.

- [ ] T038 [US3] Create `src/components/gmail/QuickActionMenu.tsx` (new file, ≤200 lines). Props: `{ thread, bucket, enrichment, onDirectAction, onRequestApproval }`. Implementation:
  1. A static `QUICK_ACTION_REGISTRY: Record<Bucket, QuickAction[]>` mapping each bucket to its action set (from data-model.md section 5).
  2. Renders a horizontal row of icon buttons for the current bucket's actions.
  3. Each button is `tabIndex={0}` and has `aria-label` with the action name.
  4. Uses Tailwind classes `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` so the menu reveals on either hover OR focus (Q1 clarification).
  5. For `execution.kind === 'direct'` actions, `onClick` fires `onDirectAction(action.id)`.
  6. For `execution.kind === 'approval'` actions, `onClick` calls `action.execution.buildApproval(thread)` and fires `onRequestApproval(approvalRequest)`.
  
  Confirm T033 passes.

- [ ] T039 [US3] Integrate `QuickActionMenu` into `EnrichedThreadRow.tsx`. Add the menu inside the row's focus group (so `group-focus-within` works). Wire `onDirectAction` to the bulk action pipeline (via a new `onQuickAction` callback prop passed down from `useGmailPage` → `GmailPage` → `BucketedThreadList` → `ThreadList` → `EnrichedThreadRow`). Wire `onRequestApproval` to a new local `pendingApproval` state on `EnrichedThreadRow` that renders an imported `ApprovalCard` inline beneath the row when set. Confirm T035 passes.

- [ ] T040 [US3] Add direct-action handling in `useGmailPage.ts`:
  - `archive`, `snooze_1d`, `mark_done`, `remind_me_3d`: call `performBulkAction` with the appropriate action type, then call `invalidateLocalEnrichment(threadId)` and show an undo toast via existing `recentAction` state.
  - `snooze_1d` and `remind_me_3d` additionally call `POST /api/followups` with `{ relatedThreadId: threadId, dueAt: threadPlusN }` to create a follow-up entry (FR-017). The follow-up backend already exists — no new endpoint needed.
  - `delegate`: opens an approval card via `onRequestApproval` rather than direct-firing. (Moves delegate to approval execution mode.)

- [ ] T041 [US3] Import `ApprovalCard` directly from `src/components/ChatThread.tsx` (no re-export, no wrapper — verified standalone per research Decision 5) into `EnrichedThreadRow.tsx`. Render it inline with `onApprove={(updated) => { void api.performApprovedToolAction(updated.toolName, updated); setPendingApproval(null); }}` and `onCancel={() => setPendingApproval(null)}`. Write an integration test in `src/components/gmail/__tests__/ApprovalCardReuse.test.tsx` that asserts the imported component is the same function reference as the one used in `ChatThread` — proving there's no duplicate UI.

- [ ] T042 [US3] Wire the `Draft reply` direct action. Instead of firing a bulk action, it:
  1. Calls `api.draftReply(thread.id)` (existing method).
  2. Sets a new `draftReplyState` on the row (or lifts it to `ThreadList` via `useGmailPage`).
  3. Renders `<InlineReplyCompose>` (existing component, unchanged) inline beneath the row with the draft response as props.
  4. On `onSent`, clears the state, calls `invalidateLocalEnrichment`, and triggers a refresh so the thread relocates to Waiting.
  
  Confirm T034 passes.

**Checkpoint**: User Story 3 is fully functional. Quick actions are keyboard-reachable, direct actions fire with undo, write actions use the imported approval card, draft reply uses the imported inline composer. Zero new approval UIs.

---

## Phase 6: User Story 4 — Thread reader becomes a decision surface (Priority: P2)

**Goal**: Opening any thread in `ThreadReader.tsx` renders a new `ThreadDecisionHeader` above the message chain showing a one-sentence summary, specific recommended action, context chips, and first-class action buttons. "Pick times" opens an inline mini-calendar.

**Independent Test**: Open a thread. Message body renders immediately. Decision header skeleton appears above, resolves within 5s to summary + recommended action + context chips + action row. Click "Pick times" → inline mini-calendar shows 7-day free slots → clicking a slot drafts a reply with the time. Fallback: when brief fails, header shows only a Draft reply button; body still renders.

### Tests for User Story 4

- [ ] T043 [P] [US4] Write contract test at `tests/contract/thread-brief.test.ts` (new file) covering all 9 fixtures from `specs/004-gmail-tab-v1/contracts/thread-brief.md` section 7: cold fetch success; cache hit; generic recommendation → fallback; malformed JSON → fallback; LLM timeout → fallback; thread not found 404; invalidation; summary length cap; `firstClassActions` guarantee. Test must fail.

- [ ] T044 [P] [US4] Write hook test at `src/hooks/__tests__/useThreadBrief.test.ts` (new file): (a) mount hook with a threadId, assert `loading: true` then `brief: ThreadBrief` after fetch resolves; (b) second call for same threadId uses memo cache (no second fetch); (c) on failure returns `brief: { isFallback: true, ... }`. Test must fail.

- [ ] T045 [P] [US4] Write component test at `src/components/gmail/__tests__/ThreadDecisionHeader.test.tsx` (new file): (a) renders skeleton when `brief === undefined`; (b) renders summary + recommendedAction + context chips + first-class action row when brief is ready; (c) when `brief.isFallback === true`, renders only Draft reply button + first deterministic context chip; (d) keyboard focus ring visible; (e) jest-axe passes. Test must fail.

- [ ] T046 [P] [US4] Write component test at `src/components/gmail/__tests__/PickTimesInlineCalendar.test.tsx` (new file): (a) fetches `/api/calendar/free-slots` on mount; (b) renders a 7-day grid of slot chips; (c) empty-slots case shows the "No free slots in the next week" copy; (d) clicking a slot calls `onSlotSelected(slot)`; (e) keyboard navigation between slots; (f) jest-axe passes. Test must fail.

### Backend implementation for User Story 4

- [ ] T047 [US4] Add the session-scoped brief cache to `server.ts`: a module-level `const threadBriefCache = new Map<string, { brief: ThreadBrief; cachedAt: string }>()`. Add `invalidateThreadBrief(threadId)` and call it from the same places as `invalidateEnrichmentForThread` in T011 so cache invalidation is unified.

- [ ] T048 [US4] Implement `GET /api/thread-brief/:threadId` in `server.ts`:
  1. Validate `threadId` matches `^[A-Za-z0-9_-]+$`. 400 on failure.
  2. Lookup `threadBriefCache.get(threadId)`; if present, return with `cacheHit: true`.
  3. Fetch the thread via the same logic as `server.ts:1578` (`/api/gmail/thread/:threadId`).
  4. Call `buildThreadBriefPrompt(threadDetail)` from `src/agent/prompts/gmail-enrichment.ts`, concatenate up to 5 messages with bodies capped at 2000 chars each (per FR-006b — body transmission allowed only here).
  5. Call `createLLMClient().complete(...)` with a 5000ms timeout.
  6. Parse the response; apply specificity rule (generic verbs → `isFallback: true`); cap summary at 140 chars; ensure `firstClassActions` starts with `{ kind: 'draft_reply' }`; merge deterministic chips.
  7. Store in `threadBriefCache`.
  8. Emit `{ event: "thread_brief_complete", ... }` log line.
  9. Return `ThreadBriefResponse`.
  
  Confirm T043 passes.

- [ ] T049 [US4] Implement `GET /api/calendar/free-slots?horizonDays=7` in `server.ts`. Uses `executeGws(['calendar', '+agenda', '--days', '7', '--format', 'json'])` — same pattern as the existing `calendar_agenda` tool at `src/agent/tools.ts:1927-1960`. Parses the returned events, computes busy periods, diffs against business hours (9 AM–6 PM in the calendar's primary timezone), generates 30-min and 60-min candidate slots, returns `FreeSlot[]`. Handle the empty case (no free slots) by returning an empty array. Add a contract test at `tests/contract/calendar-free-slots.test.ts`.

### Frontend implementation for User Story 4

- [ ] T050 [US4] Implement `getThreadBrief` in `src/services/api.ts` (replaces the T006 stub). Also add `getFreeSlots(horizonDays: number): Promise<FreeSlot[]>`. Tests in `src/services/__tests__/api.test.ts`.

- [ ] T051 [US4] Create `src/hooks/useThreadBrief.ts` (new file, ≤100 lines). Takes a `threadId | null`, returns `{ brief, loading, error }`. Uses `useRef<Map<string, ThreadBrief>>` as a per-hook-instance memo cache. Fires `api.getThreadBrief(threadId)` on threadId change. Confirm T044 passes.

- [ ] T052 [US4] Create `src/components/gmail/ThreadDecisionHeader.tsx` (new file, ≤250 lines). Props: `{ threadId, onDraftReply, onPickTimes, onDecline, onDelegate, onSaveToDrive }`. Calls `useThreadBrief(threadId)`. Renders:
  - Skeleton shimmer when `loading === true`
  - When brief ready: summary (large text), recommendedAction (medium text with accent), context chips row (reuse chip visual pattern from existing components), action button row
  - When `brief.isFallback === true`: only Draft reply button + first deterministic chip
  - All buttons `tabIndex={0}` with visible focus rings
  
  Confirm T045 passes.

- [ ] T053 [US4] Create `src/components/gmail/PickTimesInlineCalendar.tsx` (new file, ≤200 lines). Props: `{ onSlotSelected, onClose }`. Calls `api.getFreeSlots(7)` on mount. Renders a 7-day grid (one column per day) with slot chips. Empty case shows the "No free slots in the next week — offer 'next Monday or later'?" copy per spec edge case. Arrow-key navigation between slots. Confirm T046 passes.

- [ ] T054 [US4] Modify `src/components/gmail/ThreadReader.tsx` to mount `<ThreadDecisionHeader>` above the message scroll region. Specifically, insert it at line ~331 of the current file (above the `messagesRegion` div). Pass callbacks for each action:
  - `onDraftReply`: triggers the existing `handleReply` path (line 210-224) — no change
  - `onPickTimes`: toggles local state to render `<PickTimesInlineCalendar>` inline beneath the header; on slot selection, opens inline reply composer pre-filled with the slot
  - `onDecline`, `onDelegate`, `onSaveToDrive`: fire via the new `/api/tools/approve` endpoint with an `ApprovalRequest`
  
  The message body (`messagesRegion`) renders unchanged — header does NOT block body render (FR-020).

**Checkpoint**: User Story 4 is fully functional. Thread reader shows decision header above every thread, Pick times works end-to-end, fallback degrades gracefully.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Observability, documentation, and final verification.

- [ ] T055 [P] Wire the frontend telemetry calls. In `useGmailPage.ts`, when `fallbackReason` is set, call `api.reportFallback(reason)` which POSTs `/api/telemetry/fallback`. In `GmailPage.tsx`, on first paint of enriched rows, call `api.reportGmailInteractive(msFromOpen, threadCount)` which POSTs `/api/telemetry/gmail-interactive`. These complete FR-027.

- [ ] T056 [P] Add unit test at `src/lib/__tests__/ai-triage.test.ts` covering the specificity rejection rule (FR-019a) in `parseAiTriageResponse`: for each of the generic strings `"reply"`, `"follow up"`, `"draft a response"`, `"respond"`, `"read"`, assert the thread ends up in `failed[]`.

- [ ] T057 [P] Add a jest-axe smoke test at `src/pages/__tests__/GmailPage.accessibility.test.tsx` that mounts the full GmailPage with mocked data and asserts `expect(await axe(container)).toHaveNoViolations()`. This is the final accessibility gate.

- [ ] T058 Run the quickstart.md flow end-to-end manually against `make dev`. Check every pass/fail observation. File any regressions as follow-up bugs, not task additions.

- [ ] T059 Review `.gmail-enrichment.{accountKey}.json` on disk after an hour of normal use. Confirm the file is well-formed JSON, entries respect the 24h TTL, and `version: 1` is preserved.

- [ ] T060 [P] Update `CLAUDE.md` "Active Technologies" section (already partially updated by `update-agent-context.sh` in Phase 1 of the plan) to note the new `/api/ai-triage` enriched contract, the new `/api/thread-brief/:threadId` endpoint, the new `.gmail-enrichment.{accountKey}.json` state file, and the new dev dependency `jest-axe`. Keep entries concise (one line each).

- [ ] T061 Verify the `ApprovalCard` reuse claim with a grep: `grep -rn "ApprovalCard" src/components/gmail/` should show the import statements but no duplicate component definition. Document the import count in the PR description.

- [ ] T062 Commit each phase independently. Final commit should land with all tests green: `npx vitest run` passes (80%+ coverage via `npm run test:coverage`), `npx tsc --noEmit` passes, the app runs via `make dev`, and `make build` succeeds.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2 — MVP
- **User Story 2 (Phase 4)**: Depends on Phase 2 — but in practice reuses T017 and T018 (which belong to US1 implementation), so US2 can only begin after T017/T018. See "User Story Dependencies" below.
- **User Story 3 (Phase 5)**: Depends on Phase 2 and on the `EnrichedThreadRow` shell from Phase 3 (T022). Quick actions mount inside the enriched row.
- **User Story 4 (Phase 6)**: Depends only on Phase 2. Independent of US1–US3 for the thread reader surface, but shares the `src/agent/prompts/gmail-enrichment.ts` module from T008.
- **Polish (Phase 7)**: Depends on all user stories being complete.

### User Story Dependencies

- **US1** is the foundation: it produces the enrichment data, the disk cache, the extended endpoint, the hook wiring, and the `EnrichedThreadRow` shell. Everything else in Gmail Tab v1 reads from its output. **MVP stops here.**
- **US2** depends on US1's `assignBucketsFromEnrichment` (T018) and `EnrichedThreadRow` (T022). Incremental layer on top.
- **US3** depends on US1's `EnrichedThreadRow` (T022) for row mount points but is otherwise independent. Can run in parallel with US2 after T022 lands.
- **US4** depends only on the shared prompt module (T008) and can run fully in parallel with US1–US3 after Phase 2 completes. It touches `ThreadReader.tsx`, not `GmailPage.tsx` or `ThreadList.tsx`.

### Within Each User Story

- Tests (Tnn [P] [USx]) MUST be written and FAIL before the corresponding implementation task.
- Backend tasks precede frontend consumers.
- Models / types precede services.
- Services precede endpoints.
- Endpoints precede UI.
- Story complete (all acceptance scenarios pass) before moving to the next priority.

### Parallel Opportunities

- **Phase 1**: T002, T003 can run in parallel with T001.
- **Phase 2**: T004, T005, T012 can run in parallel. T007 → T008, T009 → T010 are sequential pairs. T011 blocks on cache module T010.
- **Phase 3 (US1)**: T013, T014, T015, T016 all in parallel (tests in different files). T020, T022, T024 can run in parallel once their test tasks are green.
- **Phase 4 (US2)**: T026, T027, T028 tests in parallel. T029 in parallel with its test. T030, T031, T032 are sequential (all touch `GmailPage.tsx` or `BucketedThreadList.tsx`).
- **Phase 5 (US3)**: T033, T034, T035 tests in parallel. T036, T037 can run in parallel. T038, T039, T040, T041, T042 mostly sequential (they all touch `EnrichedThreadRow.tsx` or `useGmailPage.ts`).
- **Phase 6 (US4)**: T043, T044, T045, T046 all in parallel. T047, T048, T049 backend can run in parallel. T050, T051, T052, T053 frontend in parallel after backend. T054 last (touches `ThreadReader.tsx`).
- **Phase 7**: T055, T056, T057, T060 all in parallel. T058, T059, T061, T062 sequential (manual/validation).

---

## Parallel Execution Examples

### Phase 3 (User Story 1) — test tasks in parallel

```bash
# Launch all US1 test tasks in parallel (they write to different files):
Task: "T013 — Contract test at tests/contract/ai-triage-enriched.test.ts"
Task: "T014 — Unit test at src/lib/__tests__/triage.test.ts"
Task: "T015 — Component test at src/components/gmail/__tests__/EnrichedThreadRow.test.tsx"
Task: "T016 — Hook test at src/hooks/__tests__/useGmailPage.test.ts"
```

### Phase 6 (User Story 4) — backend in parallel

```bash
# Once the test tasks are green, launch US4 backend implementation in parallel:
Task: "T047 — Session brief cache in server.ts"
Task: "T048 — GET /api/thread-brief/:threadId handler in server.ts"  # depends on T047
Task: "T049 — GET /api/calendar/free-slots handler in server.ts"      # independent
```

Note: T048 depends on T047 (same file, later in the same sequential edit). They cannot be literally parallel in practice, but T049 can be done in a separate commit while T047→T048 is in progress.

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational — types, prompt extraction, cache module, fallback plumbing).
3. Complete Phase 3 (US1 — action-first rows).
4. **STOP and VALIDATE** against the Story 1 independent-test criteria in spec.md.
5. Deploy / demo the MVP.

At this checkpoint, the Gmail tab has enriched rows without bucketing, without quick actions, and without the decision header. That is still a meaningful product improvement: users see priority, recommended action, why, and effort on every row.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → enriched rows → **MVP demo**.
3. US2 → bucketed view → second increment.
4. US3 → inline quick actions → third increment. Big product win.
5. US4 → decision header → fourth increment. Rounds out the thesis.
6. Polish → observability + full quickstart pass.

Each increment is independently testable per the checkpoints.

### Parallel Team Strategy

With two developers:

1. Both pair on Setup + Foundational together (T001–T012).
2. Dev A starts US1 (T013–T025).
3. Dev B starts US4 (T043–T054) in parallel — US4 is the most independent story because it touches `ThreadReader.tsx` instead of `GmailPage.tsx`/`ThreadList.tsx`.
4. Once US1 lands T017 (`parseAiTriageResponse`) and T018 (`assignBucketsFromEnrichment`), Dev A can start US2 (T026–T032).
5. Once US1 lands T022 (`EnrichedThreadRow`), either dev can start US3 (T033–T042).
6. Polish (T055–T062) is a joint final pass.

---

## Notes

- Every test task [P] writes to a different file from its peers, so they are truly parallelizable.
- The [Story] label on every Phase 3+ task preserves traceability back to `spec.md`.
- TDD is enforced per saved feedback: tests land and fail before the corresponding implementation.
- No task changes `src/components/ChatThread.tsx` or `src/shared/chat.ts` — `ApprovalCard` and `ApprovalRequest` are reused unmodified (FR-015, research Decision 5).
- No task changes `src/components/gmail/InlineReplyCompose.tsx` — it's reused unmodified from the thread reader into the Gmail tab row context (FR-016, research Decision 5 + T042).
- No task changes `src/agent/llm-client.ts` — `createLLMClient()` is reused for both enrichment and brief endpoints (research Decisions 1 + 4).
- Commit cadence: one commit per task is the minimum; larger commits may bundle a test task with its paired implementation task if it keeps the history clean.
- Each checkpoint is a natural place to stop, demo, and validate against the spec's success criteria.

---

## Task Count Summary

| Phase | Tasks | Parallel potential |
|---|---|---|
| Phase 1 — Setup | 3 (T001–T003) | T002, T003 parallel |
| Phase 2 — Foundational | 9 (T004–T012) | T004, T005, T012 parallel; T007→T008 and T009→T010 paired |
| Phase 3 — US1 (P1, MVP) | 13 (T013–T025) | 4 test tasks parallel; 3 impl tasks parallel |
| Phase 4 — US2 (P1) | 7 (T026–T032) | 3 test tasks parallel |
| Phase 5 — US3 (P2) | 10 (T033–T042) | 3 test tasks parallel; 2 backend parallel |
| Phase 6 — US4 (P2) | 12 (T043–T054) | 4 test tasks parallel; 3 backend parallel; 4 frontend parallel |
| Phase 7 — Polish | 8 (T055–T062) | 4 in parallel |
| **Total** | **62 tasks** | ~24 genuinely parallelizable |

**MVP scope** = Phases 1 + 2 + 3 (T001–T025) = **25 tasks** for a shippable demo.
