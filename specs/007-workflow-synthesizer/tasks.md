---

description: "Tasks: Workflow Synthesizer (007)"
---

# Tasks: Workflow Synthesizer

**Input**: Design documents from `/specs/007-workflow-synthesizer/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/api.md ✅, quickstart.md ✅

**Tests**: REQUIRED. Constitution Principle III mandates TDD (Red → Green → Refactor) for all new features. Test tasks precede implementation tasks within each phase.

**Organization**: Tasks are grouped by user story so the kill-criterion gate (US1 dogfood for 7 days) can fire before US2/US3 are implemented.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User-story label (US1, US2, US3); omitted for shared phases
- All paths are absolute under `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/`, shown here as repo-root-relative for brevity

## Path Conventions

- Backend agent code: `src/agent/synthesizer/`
- Frontend components: `src/components/synthesizer/`
- Existing modified files: `src/agent/tool-dispatch.ts`, `src/agent/workflow-scheduler.ts`, `src/pages/AutomationsPage.tsx`, `src/services/api.ts`, `server.ts`
- Tests live in `__tests__/` adjacent to source (Vitest convention)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the directory skeleton and the shared type module so all later tasks can import from a stable surface.

- [X] T001 Create directory `src/agent/synthesizer/` and `src/agent/synthesizer/__tests__/`
- [X] T002 Create directory `src/components/synthesizer/`
- [X] T003 [P] Define shared types in `src/agent/synthesizer/types.ts` from data-model.md (ToolInvocation, InvocationLogFile, WorkflowProposal, ProposalSampleFile, ProposalSample, SynthesisSettings) — all `readonly` interfaces, no implementations
- [X] T004 [P] Add empty placeholder files (no logic yet, just `export {}`) to lock import paths: `src/agent/synthesizer/observer.ts`, `invocation-log.ts`, `args-hasher.ts`, `detector.ts`, `proposal-store.ts`, `sample-store.ts`, `settings.ts`, `ring-buffer.ts`
- [X] T005 [P] Verify `make typecheck` passes with the new skeleton

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the substrate every user story shares: settings, args-hasher, in-memory ring buffer, and a wired observation hook that is a no-op by default. Without these, no observation can occur and no test can be written for downstream behavior.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first, must FAIL before implementation)

- [X] T006 [P] Test in `src/agent/synthesizer/__tests__/args-hasher.test.ts`: stable 16-hex output, identical shapes hash identically, value differences with same shape collide intentionally, nested objects collapse at depth ≤ 2, arrays bucket lengths into `0|1|2-5|6+`, no value tokens in output
- [X] T007 [P] Test in `src/agent/synthesizer/__tests__/settings.test.ts`: defaults match data-model.md Entity 5, range validation rejects out-of-range fields per ranges table, partial updates merge correctly, settings persisted via atomic write
- [X] T008 [P] Test in `src/agent/synthesizer/__tests__/ring-buffer.test.ts`: capacity 100 default, FIFO eviction, lookup by sequence-of-tool-names returns most recent matching dispatch with full args, never persists to disk
- [X] T009 [P] Test in `src/agent/synthesizer/__tests__/observer.test.ts`: no-op when `enabled: false`, single append per call when enabled, never throws, runs synchronously without awaiting filesystem in caller

### Implementation

- [X] T010 [P] Implement `src/agent/synthesizer/args-hasher.ts` per research R2 (shape walk, depth ≤ 2, array length-bucket, SHA-1 truncated to 16 hex)
- [X] T011 [P] Implement `src/agent/synthesizer/settings.ts` with default `enabled: false`, atomic-write persistence via `getScopedDataPath()`, range validation matching data-model Entity 5
- [X] T012 [P] Implement `src/agent/synthesizer/ring-buffer.ts` (in-memory only, capacity 100, FIFO, `findRecentSequence(names: string[])` returns matching dispatch with full args)
- [X] T013 Implement `src/agent/synthesizer/observer.ts` `recordInvocation(input)` per contracts/api.md internal contract: try/caught, no-op when disabled, hashes args, appends to ring buffer (literal) and queues invocation-log append (hash-only)
- [X] T014 Wire observer hook into `src/agent/tool-dispatch.ts` at the single funnel point after dispatch resolves — fire-and-forget, never throws into the dispatch path
- [X] T015 Verify `src/agent/workflow-scheduler.ts` calls reach the same hook (it dispatches through `executeDynamicTool` via the same path; add a test in `src/agent/synthesizer/__tests__/scheduler-integration.test.ts` to assert scheduler-sourced invocations are recorded with `source: 'scheduler'`)
- [X] T016 Run `npm run test:coverage -- src/agent/synthesizer` and confirm ≥ 80% on the foundational modules

**Checkpoint**: Observer hook is wired and silent by default. Foundation ready — user-story implementation can now begin.

---

## Phase 3: User Story 1 — Opt-in observation (Priority: P1) 🎯 MVP

**Goal**: Ship an opt-in, hash-only invocation log with a Settings toggle and an audit view. This alone is the kill-criterion gate: dogfood for 7 days, decide whether US2/US3 are worth building.

**Independent Test**: Toggle `enableWorkflowSynthesis` ON in Settings, run the agent for a session, open the Activity Log view, verify (1) every tool call appears with name + opaque hash, (2) toggling OFF stops new entries, (3) "Clear log" empties the persisted file. No proposals or promotion path required.

### Tests for User Story 1 (write first, must FAIL)

- [X] T017 [P] [US1] Test in `src/agent/synthesizer/__tests__/invocation-log.test.ts`: append is atomic (temp + rename), eviction by both `logCapEntries` cap and `logRetentionDays` age, malformed JSON falls back to empty (matching `dynamic-tool-registry`), per-account scoping via `getScopedDataPath()`
- [X] T018 [P] [US1] Test in `src/agent/synthesizer/__tests__/observer-flag.test.ts`: flipping `enabled: true → false` stops new appends within one dispatch (SC-005), flipping back to ON resumes within one dispatch
- [X] T019 [P] [US1] Test in `src/agent/synthesizer/__tests__/synthesizer-privacy.test.ts`: seed dispatch args with PII sentinels (`__SENTINEL_EMAIL_BODY__`, `__SENTINEL_RECIPIENT__`, `__SENTINEL_SUBJECT__`), assert tokens never appear in `.tool-invocation-log.*.json` (SC-006)
- [X] T020 [P] [US1] Test in `src/agent/synthesizer/__tests__/observer-perf.test.ts`: 1000-iteration microbench, assert observer p95 ≤ 1 ms (SC-001)
- [X] T021 [P] [US1] Test in `src/agent/synthesizer/__tests__/observer-concurrent.test.ts`: simulate 1000 concurrent appends from chat + scheduler, assert no log corruption (SC-004)
- [X] T022 [P] [US1] Contract tests in `__tests__/api/synthesizer-settings.test.ts` for `GET /api/synthesizer/settings` and `PATCH /api/synthesizer/settings` per contracts/api.md (defaults, range rejection, partial merge)
- [X] T023 [P] [US1] Contract tests in `__tests__/api/synthesizer-log.test.ts` for `GET /api/synthesizer/log` (limit clamping, newest-first ordering, empty when disabled) and `DELETE /api/synthesizer/log` (clears file, returns deletedCount)

### Implementation for User Story 1

- [X] T024 [P] [US1] Implement `src/agent/synthesizer/invocation-log.ts`: `appendEntry`, `loadLog`, `clearLog`, `pruneByCapAndAge` — all using atomic writes via `getScopedDataPath('.tool-invocation-log')`
- [X] T025 [US1] Wire `invocation-log.ts` into `observer.ts`: persist hash-only ToolInvocation on every recorded dispatch when `enabled`
- [X] T026 [US1] Add 4 endpoints in `server.ts`: `GET /api/synthesizer/settings`, `PATCH /api/synthesizer/settings`, `GET /api/synthesizer/log`, `DELETE /api/synthesizer/log`. Use existing input-validation pattern. No 60-second cache (mutating + diagnostic reads).
- [X] T027 [P] [US1] Add typed wrappers in `src/services/api.ts`: `getSynthesisSettings`, `updateSynthesisSettings`, `getInvocationLog`, `clearInvocationLog`
- [X] T028 [P] [US1] Build `src/components/synthesizer/SynthesisSettingsPanel.tsx`: toggle for `enabled`, sliders/inputs for tunable parameters, "Clear activity log" button, all wired through the typed API wrappers
- [X] T029 [P] [US1] Build `src/components/synthesizer/ActivityLogView.tsx`: newest-first list of recorded invocations showing name, hash, timestamp, success, approval, source — read-only, with a "Clear all" action
- [X] T030 [US1] Mount `SynthesisSettingsPanel` in the existing Settings page; mount `ActivityLogView` accessible from a Settings link
- [ ] T031 [US1] End-to-end manual smoke test per `quickstart.md` steps 1–3 (enable, observe, audit log shows hashed entries with no PII)
- [X] T032 [US1] Run `npm run test:coverage` for changed files; assert ≥ 80% on US1 code

**Checkpoint**: US1 fully functional. Begin 7-day dogfood window. **DO NOT start US2 until the kill-criterion gate (SC-002) returns ≥ 3 candidate sequences.**

---

## Phase 4: User Story 2 — See proposed workflows (Priority: P2)

**Goal**: Detect repeated tool-name sequences and surface them as proposal cards on the Automations page. Read-only — no promotion path yet.

**Independent Test**: Seed `.tool-invocation-log.*.json` with three identical 3-step sequences, reload the Automations page, verify exactly one proposal card appears with the correct sequence and `occurrences: 3`. Dismiss it; verify it does not reappear within 30 days.

**Gate**: Only proceed if SC-002 passed during the US1 dogfood window.

### Tests for User Story 2 (write first, must FAIL)

- [ ] T033 [P] [US2] Test in `src/agent/synthesizer/__tests__/detector.test.ts`: n-gram extraction lengths 2–5, threshold ≥ 3 within `lookBackDays`, sequences already in dynamic-tool registry are filtered, contiguous-only (skip-grams excluded), `containsDestructive` flag set when sequence contains any write-tool name
- [ ] T034 [P] [US2] Test in `src/agent/synthesizer/__tests__/proposal-store.test.ts`: atomic write, dismiss persists `dismissedAt`, dismissed proposals stay until cooldown elapses, malformed JSON → empty fallback
- [ ] T035 [P] [US2] Test in `src/agent/synthesizer/__tests__/sample-store.test.ts`: sample written only when proposal emitted, cleared independently of proposals (FR-012), `clear()` does not affect `.workflow-proposals.*.json`
- [ ] T036 [P] [US2] Test in `src/agent/synthesizer/__tests__/detector-debounce.test.ts`: detector runs after N=10 appends OR ≥ 5 min, never on hot path (FR-014)
- [ ] T037 [P] [US2] Test in `src/agent/synthesizer/__tests__/proposal-collision.test.ts`: a sequence whose tool names match a registered dynamic tool's `steps[].action` is filtered before persistence
- [ ] T038 [P] [US2] Contract tests in `__tests__/api/synthesizer-proposals.test.ts` for `GET /api/synthesizer/proposals`, `POST /api/synthesizer/proposals/:id/dismiss`, `GET /api/synthesizer/proposals/:id/sample`, `DELETE /api/synthesizer/samples` per contracts/api.md
- [ ] T039 [P] [US2] Privacy test extension in `synthesizer-privacy.test.ts`: assert PII sentinels never appear in `.workflow-proposals.*.json` (only `.workflow-proposal-samples.*.json` may contain them)

### Implementation for User Story 2

- [ ] T040 [P] [US2] Implement `src/agent/synthesizer/proposal-store.ts`: `loadProposals`, `upsertProposal`, `dismissProposal`, `removeProposal`, atomic writes via `getScopedDataPath('.workflow-proposals')`
- [ ] T041 [P] [US2] Implement `src/agent/synthesizer/sample-store.ts`: `saveSample`, `getSample`, `clearAllSamples`, atomic writes via `getScopedDataPath('.workflow-proposal-samples')`
- [ ] T042 [US2] Implement `src/agent/synthesizer/detector.ts`: n-gram extraction (length 2–`maxSequenceLength`), threshold + window filtering, dynamic-tool collision filter, destructive-tool detection (against the existing write-tool allowlist used in `workflow-scheduler.ts`), emits proposals + captures samples from ring buffer (depends on T040, T041)
- [ ] T043 [US2] Wire debounced detector trigger in `observer.ts`: increment append-counter, schedule detector on (counter % 10 === 0) OR (now − lastRun ≥ 5 min). Run detector via `setTimeout(..., 0)` so it never blocks the dispatch hot path.
- [ ] T044 [US2] Add 4 endpoints in `server.ts`: `GET /api/synthesizer/proposals`, `POST /api/synthesizer/proposals/:id/dismiss`, `GET /api/synthesizer/proposals/:id/sample`, `DELETE /api/synthesizer/samples`. Validate inputs; return 404 for unknown IDs.
- [ ] T045 [P] [US2] Add typed wrappers in `src/services/api.ts`: `listProposals`, `dismissProposal`, `getProposalSample`, `clearProposalSamples`
- [ ] T046 [P] [US2] Build `src/components/synthesizer/ProposalCard.tsx`: shows tool sequence, occurrence count, first/last seen, destructive warning when `containsDestructive`, "argument values varied" notice when sample mismatch detected, "Save as workflow" + "Dismiss" actions
- [ ] T047 [US2] Add "Suggested workflows" section at the top of `src/pages/AutomationsPage.tsx` rendering ProposalCards from `listProposals()`. Above the existing user-authored workflows list. Empty state: "No suggestions yet — keep using the agent."
- [ ] T048 [US2] Add "Clear sample data" button to `SynthesisSettingsPanel.tsx` (separate from "Clear activity log") that calls `clearProposalSamples`
- [ ] T049 [US2] Manual smoke test per quickstart.md step 4 (proposal appears with `occurrences: 3` after seeded sequences)
- [ ] T050 [US2] Coverage check on US2 modules ≥ 80%

**Checkpoint**: US2 fully functional. Proposals are visible. The user can see their own repetition surfaced — but cannot yet promote.

---

## Phase 5: User Story 3 — Promote a proposal (Priority: P3)

**Goal**: Close the loop. Click "Save as workflow" on a proposal → existing workflow editor opens pre-filled → save creates a regular dynamic tool, eligible for triggers like any other.

**Independent Test**: From a proposal card, click "Save as workflow," accept pre-filled values, save with a unique name, verify the workflow appears in `getDynamicTools()` and the proposal disappears from the suggestions list. Attempt to save with a colliding name → 409 with clear error.

### Tests for User Story 3 (write first, must FAIL)

- [ ] T051 [P] [US3] Test in `src/agent/synthesizer/__tests__/promote.test.ts`: builds a `DynamicToolDef` from proposal sequence + sample args, sets `isWriteTool: true` when `containsDestructive`, registers via `registerDynamicTool`, removes proposal + sample on success, returns 409-equivalent on name collision
- [ ] T052 [P] [US3] Test in `src/agent/synthesizer/__tests__/promote-without-sample.test.ts`: when `sampleRef` is null (process restarted before capture), promote still proceeds with empty `args: {}` per step and the editor surfaces "no sample available" notice
- [ ] T053 [P] [US3] Contract test in `__tests__/api/synthesizer-promote.test.ts` for `POST /api/synthesizer/proposals/:id/promote`: 201 on success, 409 on name collision, 400 on invalid step action / empty sequence
- [ ] T054 [P] [US3] Integration test in `__tests__/integration/synthesizer-promote-flow.test.ts`: end-to-end from proposal emission → promote endpoint → registered dynamic tool callable from chat dispatch

### Implementation for User Story 3

- [ ] T055 [US3] Add `POST /api/synthesizer/proposals/:id/promote` endpoint in `server.ts`: composes proposal + sample into `DynamicToolDef`, calls `registerDynamicTool`, on success deletes proposal + sample, on null return responds 409 with `{ error: "Tool name already in use" }`
- [ ] T056 [P] [US3] Add typed wrapper in `src/services/api.ts`: `promoteProposal(id, def)`
- [ ] T057 [US3] Wire "Save as workflow" action in `ProposalCard.tsx` to open the existing dynamic-tool editor with `initialState = { name: '', steps: <sequence>, parameters: {}, isWriteTool: <containsDestructive>, label: '' }` pre-filled from sample (or empty args + "no sample" notice when sample missing)
- [ ] T058 [US3] On editor save, call `promoteProposal(...)` instead of the standard create path; on 409 surface error inline; on success refresh proposals + dynamic-tools lists
- [ ] T059 [US3] Manual smoke test per quickstart.md steps 5–6 (promote, verify in regular workflow list, verify callable from chat)
- [ ] T060 [US3] Coverage check on US3 code paths ≥ 80%

**Checkpoint**: All three user stories independently functional. Hermes-inspired auto-skill loop closed end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Diagnostics, documentation, security hardening, and full quickstart validation.

- [ ] T061 [P] Add diagnostic counters per FR-015: invocation count, active proposals count, last detector run timestamp — exposed via `GET /api/synthesizer/diagnostics`
- [ ] T062 [P] Update `CLAUDE.md` "Workflow scheduler" section to document the synthesizer as a sibling subsystem; add file-path map for `src/agent/synthesizer/*`
- [ ] T063 [P] Update `README.md` (or relevant user docs) with a short user-facing description of "Suggested workflows" and how to opt in
- [ ] T064 [P] Add a CI step (or local pre-commit) running `synthesizer-privacy.test.ts` on every change touching `src/agent/synthesizer/`
- [ ] T065 Re-verify Constitution Check post-implementation: every persisted file uses `getScopedDataPath()`, every write is atomic, no `shell: true` introduced, no new outbound network. Record results in PR description under "Constitution Compliance".
- [ ] T066 Run full `quickstart.md` flow end-to-end, screenshot each step, attach to PR
- [ ] T067 [P] Run `make typecheck` and `npm test` — both green
- [ ] T068 [P] Run `npm run test:coverage` — assert ≥ 80% on all changed files
- [ ] T069 Run `make build` — production build succeeds
- [ ] T070 Run `npm run tauri build` if any change touches Tauri-affecting paths (none expected here)
- [ ] T071 Open PR with conventional-commits title `feat(007): add workflow synthesizer (opt-in auto-skill)`, body including: feature summary, kill-criterion result, test plan, Constitution Compliance section, and linked spec/plan/research/data-model/contracts files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup; **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Foundational; **gates US2/US3 via kill-criterion (SC-002)**
- **User Story 2 (Phase 4)**: Depends on Foundational AND on US1 dogfood window passing the kill-criterion gate
- **User Story 3 (Phase 5)**: Depends on Foundational AND on US2 (proposals must exist to promote)
- **Polish (Phase 6)**: Depends on every shipped user story

### User Story Dependencies

- **US1 (P1)**: Independent. Delivers MVP value (audit log) without US2/US3.
- **US2 (P2)**: Depends on US1's invocation log existing. Independently testable once detector runs against a seeded log.
- **US3 (P3)**: Depends on US2 (proposals to promote). Independently testable end-to-end via the integration test.

### Within Each User Story

- Tests MUST be written and FAIL before implementation (Constitution III)
- Types/interfaces before stores; stores before services; services before endpoints; endpoints before UI
- Manual smoke test (quickstart.md) runs last in each phase

### Parallel Opportunities

- All [P] tasks within a phase target different files and can run concurrently
- Within Phase 2: T006–T009 (tests) all parallel; T010–T012 (implementations of independent modules) all parallel
- Within Phase 3: T017–T023 (tests) all parallel; T024 + T027–T029 (independent files) parallel; T025–T026 sequential (touch observer + server.ts)
- Phase 6 tasks T061–T064, T067–T068 all parallel

---

## Parallel Example: User Story 1 tests

```bash
# Launch all US1 tests in parallel (different files, no cross-deps):
Task: "T017 invocation-log.test.ts"
Task: "T018 observer-flag.test.ts"
Task: "T019 synthesizer-privacy.test.ts"
Task: "T020 observer-perf.test.ts"
Task: "T021 observer-concurrent.test.ts"
Task: "T022 synthesizer-settings contract test"
Task: "T023 synthesizer-log contract test"
```

---

## Implementation Strategy

### MVP First (User Story 1 only) — strongly recommended

1. Complete Phase 1 (Setup) and Phase 2 (Foundational)
2. Complete Phase 3 (US1: opt-in observation + audit log)
3. **STOP. Dogfood for 7 days behind the flag.** This is the kill-criterion gate (SC-002).
4. Decision point:
   - **≥ 3 candidate sequences detected offline against the captured log** → proceed to US2.
   - **< 3 candidates** → file follow-up ticket, ship US1 only as a diagnostic feature, revisit in 60 days. Do NOT build US2/US3 on insufficient signal.

### Incremental Delivery

1. Setup + Foundational + US1 → ship behind flag → dogfood
2. (If gate passes) US2 → ship → confirm proposals are useful, not noisy (SC-003: ≥ 50 % promoted-or-dismissed within 30 days)
3. US3 → ship → close the loop
4. Polish (Phase 6) → PR

### Solo Strategy (single developer)

Sequential phases, sequential user stories. Use [P] markers within a phase to batch test files together when writing them — significantly faster than one at a time.

### Parallel Team Strategy

Not applicable — this is a single-developer project. The kill-criterion gate also makes parallelism counterproductive: starting US2 before the gate passes wastes engineering effort.

---

## Notes

- Every task targets a file path in plan.md's project structure
- Atomic writes (temp + rename) and per-account scoping (`getScopedDataPath()`) are mandatory for every persisted file (Constitution I + persistence rule)
- Privacy invariant: no PII in `.tool-invocation-log.*.json` or `.workflow-proposals.*.json`. Only `.workflow-proposal-samples.*.json` may hold literal args, and only for active proposals.
- Observer hook MUST never throw into the dispatch path. Try/catch is mandatory.
- No new runtime dependencies; only Node built-ins (`crypto`, `fs`)
- Commit after each user-story checkpoint (US1, US2, US3) so progress is durable and the kill-criterion decision can be made on a stable commit
