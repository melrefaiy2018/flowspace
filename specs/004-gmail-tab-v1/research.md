# Phase 0 Research: Gmail Tab v1 — Action-First Work Surface

**Date**: 2026-04-11
**Branch**: `004-gmail-tab-v1`
**Spec**: [spec.md](./spec.md)

This document resolves the technical unknowns surfaced during Phase 0 research, citing the real code paths the implementation will build on. Each decision is anchored to a file and line number so the tasks phase can reference them directly.

---

## Decision 1: Where does enrichment compute, and does it extend `/api/ai-triage` or create a new endpoint?

**Decision**: Extend the existing `POST /api/ai-triage` handler (`server.ts:3516`) to return a richer per-thread shape (priority, recommendedAction, whyItMatters, effortMinutes, bucket). The endpoint already accepts a batch of `GmailThreadSummary`, already calls `createLLMClient()` via `src/lib/ai-triage.ts` (lines 15-40), and already returns grouped results. Extending it avoids a second round-trip and a second prompt path. The extension is backwards-compatible by adding fields to the response — the existing dashboard caller (which only reads `categories[].threadIds`) continues to work.

**Rationale**:
- The current handler already composes system + user messages from thread metadata only (`src/lib/ai-triage.ts:15-40`), which matches FR-006a's "no bodies during list enrichment" requirement exactly — no privacy work needed.
- It already uses `createLLMClient()` (the shared factory in `src/agent/llm-client.ts:20-40`), so no new LLM client or provider plumbing.
- It already uses `callWithRetry` with a 2000ms timeout — the same timeout strategy we want for enrichment fallback (FR-005).
- Creating a parallel endpoint would duplicate the prompt, duplicate the retry logic, and produce two sources of truth for "what is a recommended action" — directly violating FR-006.

**Alternatives considered**:
- **New `POST /api/gmail/enrich-batch` endpoint.** Rejected — it would duplicate the LLM plumbing and create a second prompt source. The existing endpoint's response shape has no backward-incompatibility cost.
- **Per-thread `POST /api/ai-triage/:threadId`.** Rejected — N round-trips on every list load defeats SC-001 (1-second budget).
- **Client-side heuristic enrichment.** Rejected — `src/lib/triage.ts:49-85` already proves heuristics can't produce FR-019a-compliant "specific" recommended actions (they only know sender patterns and labels).

---

## Decision 2: How is the list-level enrichment prompt shared between the endpoint and the `gmail_triage` agent tool?

**Decision**: Extract the enrichment prompt into a new `src/agent/prompts/gmail-enrichment.ts` module. This module exports two functions: `buildListEnrichmentPrompt(threads: GmailThreadSummary[])` and `buildThreadBriefPrompt(thread: GmailThreadDetail)`. Both endpoints (`/api/ai-triage` and the new `/api/thread-brief/:id`) import from this module. The existing `src/lib/ai-triage.ts` is refactored to re-export from here for backward compatibility.

**Rationale**:
- The spec (FR-006) requires "one source of truth for what a recommended action or priority means across the product." Extraction is the literal implementation of that rule.
- The existing `gmail_triage` agent tool in `src/agent/tools.ts:1962-1965` delegates to the `gws` CLI, which is a *different* triage path. It does not currently share logic with `/api/ai-triage`. Rather than force-aligning the two, the new shared prompt module becomes the canonical path for enrichment, and the agent tool's `gws` delegation is left in place as a legacy fallback accessible via chat. In a follow-up spec we can retire the `gws`-backed tool in favor of a direct call through this module.
- `src/lib/ai-triage.ts:15-40` already contains the system prompt and user message builder. Moving them into `src/agent/prompts/gmail-enrichment.ts` is a cut-paste + re-export, zero logic change.

**Alternatives considered**:
- **Inline the prompt in both callers.** Rejected — direct violation of FR-006 single-source-of-truth rule.
- **Extract into `src/lib/prompts/`.** Rejected — `src/agent/prompts/` puts it next to the existing agent prompt infrastructure (`src/agent/chat.ts` system prompts) and signals that this is LLM-facing content, not a frontend lib.
- **Route the agent tool through the endpoint.** Rejected for v1 — the `gws`-backed tool has different I/O shape and different authentication path. Aligning them is out of scope.

---

## Decision 3: Cache format, location, and atomic-write pattern

**Decision**: Persistent list enrichment cache at `DATA_DIR/.gmail-enrichment.{accountKey}.json`, resolved via `getScopedDataPath('gmail-enrichment', accountKey)` (the same pattern `server.ts:463-469` uses for `.followup-state.{accountKey}.json`, `.persona.*.json`, `.importance-preferences.*.json`, and `.quick-actions.*.json`). The file format is a JSON object keyed by `{threadId}:{lastMessageId}` with `{ enrichment, cachedAt, expiresAt }` entries. Writes use a **tmp-file + rename** atomic pattern (improvement over the direct `fs.writeFileSync` used by `writeFollowupState` at `server.ts:2716-2721`). A new module `src/lib/enrichment-cache.ts` encapsulates reads, writes, TTL checks, and per-key invalidation.

**Rationale**:
- **`getScopedDataPath` over a new path.** Every FlowSpace state file today is account-scoped via this helper, which provides `SAFE_PATH_SEGMENT` validation and per-account isolation. A new Gmail enrichment file must follow the same convention so that multi-account users get correct isolation and the cache cannot collide across accounts.
- **24h TTL over shorter/longer.** Spec clarification Q2 and the assumption in spec.md fix TTL at 24h. The cache is belt-and-suspenders: primary invalidation is on write actions (FR-004), so TTL is just a safety net for silent cache poisoning.
- **tmp-file + rename over direct write.** `writeFollowupState` today uses `fs.writeFileSync` directly (no atomicity). This is acceptable for `.followup-state.json` because it's a single-writer hot file with low corruption blast radius. For `.gmail-enrichment.json`, a crash mid-write could leave the file partially written and cause cold-cache failures on every subsequent Gmail tab open. The tmp-file + rename pattern (`fs.writeFileSync(tmp)` → `fs.renameSync(tmp, final)`) is an O(1) cost improvement that makes the cache robust to crashes. This is the single most common Node.js atomic-write idiom and needs no new dependency.
- **`{threadId}:{lastMessageId}` compound key.** Matches FR-003 (cache per thread+message identity, so a new message invalidates the entry naturally).

**Alternatives considered**:
- **Per-thread one-file-per-entry cache.** Rejected — produces N files per account, poor on macOS filesystem for large inboxes, and no faster than a single JSON file for our scale.
- **In-memory only cache.** Rejected — fails SC-002 (enriched on first paint when the user reopens the tab within 24h).
- **SQLite.** Rejected — no SQLite dependency exists in the project today, and the cache access pattern (read all on startup, write per batch) is a perfect fit for a single JSON file. Adding SQLite would be a new dependency for zero benefit.

---

## Decision 4: How is the thread-brief endpoint built, and where does its prompt come from?

**Decision**: New `GET /api/thread-brief/:threadId` endpoint in `server.ts`. It fetches the full Gmail thread (using the same `GmailThreadDetail` shape returned by the existing `/api/gmail/thread/:threadId` handler at `server.ts:1578`), calls `createLLMClient()` with `buildThreadBriefPrompt()` from `src/agent/prompts/gmail-enrichment.ts`, and returns a `ThreadBrief` object. Because FR-021 specifies **per-session** caching (not 24h like the list cache), the brief cache is an in-memory `Map<threadId, { brief, cachedAt }>` maintained on the server; it clears on server restart. No disk persistence.

**Rationale**:
- **Reuse thread fetch logic.** `server.ts:1578` already extracts messages with full bodies — the same data shape the brief prompt needs. Rebuilding the thread fetch would duplicate auth handling, message-body extraction, and attachment parsing.
- **Reuse the LLM factory.** Same `createLLMClient()` path as `/api/draft-reply` (`server.ts:3555-3636`) and `/api/ai-triage`. No new LLM glue.
- **In-memory cache over disk cache.** Spec assumption: "Thread brief caching is per-session." Briefs are cheap to recompute, and stale briefs are worse than stale enrichment because they drive a single decision (not a scan). Session-scoped avoids the write-invalidation complexity of a disk cache for a short-lived signal.
- **Separate endpoint over embedding in `/api/gmail/thread/:threadId`.** Keeps the body fetch fast when the reader just wants messages (e.g., a user clicking Back then forward rapidly); the brief endpoint is only hit once per thread per session.

**Alternatives considered**:
- **Merge into `/api/gmail/thread/:threadId`.** Rejected — forces every thread open to wait on the LLM call, violating FR-020 (thread body renders immediately, header renders later).
- **Stream brief via SSE.** Rejected — adds complexity for no user-visible win over a plain JSON fetch with a skeleton.
- **Pre-compute briefs in the background after list enrichment.** Rejected for v1 — speculatively computing briefs for threads the user never opens wastes LLM budget and raises the same privacy question (body transmission) for threads the user hasn't explicitly chosen to view.

---

## Decision 5: How do write quick actions route through the approval card without building a second approval UI?

**Decision**: Import `ApprovalCard` directly from `src/components/ChatThread.tsx` (lines 578-701). It is already a pure presentational component that accepts `{ approval, onApprove, onCancel }` props and has no ChatThread-specific wiring. The new `QuickActionMenu.tsx` component in `src/components/gmail/` dispatches write actions by building an `ApprovalRequest` (from `src/shared/chat.ts:176-189`), rendering `<ApprovalCard>` inline beneath the affected row via a portal or inline absolute-positioned overlay, and handling `onApprove` with a direct fetch to the existing tool handler endpoint.

**Rationale**:
- The spec's strongest reuse constraint (FR-015, Q2 clarification): "no second approval UI." Direct import is the literal implementation.
- Verified in grounding research: `ApprovalCard` is defined at `ChatThread.tsx:578-701` as a standalone function component with no `useChatContext()` dependency inside its body. It takes props and fires callbacks. Nothing in the component body couples it to chat.
- `ApprovalRequest` schema (`src/shared/chat.ts:168-189`) has `fields[]` (editable input/textarea), `beforePreview`, `afterPreview`, and `toolArgs` — a verified superset of the fields each v1 quick action needs (send draft, unsubscribe, create filter, delegate). **No schema extension required.**
- The existing ChatContext `approveAction(messageId, approval)` (used in `ChatThread.tsx:860`) expects a `messageId` to associate the approval with a chat message. Gmail tab approvals have no chat message, so `QuickActionMenu` will bypass `approveAction` and call a direct `api.performApprovedToolAction(toolName, approval)` that wraps the existing server-side tool execution. This helper is tiny (~20 lines) and does not duplicate approval UI — it only provides a non-chat invocation path for the same tool handlers chat already uses.

**Alternatives considered**:
- **Export `ApprovalCard` into a new `src/components/shared/` directory first.** Rejected for v1 — moving the file would create a diff across `ChatThread.tsx` and all its imports. A direct import from the existing path works today; we can relocate later as a cleanup.
- **Open chat with an approval pre-loaded.** Rejected — violates FR-016 ("MUST NOT open chat or navigate away from the Gmail tab") and the product thesis that routine actions complete without leaving the tab.
- **Render a native `window.confirm`.** Rejected — not WCAG-accessible, not themable, and users wouldn't recognize it as the FlowSpace approval flow.

---

## Decision 6: How does "Pick times" compute free slots, and where does the inline mini-calendar get data?

**Decision**: New backend helper `GET /api/calendar/free-slots?horizonDays=7` which reads the user's primary calendar (via the existing `gws calendar +agenda` path used by the `calendar_agenda` tool at `src/agent/tools.ts:1927-1960`) and computes free slots by interval-diffing busy periods against business hours (9 AM–6 PM local time, configurable later). Returns `FreeSlot[]` with ISO start/end timestamps and human labels ("Tue 2:00 PM–3:00 PM"). The new frontend component `PickTimesInlineCalendar.tsx` renders a 7-day grid of those slots as clickable chips; clicking a chip appends it to a draft reply.

**Rationale**:
- **No existing free-slot tool.** Grounding research confirmed: `calendar_agenda` returns TODAY's events; there is no `gcal_find_my_free_time`-style tool in the local codebase (that one is an MCP tool in the agent's external tool list). v1 needs to build this.
- **Backend computation over frontend.** Moves the busy-period interval logic server-side where the gws CLI already lives; keeps the frontend a dumb renderer. Also makes the free-slot computation reusable by future features (e.g., proactive Prepare surface).
- **Primary calendar only.** Per spec assumption and Q3 clarification context. Multi-calendar aggregation is out of scope.
- **9 AM–6 PM local time business hours.** Industry-default working-hours assumption; can be made user-configurable in a follow-up. A fixed default lets v1 ship without a settings surface.
- **Empty-slots case handled with copy.** The inline calendar shows "No free slots in the next week — offer 'next Monday or later'?" (per edge case in spec) rather than an empty grid.

**Alternatives considered**:
- **Call a full scheduling library (Cal.com, Google's FreeBusy API directly).** Rejected — the gws CLI already wraps Google's calendar API; using it avoids adding another Google API client path. Google's FreeBusy API is an optimization we can do later if performance matters.
- **Computed on-demand in the frontend.** Rejected — requires shipping calendar event data to the client and doing interval math there; duplicates logic already handled server-side by gws.
- **No free-slot feature — just a text note like "See your calendar".** Rejected — the spec's Story 4 acceptance scenario #2 explicitly requires naming specific slots.

---

## Decision 7: How is bucket assignment refactored to use enrichment instead of heuristics?

**Decision**: `src/lib/triage.ts` (currently at 86 lines) gains a new exported function `assignBucketsFromEnrichment(threads, enrichments): BucketedThreads` that takes the list of thread summaries AND their enrichment map and returns a `{ needs_reply, waiting, quick_wins, reference_fyi }` shape. The existing `triageThreads` heuristic function (lines 49-85) is kept as the fallback path used when enrichment is unavailable (FR-025 graceful degradation). The frontend's `BucketedThreadList.tsx` uses `assignBucketsFromEnrichment` when enrichment is ready, falling back to the current three-tab experience (via `GmailTriageView.tsx` + the existing `triageThreads`) when it isn't.

**Rationale**:
- **Additive, not replacement.** Keeping the heuristic path in place means the fallback case (FR-025) is not a separate code path — it's literally the code that runs today. Lower risk at rollout, easy to A/B.
- **Q4 clarification rule lives here.** "Prefer Reference/FYI when in doubt" is implemented as: if the enrichment says `recommendedAction ∈ {archive, unsubscribe, create_filter, delegate_recurring}` AND the user would benefit from a click, → `quick_wins`. Otherwise (including receipts, confirmations, notifications) → `reference_fyi`. Encoded in `assignBucketsFromEnrichment` and unit-tested.
- **Single-pass mapping.** The function iterates once over threads, looks up enrichment in a Map, assigns a bucket. O(n). No priority sorting magic — enrichment `priority` field determines intra-bucket order.

**Alternatives considered**:
- **Do bucket assignment server-side in `/api/ai-triage`.** Rejected — coupling bucket labels to the server response means any UI rename requires a server redeploy. Separating the enrichment shape (priority, recommendedAction) from the presentation (bucket) gives us UI flexibility.
- **Delete `triageThreads` entirely.** Rejected — violates FR-025 graceful degradation.

---

## Decision 8: How does accessibility (WCAG 2.1 AA) get enforced per Q1 clarification?

**Decision**: Two-layered enforcement.

**Layer 1 — component contract.** Every new row/bucket/button component in `src/components/gmail/` is built with:
- `tabIndex={0}` on the row itself (already the pattern in `ThreadList.tsx:77-78`)
- `aria-label` on the row that concatenates sender, subject, priority, recommended action, and effort estimate as one screen-reader string ("Alice, AMD offer, high priority, draft reply, 1 minute")
- Quick-action buttons rendered inside the row's focus container so `Tab` reaches them in order (hover-reveal becomes `opacity-0 group-focus-within:opacity-100 group-hover:opacity-100`)
- `aria-expanded` on collapsible bucket section headers (following the `InboxTriage.tsx:126` pattern)
- Visible focus rings (Tailwind `focus-visible:ring-2 focus-visible:ring-white/20`)
- Enter/Space keyboard activation on every clickable non-button element (following the `ThreadList.tsx:80-85` pattern)

**Layer 2 — automated test.** Add `jest-axe` as a dev dependency and write one integration test per new component (`EnrichedThreadRow`, `BucketedThreadList`, `QuickActionMenu`, `ThreadDecisionHeader`, `PickTimesInlineCalendar`) that renders the component and asserts `expect(await axe(container)).toHaveNoViolations()`. This catches regressions in CI.

**Rationale**:
- The existing codebase has the right patterns (ARIA labels, tabIndex, Enter/Space handlers) but no automated accessibility testing. The smallest addition that enforces Q1 is `jest-axe` in component tests.
- Layer 1 uses only patterns already proven in `ThreadList.tsx`, `InboxTriage.tsx`, and `ChatThread.tsx` — no new primitives.

**Alternatives considered**:
- **Manual audit only.** Rejected — Q1's answer was WCAG 2.1 AA as a *requirement*, not a goal. Regressions need a test gate.
- **Full `eslint-plugin-jsx-a11y`.** Rejected for v1 — lints produce noise on existing code that predates the rule. Narrower per-component `jest-axe` assertions give us the same signal for the new files without forcing a repo-wide cleanup.

---

## Decision 9: Observability — how to emit the four counters + one histogram without new infrastructure

**Decision**: Emit structured JSON log lines (`console.log(JSON.stringify({ event, ...metrics }))`) from `server.ts` at five measurement points. The existing HTTP request logger (`server.ts:80-82`) already uses plain `console.log` lines, so adding structured events to the same stream requires zero new dependencies. A downstream log pipeline (Datadog, CloudWatch, etc.) can aggregate on the `event` field.

**Measurement points:**

1. **`event: "gmail_enrichment_batch"`** — emitted after each `/api/ai-triage` (extended) call. Fields: `batchSize`, `successCount`, `successRate`, `cacheHits`, `cacheHitRate`, `durationMs`, `accountKey`.
2. **`event: "gmail_tab_fallback"`** — emitted when the frontend detects enrichment unavailability and renders the fallback banner. Fields: `reason` (upstream_error | timeout | rate_limited), `accountKey`. Sent back to the server via a minimal `POST /api/telemetry/fallback` endpoint so the counter lives in one place.
3. **`event: "thread_brief_complete"`** — emitted after each `/api/thread-brief/:id` call. Fields: `threadId`, `success`, `durationMs`.
4. **`event: "gmail_tab_interactive"`** — emitted by the frontend (via `POST /api/telemetry/gmail-interactive`) when the first enriched row paints. Fields: `msFromOpen`, `threadCount`.
5. **Aggregated counters** are derived downstream from these events; no in-process counter state is maintained. Keeps server memory flat.

**Rationale**:
- **No metrics library exists in server.ts today.** Grounding research confirmed zero prom-client, zero StatsD, zero custom counter helpers. Adding one would create a dependency where a structured log line does the same job.
- **Downstream aggregation is standard.** Datadog, CloudWatch Logs Insights, Vector, Loki — all support aggregating on a JSON field in log lines. The product team can pick any of them without changing server code.
- **`POST /api/telemetry/*` endpoints are tiny.** They accept `{ event, fields }` and forward to `console.log`. Two endpoints, ~30 lines total.
- **FR-027 defines the exact metrics.** The plan is literally: "emit the events FR-027 names, let the log pipeline count them."

**Alternatives considered**:
- **Add prom-client + /metrics endpoint.** Rejected — requires a Prometheus scraper we don't have, adds a dependency, and doesn't integrate with the existing log pipeline.
- **No observability at all, defer to follow-up.** Rejected — Q5 clarification explicitly scoped the four counters + histogram into v1 because rolling back a bad release without signals is unsafe.
- **Frontend-only observability via a third-party SDK (Sentry, LogRocket).** Rejected — wouldn't capture backend-side enrichment failures, which are the most important signal.

---

## Summary of Resolved Unknowns

| Unknown from plan Technical Context | Resolution | Key file/line |
|---|---|---|
| Where to extend enrichment logic | Extend `/api/ai-triage` in place | `server.ts:3516`, `src/lib/ai-triage.ts:15-40` |
| Prompt sharing between endpoint and agent tool | Extract into `src/agent/prompts/gmail-enrichment.ts` | new file |
| Cache file format and atomic writes | `.gmail-enrichment.{accountKey}.json`, tmp+rename | `src/lib/enrichment-cache.ts` (new), pattern from `server.ts:463-469` |
| Thread brief implementation | New `/api/thread-brief/:id` + in-memory session cache | `server.ts`, uses `server.ts:1578` thread fetch |
| Approval UI reuse | Direct import of `ApprovalCard` | `src/components/ChatThread.tsx:578-701` |
| Approval invocation from Gmail tab | New `api.performApprovedToolAction()` thin wrapper | `src/services/api.ts` modification |
| Free slots for Pick times | New `GET /api/calendar/free-slots` + `PickTimesInlineCalendar.tsx` | uses `gws calendar +agenda` like `src/agent/tools.ts:1927-1960` |
| Bucket assignment refactor | `assignBucketsFromEnrichment` in `src/lib/triage.ts`, heuristic path retained for fallback | `src/lib/triage.ts:49-85` extended |
| WCAG enforcement | `jest-axe` + patterns already in `ThreadList.tsx:77-85`, `InboxTriage.tsx:126` | new dev dep, existing patterns |
| Observability infrastructure | Structured JSON log lines via `console.log`, no new library | `server.ts:80-82` pattern extended |

All Phase 0 unknowns are resolved. No `NEEDS CLARIFICATION` markers remain. Phase 1 can proceed to `data-model.md`, `contracts/`, and `quickstart.md`.
