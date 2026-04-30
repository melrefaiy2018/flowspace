# Implementation Plan: Event-Driven Workflow Automation

**Branch**: `006-event-driven-workflows` | **Date**: 2026-04-16 | **Spec**: N/A (designed in session)

## Summary

Add a polling-based trigger engine that lets users configure a workflow to run automatically when new emails arrive matching a Gmail filter. The user enables a trigger in the Workflow Studio UI; the server polls Gmail every N minutes, finds matching new emails, and executes the workflow automatically — no manual chat invocation needed. v1 scope: `email_received` trigger only, poll-based (no webhooks), auto-approve write actions for trusted automated runs.

## Technical Context

**Language/Version**: TypeScript on Node.js 20+, React 19  
**Primary Dependencies**: `googleapis` (Gmail API already installed), Express, Vitest  
**Storage**: JSON files in `DATA_DIR` — atomic write, same pattern as `.dynamic-tools.json`  
**Testing**: Vitest + `@vitest/coverage-v8`, ≥ 80% coverage on changed code  
**Target Platform**: Local macOS (Tauri v2 + Express server on localhost:3000)  
**Project Type**: Fullstack desktop app (Express API + React frontend)  
**Performance Goals**: Poll latency ≤ 2 min from email arrival to workflow execution  
**Constraints**: No public HTTPS URL → cannot use Gmail push webhooks; polling via `setInterval` is the viable approach. No new scheduler library needed.  
**Scale/Scope**: Single user, personal automation; < 10 triggered workflows expected

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| I. User Data Sovereignty — write tools through approval pipeline | CONDITIONAL PASS | Auto-approve only when user explicitly enabled trigger (treated as prior consent). Justified in Complexity Tracking. |
| II. Two-Layer Architecture — new endpoints in server.ts, frontend via api.ts | PASS | All endpoints in server.ts; frontend uses api.ts wrappers |
| III. Test-First Development | REQUIRED | Tests written before each implementation step (7-step TDD order below) |
| IV. Small Cohesive Modules — new files ≤ 800 lines | PASS | 2 new files, each purpose-scoped; existing files get small additions |
| V. Boundary Validation — trigger state JSON validated on load | REQUIRED | `loadTriggerState()` validates schema on read |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Auto-approve write actions in scheduler path | Automation is useless if each run needs interactive approval; user's explicit trigger-enable IS the approval gesture | Requiring approval per automated run defeats the purpose; scoped strictly to scheduler, not exposed to external callers. Auto-approve applies ONLY to safe reversible writes: `apply_label_to_threads`, `archive_email_threads`, `restore_email_threads`, `mark_threads_read`, `mute_email_threads`. Destructive or outbound actions — `send_email`, `trash_email_threads`, `drive_upload`, `docs_write`, `save_email_to_doc` — remain approval-gated even in automated runs. |

## Project Structure

### Documentation (this feature)

```text
specs/006-event-driven-workflows/
├── plan.md              ← this file
└── tasks.md             (produced by /speckit.tasks)
```

### Source Code Changes

```text
src/agent/
├── dynamic-tool-types.ts          MODIFY — add WorkflowTrigger type, extend DynamicToolDef
├── tool-composer.ts               MODIFY — add autoApprove option to executeDynamicTool
├── workflow-trigger-state.ts      NEW — persist processedIds + lastPollAt per workflow
└── workflow-scheduler.ts          NEW — setInterval poller, calls executeDynamicTool

src/pages/
├── WorkflowStudioPage.tsx         MODIFY — add "Automate" collapsible section per workflow
└── AutomationsPage.tsx            NEW — centralized sidebar tab: all triggers + status at a glance

src/services/
└── api.ts                         MODIFY — add updateWorkflowTrigger, getTriggerStatus

server.ts                          MODIFY — startScheduler at startup, add trigger endpoints + GET /api/dynamic-tools/triggers/all

__tests__/agent/
├── workflow-trigger-state.test.ts NEW
└── workflow-scheduler.test.ts     NEW
```

## Data Model

### New types — `src/agent/dynamic-tool-types.ts`

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

Extend `DynamicToolDef` (existing interface):
```typescript
readonly trigger?: WorkflowTrigger;
```

### Trigger state file — `.workflow-trigger-state.json` in `DATA_DIR`

```typescript
interface TriggerFailure {
  messageId: string;
  failedAt: number;    // epoch ms
  error: string;       // short error message
  stepIndex: number;   // which step failed (0-based)
}

interface TriggerState {
  version: 1;
  /** workflow name → last 500 processed Gmail message IDs (rolling window) */
  processedIds: Record<string, string[]>;
  /** workflow name → epoch ms of last successful poll */
  lastPollAt: Record<string, number>;
  /** workflow name → recent failures (last 20, oldest evicted) */
  failures: Record<string, TriggerFailure[]>;
}
```

## Implementation Plan (TDD Order)

### Step 1 — Types (`dynamic-tool-types.ts`)
- Write test: type narrowing for `WorkflowTrigger` union
- Add `EmailReceivedTrigger`, `WorkflowTrigger`, extend `DynamicToolDef`

### Step 2 — Trigger state (`workflow-trigger-state.ts`)
Write tests first:
- `loadTriggerState()` returns valid default when file missing
- `markProcessed()` caps at 500 IDs, oldest evicted
- `isProcessed()` returns true for known IDs, false for new ones
- Atomic write verified (temp file written then renamed)

Implement: `loadTriggerState`, `saveTriggerState`, `markProcessed`, `isProcessed`, `getLastPollAt`

### Step 3 — `tool-composer.ts` autoApprove
Write test: `executeDynamicTool(tool, input, signal, { autoApprove: true })` does NOT return `ApprovalRequiredResult` for write steps.

Modify: add `options?: { autoApprove?: boolean }` param; skip approval gate when `options.autoApprove === true`.

### Step 4 — Scheduler (`workflow-scheduler.ts`)
Write tests (mocked `setInterval` + mocked `executeDynamicTool`):
- `startWorkflowScheduler()` creates intervals only for enabled triggers
- `runTriggerCycle()` calls `getAccessToken()` (same as briefing scanner), queries Gmail API directly, skips already-processed IDs, executes workflow for each new match
- If `getAccessToken()` throws (no auth), cycle logs a warning and skips silently
- `stopWorkflowScheduler()` clears all intervals
- Error in one cycle does not crash scheduler (caught + logged)

Implement: load triggered workflows on start, schedule per-workflow intervals, poll, execute with `autoApprove: true` — but `autoApprove` only bypasses the gate for safe reversible actions (`apply_label_to_threads`, `archive_email_threads`, `restore_email_threads`, `mark_threads_read`, `mute_email_threads`). Destructive/outbound actions (`send_email`, `trash_email_threads`, `drive_upload`, `docs_write`, `save_email_to_doc`) remain gated even with `autoApprove: true`.

### Step 5 — Server endpoints (`server.ts`)
Write integration tests:
- `PATCH /api/dynamic-tools/:name/trigger` — updates trigger field, resets scheduler interval
- `GET /api/dynamic-tools/:name/trigger/status` — returns `{ enabled, lastPollAt, processedCount, nextPollIn }`

Add endpoints after `PUT /api/dynamic-tools/:name`.  
Call `startWorkflowScheduler()` in `startServer()` after `loadDynamicTools()`.

### Step 6 — API client (`src/services/api.ts`)
- `updateWorkflowTrigger(name, trigger: WorkflowTrigger): Promise<void>`
- `getWorkflowTriggerStatus(name): Promise<TriggerStatus>`

### Step 7 — Frontend (`WorkflowStudioPage.tsx`)
Write component tests:
- "Automate" section hidden when workflow not yet saved (`saveState !== 'saved'`)
- Toggle calls `api.updateWorkflowTrigger`
- Filter field and interval selector render correctly
- Status polling: `useEffect` with `setInterval(30_000)` fires only while panel is expanded; clears on collapse/unmount
- Failure badge renders when `failures.length > 0`; Re-trigger button calls workflow manually

Add collapsible "Automate" section below steps panel (visible only when `saveState === 'saved'` and `genState === 'done'`):

```
┌─ Automate ─────────────────────────────────────────────────┐
│  [●] Run automatically when new emails arrive               │
│  Filter: [credit card                            ] Gmail    │
│  Check every: [2 min ▼]                                    │
│  [Save automation]          Last run: 3 min ago (2 emails) │
└────────────────────────────────────────────────────────────┘
```

## Input Mapping for Triggered Runs

When the scheduler fires for a matched email, it synthesizes:
```typescript
{ threadId: string, messageId: string, query: string }
```
Workflow steps use `{{input.threadId}}` in args (e.g., `apply_label_to_threads` takes `threadIds`).

## Duplicate Prevention

- `.workflow-trigger-state.json` in `DATA_DIR`, written atomically after each cycle
- Per-workflow rolling window of 500 processed message IDs (oldest evicted when full)
- `lastPollAt` advances each cycle; Gmail query bounds results to recent messages
- State survives server restarts

## Automations Sidebar Page (`AutomationsPage.tsx`)

New sidebar tab (nav icon: `Zap` from lucide-react) showing all workflows that have a trigger configured — enabled or disabled. Polls `GET /api/dynamic-tools/triggers/all` every 30s.

### New server endpoint

```
GET /api/dynamic-tools/triggers/all
Response: Array of {
  workflowName: string,
  workflowLabel: string,
  trigger: WorkflowTrigger,
  status: TriggerStatus   // { lastPollAt, processedCount, nextPollIn, failures }
}
```

### UI wireframe

```
┌─ Automations ──────────────────────────────────────────────┐
│                                                            │
│  Sweep Credit Card Emails          ● Active                │
│  Filter: subject:credit card · every 2 min                 │
│  Last run: 3 min ago · 24 processed · 0 failures    [Edit] │
│  ─────────────────────────────────────────────────────     │
│  Morning Email Sort                ○ Paused                │
│  Filter: is:unread · every 5 min                           │
│  Last run: 1 hour ago · 142 processed · 1 failure   [Edit] │
│  ⚠ "Gmail API error on step 2"              [Re-trigger]   │
│                                                            │
│  No other automations configured.                          │
└────────────────────────────────────────────────────────────┘
```

[Edit] links directly to the workflow's Studio page. [Re-trigger] manually runs the workflow for the failed message.

### Component tests
- Renders all triggered workflows (enabled + disabled)
- Polls every 30s, stops on unmount
- Failure row shows error message + Re-trigger button
- Empty state when no triggers configured

## Failure Handling & Notifications

When a triggered workflow fails (any step throws, API error, etc.):

1. **Mark as processed** — message ID is added to `processedIds` so it won't retry automatically
2. **Log server-side** — `[scheduler] ERROR: <workflowName> failed for message <id>: <error.message>`
3. **Persist failure record** — add to `TriggerState.failures[]` per workflow:
   ```typescript
   interface TriggerFailure {
     messageId: string;
     failedAt: number;      // epoch ms
     error: string;         // short error message
     stepIndex: number;     // which step failed
   }
   ```
4. **Surface in UI** — the "Automate" section shows a failure badge with count + last error; user can click to see details and re-trigger manually

Updated trigger status API response:
```typescript
{
  enabled: boolean,
  lastPollAt: number,
  processedCount: number,
  nextPollIn: number,
  failures: TriggerFailure[]   // ← new field
}
```

Updated UI wireframe:
```
┌─ Automate ─────────────────────────────────────────────────┐
│  [●] Run automatically when new emails arrive               │
│  Filter: [credit card                            ] Gmail    │
│  Check every: [2 min ▼]                                    │
│  [Save automation]    Last run: 3 min ago (2 emails)        │
│  ⚠ 1 failure — "Gmail API error" [Re-trigger] [Dismiss]    │
└────────────────────────────────────────────────────────────┘
```

## v1 Scope

**Include**: `email_received` trigger, poll-based, single trigger per workflow, auto-approve safe reversible writes only, last-run status + failure notifications in per-workflow Automate panel, centralized Automations sidebar tab

**Defer to v2**: multiple triggers per workflow, schedule/cron triggers, calendar/drive triggers, retry logic, per-run execution log UI

## Clarifications

### Session 2026-04-16

- Q: Should auto-approve cover ALL write actions for triggered workflows, or only safe/reversible ones? → A: Safe writes only — `apply_label_to_threads`, `archive_email_threads`, `restore_email_threads`, `mark_threads_read`, `mute_email_threads`. Destructive/outbound actions (`send_email`, `trash_email_threads`, `drive_upload`, `docs_write`) remain approval-gated even in automated runs.
- Q: How should the scheduler authenticate with Gmail when there's no active user request? → A: Reuse existing `getAccessToken()` from server auth module — same pattern as the briefing background scanner (`scanSentEmailsForCommitments`).
- Q: What happens when a triggered workflow fails mid-execution? → A: Mark as processed, log the error, and surface a persistent failure notification in the UI so the user is aware and can re-trigger manually.
- Q: How does the frontend stay current with scheduler events (runs, failures)? → A: Frontend polls `GET /api/dynamic-tools/:name/trigger/status` every 30s while the Automate panel is open — same pattern as other FlowSpace data hooks.
- Q: Per-workflow Automate panel only, or also a centralized Automations sidebar view? → A: Both — add a centralized "Automations" sidebar tab showing all active triggers and their status across all workflows, in addition to the per-workflow panel in Studio.

## Verification

1. `npm run dev` — server starts; `[scheduler]` log appears if any trigger is enabled
2. Edit a saved workflow → "Automate" section visible below steps
3. Enable trigger: filter = `subject:credit card`, interval = 2 min → Save automation
4. Send a test email with "credit card" in subject to yourself
5. Within 2 min: workflow executes, email moved to label; console shows `[scheduler] executed <name> for message <id>`
6. `GET /api/dynamic-tools/:name/trigger/status` → `lastPollAt` updated, `processedCount = 1`
7. Re-send same email → same message ID skipped, workflow does NOT re-run
8. Disable trigger → scheduler clears interval, polling stops
9. `make typecheck` → zero errors
10. `npm test` → all suites green
11. `npm run test:coverage` → ≥ 80% on changed files
