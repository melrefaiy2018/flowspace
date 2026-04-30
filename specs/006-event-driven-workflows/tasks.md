# Tasks: Event-Driven Workflow Automation

**Input**: Design documents from `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/specs/006-event-driven-workflows/`
**Prerequisites**: plan.md (read first — every task references it)

**Tests**: Tests are REQUIRED per the constitution (Test-First Development is non-negotiable). Each implementation task is preceded by its corresponding test task.

**Organization**: Tasks are grouped by user story so the implementer can complete and validate one story before moving to the next.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, or US3 — maps to the user story
- All file paths below are absolute

## Path Conventions

Repository root: `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/`

- Backend code: `server.ts` (single file), `src/agent/*.ts`
- Frontend code: `src/pages/*.tsx`, `src/components/*.tsx`, `src/services/api.ts`
- Backend tests: `src/agent/__tests__/*.test.ts`
- Frontend tests: `src/components/__tests__/*.test.tsx`, `src/pages/__tests__/*.test.tsx`

---

## User Stories (derived from plan.md)

- **US1 (P1, MVP)**: User can configure an automation trigger on a single workflow inside Workflow Studio, and the server automatically runs that workflow when matching new emails arrive — auto-approving safe write actions like apply_label/archive.
- **US2 (P2)**: When a triggered workflow run fails, the user sees a persistent failure notification in the per-workflow Automate panel with the error message and a Re-trigger button.
- **US3 (P3)**: User can see ALL configured automations across all workflows in a single sidebar tab ("Automations") with active/paused state, last run, processed count, and failure count for each.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify environment and create the spec docs structure. No new dependencies needed (all libraries already installed per plan.md).

- [X] T001 Verify Node.js ≥ 20 with `node --version`. If lower, abort and tell user to upgrade. No package.json changes needed — `googleapis`, `express`, `vitest` are already installed.
- [X] T002 [P] Read the entire plan at `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/specs/006-event-driven-workflows/plan.md` end-to-end before writing any code. Pay special attention to the Clarifications section (lines 278-287).
- [X] T003 [P] Read these existing files to understand the conventions you must mirror:
  - `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/dynamic-tool-types.ts` (existing types you will extend)
  - `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/dynamic-tool-registry.ts` (atomic-write JSON pattern to copy)
  - `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/tool-composer.ts` lines 175-280 (`executeDynamicTool` you will modify)
  - `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts` lines 2911-2998 (`scanSentEmailsForCommitments` — pattern to mirror for the scheduler)
  - `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts` lines 763-775 (`getAuthClient`, `gmailClient` — these are what the scheduler will use)
  - `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/pages/WorkflowStudioPage.tsx` (page you will modify)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Type definitions and the `autoApprove` plumbing. Every user story depends on these. **DO NOT START ANY USER STORY BEFORE THIS PHASE IS COMPLETE.**

### Tests for Foundational

- [X] T004 [P] Write test file `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/workflow-trigger-types.test.ts`. The test must:
  - Import `WorkflowTrigger`, `EmailReceivedTrigger`, `TriggerEventType` from `../dynamic-tool-types.js`
  - Verify a value `{ type: 'email_received', enabled: true, filter: 'subject:test' }` is assignable to `WorkflowTrigger`
  - Verify TypeScript narrowing works: `if (t.type === 'email_received')` allows accessing `t.filter`
  - Verify `intervalMinutes` is optional (object without it must compile)
  - Run the test with `npx vitest run src/agent/__tests__/workflow-trigger-types.test.ts` — it MUST FAIL because the types do not yet exist.

- [X] T005 [P] Write test file `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/tool-composer-autoapprove.test.ts`. The test must:
  - Import `executeDynamicTool` from `../tool-composer.js`
  - Construct a fake `DynamicToolDef` with one step using action `apply_label_to_threads` (a write action)
  - Mock `executeTool` (using `vi.mock`) to return a successful result
  - Call `executeDynamicTool(tool, {}, undefined, { autoApprove: true })` — assert the returned result has `success: true` and is NOT an `ApprovalRequiredResult` (i.e. no `approval` field)
  - Construct another test: same tool, but with action `send_email` (DESTRUCTIVE — must remain gated). Call with `{ autoApprove: true }` and assert it DOES return an `ApprovalRequiredResult` (the `approval` field is set)
  - Construct a third test: same tool with `apply_label_to_threads`, called WITHOUT `{ autoApprove: true }` — assert it returns an `ApprovalRequiredResult` (default behavior unchanged)
  - Run with `npx vitest run src/agent/__tests__/tool-composer-autoapprove.test.ts` — it MUST FAIL because the option does not exist.

### Implementation for Foundational

- [X] T006 Edit `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/dynamic-tool-types.ts`. After the existing `DynamicToolDef` interface, add the following exact code:
  ```typescript
  export type TriggerEventType = 'email_received';

  export interface EmailReceivedTrigger {
    readonly type: 'email_received';
    readonly enabled: boolean;
    /** Gmail search query, e.g. "subject:credit card" */
    readonly filter: string;
    /** Polling interval in minutes; default 2 */
    readonly intervalMinutes?: number;
  }

  export type WorkflowTrigger = EmailReceivedTrigger;
  ```
  Then add `readonly trigger?: WorkflowTrigger;` as the last optional field inside `DynamicToolDef`. Do NOT change any existing field. Run T004's test — it MUST now PASS.

- [X] T007 Define a constant for safe-to-auto-approve actions. In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/tool-composer.ts`, near the top imports, add:
  ```typescript
  /** Actions whose side-effects are reversible and can be auto-approved when the user has explicitly enabled an automation trigger. Keep in sync with the safelist in plan.md (Clarification Q1). */
  export const AUTO_APPROVE_SAFE_ACTIONS = new Set<string>([
    'apply_label_to_threads',
    'archive_email_threads',
    'restore_email_threads',
    'mark_threads_read',
    'mute_email_threads',
  ]);
  ```

- [X] T008 Modify `executeDynamicTool` in `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/tool-composer.ts`:
  - Change the function signature from `async function executeDynamicTool(tool, input, signal?)` to `async function executeDynamicTool(tool, input, signal?, options?: { autoApprove?: boolean })`. Preserve the return type union exactly.
  - Inside the loop, replace the existing approval gate `if (isWriteTool(step.action)) { return ApprovalRequiredResult... }` with:
    ```typescript
    if (isWriteTool(step.action)) {
      const isSafe = AUTO_APPROVE_SAFE_ACTIONS.has(step.action);
      if (!(options?.autoApprove === true && isSafe)) {
        // existing approval-required return path — leave the inner code unchanged
        return { /* existing ApprovalRequiredResult shape */ } as const;
      }
      // else: auto-approved — fall through to executeTool below
    }
    ```
  - Do NOT touch any other logic (interpolation, output capture, etc.). Run T005's tests — all three MUST PASS.

- [X] T009 Update `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/dynamic-tool-registry.ts`: confirm the existing `loadDynamicTools()` does NOT strip the new `trigger` field on read or write. If the registry uses any field-allowlist or schema validator that drops unknown fields, extend it to accept `trigger`. Add an integration test in `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/dynamic-tool-registry-trigger.test.ts` that registers a tool WITH a trigger field, calls `loadDynamicTools()` again, and verifies `getDynamicTool(name)?.trigger` returns the same trigger object. Test MUST pass.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Configure & Run Email-Triggered Workflow (Priority: P1) 🎯 MVP

**Goal**: User opens a saved workflow in Workflow Studio, expands the new "Automate" section, sets a Gmail filter (e.g. `subject:credit card`), picks an interval (default 2 min), clicks Save automation. The server polls Gmail every 2 min, matches new emails, and runs the workflow automatically. Safe write actions (apply_label, archive) execute without approval; destructive ones (send_email) still require approval.

**Independent Test**: Start the server with `npm run dev`. Save a test workflow with a single step `apply_label_to_threads({ threadIds: '{{input.threadId}}', labelName: 'TestAuto' })`. In Studio, enable a trigger with filter `subject:auto-test-1`, interval 2 min. Send yourself an email with subject `auto-test-1`. Within 2 min, the email gets the `TestAuto` label and disappears from the inbox view. Console shows `[scheduler] executed <workflowName> for message <id>`.

### Tests for User Story 1

- [X] T010 [P] [US1] Write test file `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/workflow-trigger-state.test.ts`. The test must:
  - Use `vi.mock('node:fs/promises')` to mock disk I/O OR use a temp dir via `os.tmpdir()` and `fs.mkdtempSync`
  - Test `loadTriggerState()` returns `{ version: 1, processedIds: {}, lastPollAt: {}, failures: {} }` when the file does not exist
  - Test `loadTriggerState()` returns the parsed state when the file exists and is valid JSON
  - Test `loadTriggerState()` returns the default state (and logs a warning) when the file exists but JSON is malformed
  - Test `loadTriggerState()` returns the default state when the file exists but `version !== 1` (forward-compat guard)
  - Test `markProcessed('wf1', ['id1', 'id2'])` then `markProcessed('wf1', ['id3'])` results in `processedIds.wf1 === ['id1','id2','id3']`
  - Test `markProcessed` caps array at 500 entries: marking 600 IDs results in only the LAST 500 being kept
  - Test `isProcessed('wf1', 'id2')` returns `true` after the above; `isProcessed('wf1', 'id99')` returns `false`
  - Test `recordFailure('wf1', { messageId: 'id5', failedAt: 123, error: 'boom', stepIndex: 1 })` appends to `failures.wf1`; cap at 20 entries
  - Test `clearFailures('wf1')` empties `failures.wf1`
  - Test `saveTriggerState()` writes to `<path>.tmp` first then renames to `<path>` (atomic). Verify by spying on `fs.writeFile` and `fs.rename`
  - Run with `npx vitest run src/agent/__tests__/workflow-trigger-state.test.ts` — MUST FAIL.

- [X] T011 [P] [US1] Write test file `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/workflow-scheduler.test.ts`. The test must:
  - Use `vi.useFakeTimers()` to control `setInterval`
  - Mock `getDynamicTools()` to return a single workflow with a trigger `{ type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 }`
  - Mock the Gmail client (`gmailClient` from server.ts is hard to import; use dependency injection — see T015 for design)
  - Test `startWorkflowScheduler()` registers exactly one interval at `2 * 60 * 1000` ms
  - Test `startWorkflowScheduler()` registers ZERO intervals when `trigger.enabled === false`
  - Test `runTriggerCycle()` calls Gmail with query containing `subject:test newer_than:`
  - Test that already-processed message IDs are filtered out (mock `isProcessed` to return true for known IDs)
  - Test that for each NEW message, `executeDynamicTool` is called with `{ threadId, messageId, query }` and `{ autoApprove: true }`
  - Test that successfully-processed IDs are then passed to `markProcessed`
  - Test that if `executeDynamicTool` throws or returns `success: false`, `recordFailure` is called with the error and `markProcessed` is STILL called (per Clarification Q3)
  - Test that `stopWorkflowScheduler()` clears all registered intervals (verify `clearInterval` was called for each)
  - Test that an error thrown inside one cycle is caught and does NOT propagate (the next interval still fires)
  - Test that if `getAccessToken()` throws (no auth), the cycle logs `[scheduler] no auth — skipping cycle for <name>` and returns early without calling Gmail
  - Run with `npx vitest run src/agent/__tests__/workflow-scheduler.test.ts` — MUST FAIL.

- [X] T012 [P] [US1] Write test file `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/server-trigger-endpoints.test.ts`. The test must:
  - Use `supertest` (already installed via Vitest's ecosystem — if not, install with `npm install -D supertest @types/supertest`)
  - Spin up the Express `app` (export it from server.ts if not already exported — see T020)
  - `PATCH /api/dynamic-tools/test_wf/trigger` with body `{ enabled: true, filter: 'subject:x', intervalMinutes: 2 }` returns 200 and the workflow's stored trigger field is updated
  - `PATCH /api/dynamic-tools/nonexistent/trigger` returns 404
  - `PATCH` with an invalid body (missing `filter` when `enabled: true`) returns 400 with a clear error message
  - `GET /api/dynamic-tools/test_wf/trigger/status` returns `{ enabled, lastPollAt, processedCount, nextPollIn, failures }` shape
  - `GET` for a workflow without a trigger returns `{ enabled: false, lastPollAt: null, processedCount: 0, nextPollIn: null, failures: [] }`
  - Run with `npx vitest run src/agent/__tests__/server-trigger-endpoints.test.ts` — MUST FAIL.

- [X] T013 [P] [US1] Write test file `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/components/__tests__/AutomatePanel.test.tsx`. The test must use `@testing-library/react` (check package.json — install if missing). The test must:
  - Render `<AutomatePanel workflowName="wf1" workflowSaved={false} />` and assert the panel renders nothing visible (returns null)
  - Render with `workflowSaved={true}` and assert the toggle, filter input, interval select, and Save button are present
  - Mock `api.getWorkflowTriggerStatus` to return `{ enabled: false, lastPollAt: null, processedCount: 0, nextPollIn: null, failures: [] }`
  - Type `subject:test` in the filter input, click Save → assert `api.updateWorkflowTrigger` called once with `{ type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 }`
  - Toggle off → assert `updateWorkflowTrigger` called with `enabled: false`
  - When `failures.length > 0`, assert the failure badge is visible with the error message
  - Run with `npx vitest run src/components/__tests__/AutomatePanel.test.tsx` — MUST FAIL.

### Implementation for User Story 1

- [X] T014 [P] [US1] Create `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/workflow-trigger-state.ts`. The file must:
  - Import `path`, `fs/promises`, and the existing `getDataDir()` helper (search for it in `src/agent/` or `server.ts` — copy the import path used by `dynamic-tool-registry.ts`)
  - Export `interface TriggerFailure { messageId: string; failedAt: number; error: string; stepIndex: number; }`
  - Export `interface TriggerState { version: 1; processedIds: Record<string, string[]>; lastPollAt: Record<string, number>; failures: Record<string, TriggerFailure[]>; }`
  - Constant: `const STATE_FILE = '.workflow-trigger-state.json';`
  - Constant: `const MAX_PROCESSED_IDS = 500;` and `const MAX_FAILURES = 20;`
  - In-memory cache: `let cache: TriggerState | null = null;`
  - `export async function loadTriggerState(): Promise<TriggerState>`:
    - If `cache` is set, return it.
    - Try to read the file. If ENOENT, return default state and cache it.
    - Parse JSON. If parse fails or `version !== 1`, log `console.warn('[trigger-state] corrupt or unknown version, using default')` and return default.
    - Validate shape: `processedIds`, `lastPollAt`, `failures` are all objects (not null, not arrays). If invalid, return default.
    - Cache and return.
  - `export async function saveTriggerState(state: TriggerState): Promise<void>`:
    - Write to `<DATA_DIR>/<STATE_FILE>.tmp`, then `fs.rename` to `<DATA_DIR>/<STATE_FILE>`.
    - Update `cache = state`.
  - `export async function markProcessed(workflowName: string, ids: string[]): Promise<void>`:
    - Load state, append new IDs to `processedIds[workflowName]` (initializing to `[]` if missing).
    - Cap at last `MAX_PROCESSED_IDS` entries (oldest evicted).
    - Save.
  - `export async function isProcessed(workflowName: string, id: string): Promise<boolean>`: load state, check `processedIds[workflowName]?.includes(id) === true`.
  - `export async function getLastPollAt(workflowName: string): Promise<number | null>`: load state, return `lastPollAt[workflowName] ?? null`.
  - `export async function setLastPollAt(workflowName: string, ts: number): Promise<void>`: load, update, save.
  - `export async function recordFailure(workflowName: string, failure: TriggerFailure): Promise<void>`: load, append to `failures[workflowName]`, cap at `MAX_FAILURES`, save.
  - `export async function clearFailures(workflowName: string): Promise<void>`: load, set `failures[workflowName] = []`, save.
  - `export async function getProcessedCount(workflowName: string): Promise<number>`: load, return `processedIds[workflowName]?.length ?? 0`.
  - `export async function getFailures(workflowName: string): Promise<TriggerFailure[]>`: load, return `failures[workflowName] ?? []`.
  - `export function _resetCacheForTests(): void { cache = null; }` (test helper only)
  - Run T010 — MUST PASS.

- [X] T015 [US1] Create `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/workflow-scheduler.ts`. The file must:
  - Import `getDynamicTools` from `./dynamic-tool-registry.js`
  - Import `executeDynamicTool` from `./tool-composer.js`
  - Import the state functions from `./workflow-trigger-state.js`
  - Define a dependency-injection interface for testability:
    ```typescript
    export interface SchedulerDeps {
      gmailSearch: (query: string) => Promise<Array<{ threadId: string; messageId: string }>>;
      now: () => number;
    }
    ```
  - Module-level state: `const intervals = new Map<string, NodeJS.Timeout>();` and `let currentDeps: SchedulerDeps | null = null;`
  - `export function startWorkflowScheduler(deps: SchedulerDeps): void`:
    - Set `currentDeps = deps`
    - Call `stopWorkflowScheduler()` first to clear any existing intervals
    - Iterate `getDynamicTools()`. For each tool with `tool.trigger?.enabled === true && tool.trigger.type === 'email_received'`:
      - Compute `intervalMs = (tool.trigger.intervalMinutes ?? 2) * 60_000`
      - `const handle = setInterval(() => { runTriggerCycle(tool.name).catch(err => console.error('[scheduler] cycle error', tool.name, err)); }, intervalMs);`
      - `intervals.set(tool.name, handle);`
      - Log `console.log('[scheduler] registered', tool.name, 'every', intervalMs, 'ms');`
  - `export function stopWorkflowScheduler(): void`: iterate `intervals.values()` calling `clearInterval`, then `intervals.clear()`.
  - `export async function restartWorkflowScheduler(deps?: SchedulerDeps): Promise<void>`: stop, then start with `deps ?? currentDeps` (throw if both null).
  - `export async function runTriggerCycle(workflowName: string): Promise<void>`:
    - Get `tool = getDynamicTool(workflowName)`. If missing or `!tool.trigger?.enabled`, return.
    - Wrap entire body in try/catch — on any error log `console.error('[scheduler] ERROR', workflowName, err)` and return (do NOT throw).
    - Call `currentDeps!.gmailSearch(`${tool.trigger.filter} newer_than:1d`)` — if it throws an auth-like error (message contains 'auth' or 'token'), log `console.warn('[scheduler] no auth — skipping cycle for', workflowName)` and return.
    - For each result: if `await isProcessed(workflowName, messageId)` returns true, skip.
    - For each NEW result, call:
      ```typescript
      const result = await executeDynamicTool(tool, { threadId, messageId, query: tool.trigger.filter }, undefined, { autoApprove: true });
      ```
    - If `result.success === true` and there's no `approval` field: `await markProcessed(workflowName, [messageId]); console.log('[scheduler] executed', workflowName, 'for message', messageId);`
    - If `result.success === false` OR an exception was caught from `executeDynamicTool`: call `await recordFailure(workflowName, { messageId, failedAt: Date.now(), error: String(err?.message ?? err), stepIndex: 0 })` AND `await markProcessed(workflowName, [messageId])` (per Clarification Q3 — do not retry).
    - At end, call `await setLastPollAt(workflowName, currentDeps!.now())`.
  - Run T011 — MUST PASS.

- [X] T016 [US1] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts`, near the top imports add:
  ```typescript
  import { startWorkflowScheduler, stopWorkflowScheduler, restartWorkflowScheduler, runTriggerCycle } from './src/agent/workflow-scheduler.js';
  import { getProcessedCount, getFailures, getLastPollAt as getStateLastPollAt, clearFailures } from './src/agent/workflow-trigger-state.js';
  ```
  Then create a `SchedulerDeps` adapter inside server.ts (NOT exported — keep it local):
  ```typescript
  function buildSchedulerDeps(): SchedulerDeps {
    return {
      gmailSearch: async (query) => {
        const gmail = gmailClient(); // existing helper at line 773
        const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 25 });
        const msgs = list.data.messages ?? [];
        return msgs.map(m => ({ threadId: m.threadId!, messageId: m.id! })).filter(x => x.threadId && x.messageId);
      },
      now: () => Date.now(),
    };
  }
  ```

- [X] T017 [US1] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts`, find the `startServer()` function. After the existing `loadDynamicTools();` call, add:
  ```typescript
  try {
    startWorkflowScheduler(buildSchedulerDeps());
  } catch (err) {
    console.error('[scheduler] failed to start at boot', err);
  }
  ```

- [X] T018 [US1] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts`, find the existing `PUT /api/dynamic-tools/:name` route. Immediately AFTER it, add:
  ```typescript
  app.patch('/api/dynamic-tools/:name/trigger', async (req, res) => {
    try {
      const { name } = req.params;
      const tool = getDynamicTool(name);
      if (!tool) return res.status(404).json({ error: 'Workflow not found' });

      const { enabled, filter, intervalMinutes } = req.body ?? {};
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
      if (enabled && (typeof filter !== 'string' || filter.trim().length === 0)) {
        return res.status(400).json({ error: 'filter is required when enabled is true' });
      }
      const interval = typeof intervalMinutes === 'number' && intervalMinutes >= 1 && intervalMinutes <= 60 ? intervalMinutes : 2;

      const trigger = { type: 'email_received' as const, enabled, filter: filter ?? '', intervalMinutes: interval };
      await updateDynamicTool(name, { trigger });
      await restartWorkflowScheduler(); // pick up the new/disabled trigger
      res.json({ ok: true, trigger });
    } catch (err: any) {
      console.error('[trigger] PATCH error', err);
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });
  ```

- [X] T019 [US1] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts`, immediately after the PATCH route from T018, add:
  ```typescript
  app.get('/api/dynamic-tools/:name/trigger/status', async (req, res) => {
    try {
      const { name } = req.params;
      const tool = getDynamicTool(name);
      if (!tool) return res.status(404).json({ error: 'Workflow not found' });

      const trigger = tool.trigger;
      const lastPollAt = await getStateLastPollAt(name);
      const processedCount = await getProcessedCount(name);
      const failures = await getFailures(name);
      const intervalMs = (trigger?.intervalMinutes ?? 2) * 60_000;
      const nextPollIn = trigger?.enabled && lastPollAt ? Math.max(0, lastPollAt + intervalMs - Date.now()) : null;

      res.json({
        enabled: trigger?.enabled === true,
        filter: trigger?.filter ?? null,
        intervalMinutes: trigger?.intervalMinutes ?? null,
        lastPollAt,
        processedCount,
        nextPollIn,
        failures,
      });
    } catch (err: any) {
      console.error('[trigger] GET status error', err);
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });
  ```

- [X] T020 [US1] At the very bottom of `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts`, add `export { app };` if it is not already exported. This lets the integration tests in T012 import it. Run T012 — MUST PASS.

- [X] T021 [US1] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/services/api.ts`, find the existing `streamWorkflowRefine` method. Immediately after it (still inside the `api` object), add:
  ```typescript
  updateWorkflowTrigger: (name: string, trigger: { enabled: boolean; filter: string; intervalMinutes?: number }): Promise<void> =>
    fetch(`/api/dynamic-tools/${encodeURIComponent(name)}/trigger`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trigger),
    }).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
    }),

  getWorkflowTriggerStatus: (name: string): Promise<{
    enabled: boolean;
    filter: string | null;
    intervalMinutes: number | null;
    lastPollAt: number | null;
    processedCount: number;
    nextPollIn: number | null;
    failures: Array<{ messageId: string; failedAt: number; error: string; stepIndex: number }>;
  }> =>
    fetch(`/api/dynamic-tools/${encodeURIComponent(name)}/trigger/status`).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
  ```

- [X] T022 [US1] Create `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/components/AutomatePanel.tsx`. The component must:
  - Accept props: `{ workflowName: string; workflowSaved: boolean }`
  - Return `null` when `!workflowSaved`
  - Internal state: `enabled`, `filter`, `intervalMinutes`, `status`, `loading`, `saveError`
  - On mount and when `workflowName` changes: call `api.getWorkflowTriggerStatus(workflowName)` to hydrate `enabled`, `filter`, `intervalMinutes`, and `status`
  - Render a collapsible card with header "Automate" and chevron toggle
  - When expanded: render toggle (enabled), filter text input, interval select (1, 2, 5, 10 min), Save button
  - On Save: call `api.updateWorkflowTrigger(workflowName, { enabled, filter, intervalMinutes })`. On success show "Saved" briefly. On error show `saveError`.
  - Show last-run summary: `Last run: <relative time> · <processedCount> processed`
  - When `status?.failures?.length > 0`: render a warning row with the latest failure error and a "Dismiss" button (no Re-trigger yet — that's US2)
  - Use Tailwind classes consistent with the existing FlowSpace style (look at `WorkflowStudioPage.tsx` for the variable-based color tokens like `var(--accent)`, `var(--surface2)`)
  - Use icons `Zap`, `ChevronDown`, `AlertCircle`, `Loader2` from `lucide-react`
  - Run T013 — MUST PASS.

- [X] T023 [US1] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/pages/WorkflowStudioPage.tsx`:
  - Add `import { AutomatePanel } from '../components/AutomatePanel';` near the other component imports
  - Find where the steps panel renders inside the center column. Immediately AFTER the steps panel and BEFORE the closing `</div>` of the center column, add:
    ```tsx
    <AutomatePanel workflowName={draft?.name ?? ''} workflowSaved={saveState === 'saved' && !!draft?.name} />
    ```
  - Do NOT remove or restructure any existing layout. The Automate panel sits below the steps panel and the existing Chat panel (if open).

- [ ] T024 [US1] Manual smoke test for US1 (the implementer must do this in a browser before claiming completion):
  1. Run `npm run dev`. Confirm console prints `FlowSpace server running on http://localhost:3000`. If any triggers were already enabled, you should also see `[scheduler] registered <name>` lines.
  2. Open `http://localhost:3000`, sign in if needed, go to Workflows.
  3. Create or open an existing workflow, click Edit (Studio). Save it once so `saveState === 'saved'`.
  4. Confirm the "Automate" panel appears below the steps area.
  5. Toggle Enable, type `subject:auto-test-1` into the filter, leave interval at 2 min, click Save automation.
  6. Send yourself an email with subject `auto-test-1`.
  7. Within ~2 min, observe console logs: `[scheduler] executed <name> for message <id>`. Verify in Gmail that the workflow's side-effect happened (e.g., the configured label was applied).
  8. Re-send the same email subject: workflow should NOT re-fire for the same message ID (check console — no new `executed` log for the same ID).

**Checkpoint**: User Story 1 (MVP) is fully functional. Stop here and validate before US2.

---

## Phase 4: User Story 2 — Failure Notification & Re-trigger (Priority: P2)

**Goal**: When a triggered workflow run fails, the user sees a persistent failure entry in the per-workflow Automate panel — including the error message — and can click Re-trigger to manually re-run the workflow for that message ID. They can also Dismiss to clear the failure.

**Independent Test**: Configure a workflow whose first step calls a Gmail action with intentionally invalid arguments (e.g., `apply_label_to_threads` with a non-existent label). Enable the trigger, send a matching email. Wait for the cycle. The Automate panel must display "1 failure — <error message>" with Re-trigger and Dismiss buttons. Click Re-trigger → the workflow runs again for that message ID. Click Dismiss → failure disappears.

### Tests for User Story 2

- [X] T025 [P] [US2] Add tests to `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/workflow-scheduler.test.ts` (extend the existing file):
  - Test: when `executeDynamicTool` throws `new Error('Gmail API quota exceeded')`, `recordFailure` is called with `error: 'Gmail API quota exceeded'`, `messageId` matches the failing message, and `markProcessed` IS still called for that message
  - Test: when `executeDynamicTool` returns `{ success: false, output: 'step 2 failed' }`, `recordFailure` is called with `error` containing `'step 2 failed'`
  - Both must FAIL before running T028 implementation, then PASS after.

- [X] T026 [P] [US2] Add tests to `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/server-trigger-endpoints.test.ts`:
  - Test: `POST /api/dynamic-tools/:name/trigger/retrigger` with body `{ messageId: 'mid1' }` invokes `runTriggerCycle`-like manual execution for that ONE message ID and returns `{ ok: true, success: boolean, error?: string }`. Use `vi.mock` to spy on `executeDynamicTool`.
  - Test: `DELETE /api/dynamic-tools/:name/trigger/failures` clears the `failures[name]` list and returns `{ ok: true }`. Verify by GET-ing status afterwards — `failures` array is empty.
  - MUST FAIL.

- [X] T027 [P] [US2] Extend `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/components/__tests__/AutomatePanel.test.tsx`:
  - Render with `status.failures = [{ messageId: 'mid1', failedAt: Date.now()-60_000, error: 'Boom', stepIndex: 0 }]`
  - Assert "1 failure" badge is shown with text containing "Boom"
  - Click Re-trigger → assert `api.retriggerWorkflow('wf1', 'mid1')` is called
  - Click Dismiss → assert `api.dismissTriggerFailures('wf1')` is called
  - MUST FAIL.

### Implementation for User Story 2

- [X] T028 [US2] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/workflow-scheduler.ts`, refactor the per-message execution into an exported helper:
  ```typescript
  export async function executeForMessage(
    workflowName: string,
    messageId: string,
    threadId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const tool = getDynamicTool(workflowName);
    if (!tool) return { success: false, error: 'Workflow not found' };
    try {
      const result = await executeDynamicTool(tool, { threadId, messageId, query: tool.trigger?.filter ?? '' }, undefined, { autoApprove: true });
      if ('approval' in result) {
        const err = `Step ${('completedSteps' in result) ? result.completedSteps?.length ?? 0 : 0} requires manual approval — destructive action blocked`;
        await recordFailure(workflowName, { messageId, failedAt: Date.now(), error: err, stepIndex: 0 });
        return { success: false, error: err };
      }
      if (result.success === false) {
        const err = result.output || 'Workflow step failed';
        await recordFailure(workflowName, { messageId, failedAt: Date.now(), error: err, stepIndex: 0 });
        return { success: false, error: err };
      }
      return { success: true };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      await recordFailure(workflowName, { messageId, failedAt: Date.now(), error: msg, stepIndex: 0 });
      return { success: false, error: msg };
    }
  }
  ```
  Then refactor `runTriggerCycle` to call `executeForMessage` for each new message instead of duplicating the logic. Make sure `markProcessed` is ALWAYS called (even on failure) per Clarification Q3. Run T025 — MUST PASS.

- [X] T029 [US2] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts`, after the GET status route (T019), add:
  ```typescript
  app.post('/api/dynamic-tools/:name/trigger/retrigger', async (req, res) => {
    try {
      const { name } = req.params;
      const { messageId } = req.body ?? {};
      if (typeof messageId !== 'string' || !messageId) return res.status(400).json({ error: 'messageId required' });
      // Look up threadId for this messageId via Gmail
      const gmail = gmailClient();
      const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'minimal' });
      const threadId = msg.data.threadId;
      if (!threadId) return res.status(404).json({ error: 'Message not found' });
      const result = await executeForMessage(name, messageId, threadId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/dynamic-tools/:name/trigger/failures', async (req, res) => {
    try {
      await clearFailures(req.params.name);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });
  ```
  Add `import { executeForMessage } from './src/agent/workflow-scheduler.js';` at the top. Run T026 — MUST PASS.

- [X] T030 [US2] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/services/api.ts`, after `getWorkflowTriggerStatus`, add:
  ```typescript
  retriggerWorkflow: (name: string, messageId: string): Promise<{ ok: boolean; success: boolean; error?: string }> =>
    fetch(`/api/dynamic-tools/${encodeURIComponent(name)}/trigger/retrigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),

  dismissTriggerFailures: (name: string): Promise<void> =>
    fetch(`/api/dynamic-tools/${encodeURIComponent(name)}/trigger/failures`, { method: 'DELETE' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),
  ```

- [X] T031 [US2] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/components/AutomatePanel.tsx`, extend the failure UI:
  - For each failure in `status.failures` (display only the most recent if multiple), render a row with: warning icon, error message, "Re-trigger" button, "Dismiss" button
  - Re-trigger button: calls `api.retriggerWorkflow(workflowName, failure.messageId)`. While in flight, show a spinner. On success or failure, refresh status via `getWorkflowTriggerStatus`.
  - Dismiss button: calls `api.dismissTriggerFailures(workflowName)`, then refresh status.
  - Run T027 — MUST PASS.

- [ ] T032 [US2] Manual smoke test for US2:
  1. Configure a workflow whose first step deliberately fails (e.g., `apply_label_to_threads` with `labelName: 'NonExistentLabel123'`).
  2. Enable trigger, send a matching email.
  3. Wait for cycle. Open the workflow in Studio. The Automate panel should show "1 failure — <error>" with Re-trigger and Dismiss.
  4. Click Re-trigger → workflow runs again, still fails (same reason). Failure count increases or stays at 1 (most recent).
  5. Click Dismiss → failure disappears.

**Checkpoint**: US1 + US2 both functional. Stop and validate before US3.

---

## Phase 5: User Story 3 — Centralized Automations Sidebar Tab (Priority: P3)

**Goal**: User clicks a new "Automations" item in the sidebar (Zap icon) and sees a list of every workflow with a trigger configured — active or paused — with last-run summary, processed count, failure count, and an Edit button that links to the workflow's Studio page.

**Independent Test**: Configure two workflows with triggers (one enabled, one disabled). Open the Automations sidebar tab. The page must list BOTH workflows with their correct active/paused state. Click Edit on either → navigates to that workflow's Studio page.

### Tests for User Story 3

- [X] T033 [P] [US3] Add tests to `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/agent/__tests__/server-trigger-endpoints.test.ts`:
  - Test: `GET /api/dynamic-tools/triggers/all` returns an array of `{ workflowName, workflowLabel, trigger, status }` for every workflow that has a `trigger` field (regardless of enabled state)
  - Test: returns empty array `[]` when no workflows have triggers configured
  - MUST FAIL.

- [X] T034 [P] [US3] Write `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/pages/__tests__/AutomationsPage.test.tsx`:
  - Mock `api.getAllTriggers` to return two workflows (one enabled, one disabled)
  - Render `<AutomationsPage />` and assert both workflow names render
  - Assert active dot is colored differently (presence of class containing `accent` or similar) for enabled, muted for disabled
  - Assert clicking Edit on the first row navigates to `/workflows/<name>` (use a mocked router)
  - Assert empty state ("No automations configured.") renders when API returns `[]`
  - MUST FAIL.

### Implementation for User Story 3

- [X] T035 [US3] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/server.ts`, add a new route BEFORE the existing `app.get('/api/dynamic-tools/:name', ...)` wildcard (Express route ordering matters — narrower routes first):
  ```typescript
  app.get('/api/dynamic-tools/triggers/all', async (_req, res) => {
    try {
      const tools = getDynamicTools().filter((t) => t.trigger !== undefined);
      const result = await Promise.all(tools.map(async (t) => {
        const lastPollAt = await getStateLastPollAt(t.name);
        const processedCount = await getProcessedCount(t.name);
        const failures = await getFailures(t.name);
        const intervalMs = (t.trigger!.intervalMinutes ?? 2) * 60_000;
        const nextPollIn = t.trigger!.enabled && lastPollAt ? Math.max(0, lastPollAt + intervalMs - Date.now()) : null;
        return {
          workflowName: t.name,
          workflowLabel: t.label ?? t.name,
          trigger: t.trigger,
          status: { enabled: t.trigger!.enabled, lastPollAt, processedCount, nextPollIn, failures },
        };
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });
  ```
  Run T033 — MUST PASS.

- [X] T036 [US3] In `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/services/api.ts`, after `dismissTriggerFailures`, add:
  ```typescript
  getAllTriggers: (): Promise<Array<{
    workflowName: string;
    workflowLabel: string;
    trigger: { type: 'email_received'; enabled: boolean; filter: string; intervalMinutes?: number };
    status: { enabled: boolean; lastPollAt: number | null; processedCount: number; nextPollIn: number | null; failures: Array<{ messageId: string; failedAt: number; error: string; stepIndex: number }> };
  }>> =>
    fetch('/api/dynamic-tools/triggers/all').then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
  ```

- [X] T037 [US3] Create `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/pages/AutomationsPage.tsx`. The page must:
  - Use `useEffect` to call `api.getAllTriggers()` on mount and every 30s thereafter (clear interval on unmount)
  - Render a list of cards, each showing: workflow label, active dot (colored when `trigger.enabled`), filter, interval (e.g., "every 2 min"), last run (relative), processed count, failure count, Edit button
  - When a card has failures, show the latest failure inline with a Re-trigger button (calls `api.retriggerWorkflow`)
  - Empty state when array is empty: centered "No automations configured. Open a workflow in Studio to add one."
  - Match the visual style of `WorkflowsPage.tsx` (read it first to copy padding, headers, surface tokens)
  - Edit button uses the existing routing pattern in `App.tsx` (read it to find how navigation between pages works — likely state-based, not React Router)
  - Run T034 — MUST PASS.

- [X] T038 [US3] Wire the Automations tab into the sidebar:
  - Open `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/components/AppRail.tsx` (the sidebar)
  - Find where existing nav items are listed (Workflows, Calendar, Tasks, etc.)
  - Add a new item "Automations" with icon `Zap` from `lucide-react`, positioned right after the Workflows item
  - Open `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/src/App.tsx`. Find the page-routing logic (likely a switch on a `currentPage` state or similar). Add a case to render `<AutomationsPage />` when the new tab is active. Add `import { AutomationsPage } from './pages/AutomationsPage';` at the top.

- [ ] T039 [US3] Manual smoke test for US3:
  1. Configure one workflow with trigger enabled, another with trigger configured but disabled.
  2. Open the Automations tab in the sidebar. Both workflows must appear with correct active/paused dot.
  3. Click Edit on a workflow → navigates to its Studio page.
  4. Trigger a failure on one workflow (per US2 instructions). Refresh Automations page (or wait 30s) — the failure row should appear with Re-trigger.

**Checkpoint**: All three user stories functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T040 [P] Run `make typecheck` (or `npx tsc --noEmit`). Resolve any TypeScript errors. Zero errors required.
- [X] T041 [P] Run `npm test`. ALL test suites green. If any test fails, fix the implementation (NOT the test) unless the test itself encoded a wrong assumption.
- [X] T042 [P] Run `npm run test:coverage`. Verify ≥ 80% coverage on these files (the constitution requires this for changed code):
  - `src/agent/workflow-trigger-state.ts`
  - `src/agent/workflow-scheduler.ts`
  - `src/agent/dynamic-tool-types.ts` (new types only)
  - `src/agent/tool-composer.ts` (the autoApprove branch only)
  - `src/components/AutomatePanel.tsx`
  - `src/pages/AutomationsPage.tsx`
- [X] T043 Run `make build`. Production build succeeds with zero errors.
- [X] T044 Add a short note to `/Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace/CLAUDE.md` under "Architecture" describing the workflow scheduler — keep it ≤ 5 lines. State: location, what it does, where state is persisted, the safe-action allowlist.
- [X] T045 Manual end-to-end verification per plan.md "Verification" section (steps 1-11). All 11 steps must pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001-T003 — read-only / verification. Can start immediately.
- **Foundational (Phase 2)**: T004-T009 — BLOCKS all user stories. T004 and T005 are parallel; T006 depends on T004; T007, T008 depend on T005; T009 depends on T006.
- **User Story 1 (Phase 3)**: requires Foundational complete. T010-T013 are parallel tests; T014 needs T010; T015 needs T011 + T014; T016-T020 depend on T015; T021-T023 depend on T019/T020.
- **User Story 2 (Phase 4)**: requires US1 complete (extends scheduler and AutomatePanel).
- **User Story 3 (Phase 5)**: requires US1 complete (uses status endpoint and api.ts wrappers). Independent of US2 — can be built in parallel with US2 by a second developer.
- **Polish (Phase 6)**: requires all chosen user stories complete.

### Parallel Opportunities

- T002, T003 (Setup reading)
- T004, T005 (Foundational tests)
- T010, T011, T012, T013 (US1 tests — all different files)
- T025, T026, T027 (US2 tests)
- T033, T034 (US3 tests)
- T040, T041, T042 (Polish — different commands, independent results)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001-T003)
2. Complete Phase 2 (T004-T009) — tests RED → implementation GREEN
3. Complete Phase 3 (T010-T024) — tests RED → implementation GREEN → manual smoke test
4. **STOP**: Validate US1 in browser. This IS the MVP. The user can already automate `apply_label_to_threads` and `archive_email_threads`.

### Incremental Delivery

1. MVP (US1) → demo
2. Add US2 (failure UX) → demo
3. Add US3 (Automations sidebar) → demo
4. Polish phase → ship

### TDD Reminder (per Constitution Principle III)

- For EVERY implementation task, the test task that precedes it MUST be written and FAILING first.
- Do not write implementation before the corresponding test exists and fails.
- Do not weaken or delete tests to make them pass.

---

## Notes for the Implementer

- Read plan.md FIRST. Re-read the Clarifications section (lines 278-287) — those answers are binding.
- The auto-approve allowlist in T007 is the security boundary. NEVER add `send_email`, `trash_email_threads`, `drive_upload`, `docs_write`, or `save_email_to_doc` to it. If a future workflow needs these on a trigger, the user must approve each run interactively.
- The Gmail query format uses `newer_than:1d`. This is a coarse bound — duplicate prevention is the real defense. Do NOT compute `newer_than` from `lastPollAt` (timezones and clock skew make it brittle); rely on `processedIds` instead.
- The scheduler MUST NEVER throw out of an interval handler. Wrap everything in try/catch. A crash inside `setInterval` would silently kill the timer.
- When you modify `tool-composer.ts` in T008, preserve the EXACT existing `ApprovalRequiredResult` shape — it has fields like `_dynamicToolName`, `_stepIndex`, `_remainingSteps`, `_outputKeys`. Don't refactor while you're in there.
- All file paths in this document are absolute. Use them verbatim.
- Commit after each completed task or logical group. Use Conventional Commits: `feat(scheduler): ...`, `test(trigger-state): ...`, etc.
