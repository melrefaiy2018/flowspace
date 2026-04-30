# Phase 1 Data Model: Gmail Tab v1 — Action-First Work Surface

**Date**: 2026-04-11
**Branch**: `004-gmail-tab-v1`
**Spec**: [spec.md](./spec.md)
**Research**: [research.md](./research.md)

This document defines the entities that cross the wire or cross module boundaries in this feature. Each entity is defined with TypeScript-flavored pseudocode (no imports, no framework specifics) to keep the model language-agnostic while still being directly translatable to `src/services/api.ts` and `src/shared/chat.ts` when implementation starts.

Types that are reused unchanged from the existing codebase are cited and not redefined here.

---

## Entity Map

```
                      ┌──────────────────────┐
                      │ GmailThreadSummary   │ (existing, src/services/api.ts:100)
                      └──────────┬───────────┘
                                 │ 1:1 (by threadId)
                      ┌──────────▼───────────┐
                      │ ThreadEnrichment     │ (NEW)
                      │  - priority          │
                      │  - recommendedAction │
                      │  - whyItMatters      │
                      │  - effortMinutes     │
                      │  - bucket            │
                      └──────────┬───────────┘
                                 │ keyed by {threadId, lastMessageId}
                      ┌──────────▼───────────┐
                      │ EnrichmentCacheEntry │ (NEW, disk)
                      │  - enrichment        │
                      │  - cachedAt          │
                      │  - expiresAt         │
                      └──────────────────────┘

                      ┌──────────────────────┐
                      │ GmailThreadDetail    │ (existing, returned by /api/gmail/thread/:id)
                      └──────────┬───────────┘
                                 │ 1:1 (by threadId)
                      ┌──────────▼───────────┐
                      │ ThreadBrief          │ (NEW, in-memory session cache)
                      │  - summary           │
                      │  - recommendedAction │
                      │  - contextChips[]    │
                      │  - firstClassActions │
                      └──────────────────────┘

     ┌──────────────────┐  ┌─────────────────┐  ┌──────────────────────┐
     │ Bucket           │  │ QuickAction     │  │ FreeSlot (Pick times)│
     │ (enum)           │  │ (NEW)           │  │ (NEW)                │
     └──────────────────┘  └─────────────────┘  └──────────────────────┘

                      ┌──────────────────────┐
                      │ ApprovalRequest      │ (existing, src/shared/chat.ts:176)
                      └──────────────────────┘   REUSED VERBATIM
```

---

## 1. `ThreadEnrichment`

**Purpose.** Per-thread metadata computed by the intelligence service during list-level enrichment. Attached to each `GmailThreadSummary` the Gmail tab renders. Derived from thread metadata only (FR-006a — no message bodies transmitted).

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `threadId` | `string` | yes | Matches `GmailThreadSummary.id`. Used as the join key on the client. |
| `priority` | `'high' \| 'medium' \| 'low' \| 'none'` | yes | Visual priority band. `high` → red, `medium` → amber, `low` → blue, `none` → gray/empty (used for receipts/confirmations). |
| `recommendedAction` | `RecommendedAction` | yes (unless `priority === 'none'`) | One of a fixed vocabulary. See enum below. Must be "specific" per FR-019a — enrichments that return generic values are rejected. |
| `whyItMatters` | `string` | yes (unless `priority === 'none'`) | One sentence (≤120 chars) explaining the recommendation in the user's language. Example: "External reply — you asked on Apr 8." |
| `effortMinutes` | `EffortBucket` | yes | One of `'none' \| '1' \| '5' \| '15+'`. Maps to the row's effort chip. |
| `bucket` | `Bucket` | yes | Assigned bucket (see Bucket enum below). The server returns this value so the client does not need to duplicate the decision logic. |
| `specificityTokens` | `string[]` | optional | Debug-only: the concrete entities the LLM named when producing `recommendedAction` (e.g., `["Tuesday 2pm", "Apr 8"]`). Used by the acceptance-testing rule for FR-019a. May be stripped before sending to the client. |

**Validation rules (FR-001, FR-005, FR-006, FR-007a, FR-019a):**

- `priority` must be one of the four enum values; unknown values cause the entire enrichment entry to be discarded as a failure (FR-005 graceful fallback to plain row).
- If `priority !== 'none'`, both `recommendedAction` and `whyItMatters` are required.
- `recommendedAction` must satisfy the **specificity rule** (Q3 clarification): its text or `specificityTokens` must name at least one concrete entity from the thread or user context — a date, time, person, document, number, or decision. Generic strings matching `/^(reply|follow up|draft a response|respond|read)$/i` are rejected at the server boundary and treated as enrichment failures.
- `bucket` must satisfy the **tie-breaker rule** (Q4 clarification): when the LLM's recommended bucket could plausibly be `quick_wins` or `reference_fyi`, the server rewrites it to `reference_fyi` unless `recommendedAction ∈ { 'archive_subscription', 'unsubscribe', 'create_filter', 'mark_done' }`.
- `whyItMatters` is trimmed to 120 characters server-side; trailing ellipsis is appended if truncated.

**State transitions:** stateless. Enrichment is computed, cached, and invalidated — it does not transition through states. A thread's enrichment is simply replaced (not mutated) when it is recomputed.

**Pseudocode:**

```ts
type Priority = 'high' | 'medium' | 'low' | 'none';

type RecommendedAction =
  | 'draft_reply'
  | 'nudge'
  | 'decline'
  | 'delegate'
  | 'archive'
  | 'archive_subscription'
  | 'unsubscribe'
  | 'create_filter'
  | 'create_task'
  | 'save_to_drive'
  | 'mark_done'
  | 'snooze';

type EffortBucket = 'none' | '1' | '5' | '15+';

type Bucket = 'needs_reply' | 'waiting' | 'quick_wins' | 'reference_fyi';

interface ThreadEnrichment {
  threadId: string;
  priority: Priority;
  recommendedAction?: RecommendedAction;
  whyItMatters?: string;
  effortMinutes: EffortBucket;
  bucket: Bucket;
  specificityTokens?: string[]; // debug-only, may be omitted in prod responses
}
```

---

## 2. `EnrichmentCacheEntry`

**Purpose.** On-disk cache row for persistent enrichment. Lives in `DATA_DIR/.gmail-enrichment.{accountKey}.json`. Keyed by `{threadId}:{lastMessageId}` so that a new message in a thread naturally invalidates the entry (spec FR-003, FR-004).

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | `string` | yes | Compound key: `{threadId}:{lastMessageId}`. Used as the JSON object key in the cache file. |
| `enrichment` | `ThreadEnrichment` | yes | The cached enrichment payload. |
| `cachedAt` | `string (ISO timestamp)` | yes | When the entry was written. For observability and debugging. |
| `expiresAt` | `string (ISO timestamp)` | yes | `cachedAt + 24h`. On read, entries past this time are treated as cold and recomputed. |
| `invalidatedAt` | `string (ISO timestamp)` | optional | Set when a write action on the thread invalidates the entry. On read, a non-null `invalidatedAt` is treated as cold. |

**Storage shape** (the whole file):

```ts
interface EnrichmentCacheFile {
  version: 1;
  updatedAt: string; // ISO
  entries: Record<string, Omit<EnrichmentCacheEntry, 'key'>>; // key is the object key
}
```

**Validation rules:**

- `version` must equal `1`; unknown versions cause the cache to be discarded and rebuilt (no migration in v1).
- Entries with `expiresAt < now` or `invalidatedAt` set are skipped on read and lazily cleaned on next write.
- Writes go through the atomic tmp-file + rename pattern (see research Decision 3).

**State transitions:**

```
(not in cache) ──write──▶ [fresh]
                                │
                                │ 24h passes
                                ▼
                            [expired]
                                │
                                │ read triggers recompute
                                ▼
                          (replaced by new [fresh])

[fresh] ──thread write action──▶ [invalidated]
                                          │
                                          │ next read
                                          ▼
                                    (replaced by new [fresh])
```

---

## 3. `ThreadBrief`

**Purpose.** Decision-header data for Story 4. Computed on thread open. Per-session in-memory cache (FR-021); recomputed on server restart.

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `threadId` | `string` | yes | Matches `GmailThreadDetail.id`. |
| `summary` | `string` | yes (unless fallback) | One sentence (≤140 chars) describing what the thread is about. Example: "AMD recruiter asking for availability next week." |
| `recommendedAction` | `string` | yes (unless fallback) | Specific recommendation per the specificity rule. Example: "Send Tue 2pm or Thu 10am — both free on your calendar." Generic strings are rejected. |
| `contextChips` | `ContextChip[]` | yes | Up to 4 chips describing thread state. Examples: "Replied Apr 8", "Last message 2h ago", "Thread active 11 days", "3 external participants". |
| `firstClassActions` | `FirstClassAction[]` | yes | Ordered list of 3–5 prominent buttons for the decision header. Always includes `Draft reply` and at least one thread-specific action. |
| `isFallback` | `boolean` | yes | `true` when the brief could not be computed (FR-023); in that case `summary` and `recommendedAction` are empty and the UI renders the minimal fallback header. |
| `cachedAt` | `string (ISO timestamp)` | yes | When the brief was computed. Used for session-scoped cache timing. |

**Sub-entities:**

```ts
interface ContextChip {
  label: string;           // e.g. "Replied Apr 8"
  kind: 'reply_state' | 'last_message_age' | 'thread_age' | 'participants' | 'other';
}

type FirstClassAction =
  | { kind: 'draft_reply' }
  | { kind: 'pick_times' }
  | { kind: 'decline' }
  | { kind: 'delegate' }
  | { kind: 'save_to_drive' }
  | { kind: 'nudge' };
```

**Validation rules:**

- `summary` must be ≤140 chars. Truncated server-side.
- `recommendedAction` must satisfy the specificity rule (FR-019a). Failures downgrade the brief to `isFallback: true`.
- `firstClassActions` always includes `{ kind: 'draft_reply' }` as the first entry (FR-023 minimum fallback guarantee).
- Context chips are capped at 4; extras are dropped in the order listed in `ContextChip.kind`.

**State transitions:**

```
(not computed) ──thread open──▶ [pending: LLM call in flight]
                                       │
                    ┌──────────success──┴──failure──┐
                    ▼                               ▼
              [fresh brief]                  [isFallback: true]
                    │
                    │ session ends / server restart
                    ▼
                (not computed)
```

---

## 4. `Bucket` (enum)

**Purpose.** The four action-oriented groupings the Gmail tab renders instead of the three-tab header.

```ts
type Bucket = 'needs_reply' | 'waiting' | 'quick_wins' | 'reference_fyi';

interface BucketMeta {
  id: Bucket;
  label: string;                  // human-readable, e.g. "Needs reply"
  description: string;            // one-line subhead
  defaultExpanded: boolean;       // true for the first three, false for reference_fyi
  quickActionSet: QuickActionId[]; // which hover actions this bucket's rows expose
}

const BUCKETS: BucketMeta[] = [
  {
    id: 'needs_reply',
    label: 'Needs reply',
    description: 'You owe a response.',
    defaultExpanded: true,
    quickActionSet: ['draft_reply', 'snooze_1d', 'delegate'],
  },
  {
    id: 'waiting',
    label: 'Waiting on others',
    description: "You're blocked on someone else.",
    defaultExpanded: true,
    quickActionSet: ['nudge', 'remind_me_3d', 'mark_done'],
  },
  {
    id: 'quick_wins',
    label: 'Quick wins',
    description: 'One-click clears.',
    defaultExpanded: true,
    quickActionSet: ['archive', 'unsubscribe', 'create_filter'],
  },
  {
    id: 'reference_fyi',
    label: 'Reference / FYI',
    description: 'Read when you need it.',
    defaultExpanded: false,
    quickActionSet: ['archive', 'save_to_drive'],
  },
];
```

**Validation rules (FR-007, FR-008, FR-009, FR-012):**

- Exactly 4 buckets, in this order, in the rendered list.
- `defaultExpanded` is fixed at configuration time and cannot be changed by the user in v1.
- Count display on each bucket header is live: derived from the current `ThreadEnrichment.bucket` assignment, not cached separately.

---

## 5. `QuickAction`

**Purpose.** A row-level or decision-header action the user can fire from the Gmail tab. Each quick action has a label, execution mode (direct-fire with undo vs. approval-required), bucket affinity, and optional `ApprovalRequest` builder.

```ts
type QuickActionId =
  | 'draft_reply'
  | 'snooze_1d'
  | 'delegate'
  | 'archive'
  | 'unsubscribe'
  | 'create_filter'
  | 'nudge'
  | 'remind_me_3d'
  | 'mark_done'
  | 'save_to_drive'
  | 'pick_times'
  | 'decline';

type ExecutionMode =
  | { kind: 'direct'; undoable: boolean }
  | { kind: 'approval'; buildApproval: (thread: GmailThreadSummary) => ApprovalRequest };

interface QuickAction {
  id: QuickActionId;
  label: string;               // button label shown to the user
  iconName: string;            // Lucide icon name, e.g. "Reply" or "Archive"
  execution: ExecutionMode;
  buckets: Bucket[];           // which buckets this action appears on
  keyboardShortcut?: string;   // optional single-letter shortcut (reserved for a follow-up spec)
}
```

**Example action definitions** (not exhaustive):

```ts
const archiveAction: QuickAction = {
  id: 'archive',
  label: 'Archive',
  iconName: 'Archive',
  execution: { kind: 'direct', undoable: true },
  buckets: ['quick_wins', 'reference_fyi'],
};

const unsubscribeAction: QuickAction = {
  id: 'unsubscribe',
  label: 'Unsubscribe',
  iconName: 'MailX',
  execution: {
    kind: 'approval',
    buildApproval: (thread) => ({
      id: `unsubscribe-${thread.id}`,
      toolName: 'unsubscribe_from_sender',
      title: `Unsubscribe from ${thread.from}`,
      summary: `This will send an unsubscribe request and stop future messages from this sender.`,
      confirmLabel: 'Unsubscribe',
      fields: [/* populated server-side */],
      beforePreview: { subscription_status: 'Subscribed' },
      afterPreview: { subscription_status: 'Unsubscribed' },
      toolArgs: { sender: thread.from, threadId: thread.id },
    }),
  },
  buckets: ['quick_wins'],
};
```

**Validation rules (FR-013, FR-014, FR-015, FR-018):**

- `buckets` array is non-empty. An action with no bucket affinity never renders.
- `execution.kind === 'approval'` actions MUST return an `ApprovalRequest` whose `toolName` corresponds to an existing tool handler in `src/agent/tools.ts`. No new tool handlers are introduced by v1.
- `execution.kind === 'direct'` actions MUST pass through the existing bulk-action pipeline (`useGmailPage.ts performBulkAction()`) — no parallel per-thread handler is built.
- `keyboardShortcut` is optional in v1 and not shipped (reserved for a follow-up spec).

---

## 6. `FreeSlot`

**Purpose.** A candidate meeting slot returned by the free-slot helper for the "Pick times" action in the decision header.

```ts
interface FreeSlot {
  startIso: string;    // ISO 8601 with timezone, e.g. "2026-04-14T14:00:00-07:00"
  endIso: string;      // ISO 8601 with timezone
  durationMinutes: number;
  label: string;       // human-readable, e.g. "Tue Apr 14, 2:00 PM – 3:00 PM PDT"
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
}
```

**Validation rules:**

- All timestamps are in the user's local timezone (resolved server-side from the primary calendar's timezone metadata).
- `durationMinutes` is one of `{ 30, 60 }` in v1 (30-minute and 60-minute candidates generated by the free-slot computation).
- Slots are limited to business hours (9 AM–6 PM local time) and a 7-day horizon.
- Empty result (no free slots in window) is a valid response — the UI renders the empty-slot copy per the spec edge case.

---

## 7. `EnrichedThreadsResponse` (API envelope)

**Purpose.** Shape returned by the extended `POST /api/ai-triage` endpoint. This is the primary API contract for list enrichment.

```ts
interface EnrichedThreadsResponse {
  enrichments: ThreadEnrichment[];  // one entry per successfully enriched thread, keyed by threadId
  failed: string[];                  // threadIds that failed enrichment (FR-005: row falls back to plain layout)
  cacheStats: {
    hits: number;
    misses: number;
    totalRequested: number;
  };
  bucketCounts: Record<Bucket, number>;
  durationMs: number;
  // Legacy field retained for backwards compatibility with existing /api/ai-triage callers:
  categories?: { label: string; threadIds: string[] }[];
}
```

**Validation rules (FR-003, FR-005, FR-009, FR-025):**

- `enrichments.length + failed.length === totalRequested` — every thread is accounted for.
- `cacheStats.hits + cacheStats.misses === totalRequested`.
- `bucketCounts` is summed from the assigned buckets in `enrichments`; `failed` threads do not count toward any bucket.
- `categories` is optional and filled only when a legacy caller requests it (detected via query param `legacy=1`). New callers ignore it.

---

## 8. `ThreadBriefResponse` (API envelope)

**Purpose.** Shape returned by the new `GET /api/thread-brief/:threadId` endpoint.

```ts
interface ThreadBriefResponse {
  brief: ThreadBrief;
  cacheHit: boolean;
  durationMs: number;
}
```

**Validation rules (FR-019, FR-020, FR-021, FR-023):**

- `brief.isFallback` is true on any computation failure; the client renders the minimal fallback header.
- Cache hits return `cacheHit: true` and `durationMs < 50` (in-memory lookup).
- The endpoint MUST return within 5 seconds or abort and return `isFallback: true`.

---

## 9. Reused Types (unchanged)

These existing types are used as-is and not redefined here:

| Type | Current location | Used for |
|---|---|---|
| `GmailThreadSummary` | `src/services/api.ts:100-110` | Input to enrichment; rendered by row components |
| `GmailThreadDetail` | `src/services/api.ts` (returned by `/api/gmail/thread/:id`) | Input to `ThreadBrief` computation; rendered by `ThreadReader` |
| `GmailLabel` | `src/services/api.ts` | Label filter dropdown (unchanged) |
| `DraftReplyResponse` | `src/services/api.ts:361-367` | Inline reply composer (unchanged) |
| `InboxActionResponse` | `src/services/api.ts` | Bulk action results (reused by quick actions) |
| `ApprovalRequest` | `src/shared/chat.ts:176-189` | **Reused verbatim** for all quick-action write approvals |
| `ApprovalField` | `src/shared/chat.ts:168-174` | Fields inside `ApprovalRequest` |

---

## Cardinality & Lifecycle Summary

- **One `ThreadEnrichment` per thread per cache window.** 25 threads per batch, rolling 24h TTL, invalidated on write action.
- **One `ThreadBrief` per thread per session.** In-memory, cleared on server restart.
- **Exactly 4 `Bucket`s always.** Global constant; not data.
- **Zero-to-many `QuickAction`s per row.** Bucket-driven; derived from the static action registry at render time.
- **Zero-to-many `FreeSlot`s per Pick-times invocation.** 7-day horizon, 30/60-min increments, bounded at a reasonable upper bound (≤50 slots) to keep the mini-calendar legible.
- **Approval requests are transient.** Built on demand from a `QuickAction.execution.buildApproval(thread)` call, rendered by the imported `ApprovalCard` component, consumed on confirm/cancel.

---

## Open Questions for Phase 2 (Tasks)

None critical. A handful of implementation-level details (free-slot packing algorithm, exact system prompt wording for enrichment, jest-axe config shape) are properly deferred to the tasks phase where code is being written. None of them block the data model or the contracts.
