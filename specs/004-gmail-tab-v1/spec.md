# Feature Specification: Gmail Tab v1 — Action-First Work Surface

**Feature Branch**: `004-gmail-tab-v1`
**Created**: 2026-04-11
**Status**: Draft
**Input**: User description: "Gmail tab v1 — action-first work surface. Transform the FlowSpace Gmail tab from a mailbox clone into a work-execution surface by wiring existing FlowSpace intelligence into the Gmail page."

## Clarifications

### Session 2026-04-11

- Q: How should quick actions be reachable without a mouse hover? → A: Row is focusable; quick actions appear on focus as well as hover, reachable via Tab; screen readers announce the row's recommended action. WCAG 2.1 AA compliant.
- Q: What data about each thread is sent to the intelligence service during enrichment? → A: Subject + sender + snippet + recipient list + thread age + last-message direction for list-level enrichment. Full message bodies are sent only when the user explicitly opens a thread (decision-header brief in Story 4).
- Q: What makes a recommended action count as "specific" rather than "generic"? → A: A recommended action is "specific" if it names at least one concrete entity drawn from the thread or the user's context — a date, a time, a person, a document, a number, or a decision. Generic verbs alone ("reply," "follow up," "draft a response") fail the bar.
- Q: How is a thread assigned when it could plausibly belong to both Quick wins and Reference/FYI? → A: Prefer Reference/FYI when in doubt. Quick wins is reserved for threads with a clear, user-beneficial one-click action (archive recurring subscriptions, unsubscribe from promotional senders). Informational threads (receipts, shipping notifications, read-only confirmations) default to Reference/FYI.
- Q: What observability signals must be emitted so the team can tell if the Gmail tab enhancements are working in production? → A: Four counters — enrichment success rate (per batch), cache hit rate, fallback-to-three-tab rate, decision-header brief success rate — plus one latency histogram: time from Gmail tab open to enriched-row first paint.

## Overview

The FlowSpace Gmail tab today shows email the way Gmail shows email: a list of threads sorted by date, with sender, subject, snippet, and unread dot. It tells the user *what* each email is but not *what to do with it*. Meanwhile, FlowSpace has rich intelligence — triage buckets, recommended actions, priority signals, approval flows — that lives only on the dashboard and in chat, never reaching the Gmail tab itself.

This feature transforms the Gmail tab from a mailbox clone into a work-execution surface. Every row answers "what is this and what should I do?" at a glance. The tab organizes mail by what the user owes (needs reply), what they're waiting on, what they can clear in one click, and what's reference-only. Routine inbox actions (archive, unsubscribe, snooze, draft a reply) complete directly from the row without opening chat. Opening any thread surfaces a decision header with a one-sentence summary, a recommended next action, and first-class action buttons — the user can decide and act before reading the whole chain.

The feature intentionally reuses every piece of intelligence FlowSpace already has: the triage logic behind the dashboard's inbox panel, the approval card flow from the chat surface, the inline reply composer, and the thread-level agent actions. No new approval UI, no new composer, no new triage rules. The Gmail tab stops being a separate product and becomes a view into work through FlowSpace's eyes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Action-first rows replace a chronological inbox (Priority: P1)

The user opens the Gmail tab expecting the usual list. Instead, every row carries four new pieces of information next to the sender and subject: a colored priority indicator, a recommended next action (such as "Draft reply," "Archive," "Create task," "Save to Drive," or "Unsubscribe"), a one-sentence explanation of why it matters ("External reply — you asked on Apr 8"), and an effort estimate ("1 min" / "5 min" / "no action"). The user can scan the list and immediately see which messages need their attention, which they can ignore, and roughly how much work each will take — without opening any of them.

**Why this priority**: This is the foundational change. Without enriched rows, none of the other improvements have anywhere to live — the bucketing in Story 2 needs the priority signal, the quick actions in Story 3 need the recommended action, and the decision header in Story 4 uses the same intelligence at thread level. Shipping only this story already flips the Gmail tab from a reading list into a to-do list, which is the entire product thesis for the feature.

**Independent Test**: Open the Gmail tab with a real inbox of at least 20 threads. Confirm each row shows a priority indicator, a recommended action chip, a "why" line, and an effort estimate. Confirm the list still renders within 1 second even while enrichment is still being computed — the plain Gmail row must never be blocked by enrichment. Confirm that rows for read receipts and auto-notifications show "no action" effort and do not carry a priority indicator.

**Acceptance Scenarios**:

1. **Given** the user opens the Gmail tab for the first time in a session, **When** the thread list loads, **Then** the plain list renders within 1 second and enriched fields (priority indicator, recommended action, why line, effort estimate) appear progressively as enrichment completes, without causing rows to reflow or jump.
2. **Given** a thread from an external sender who replied to a message the user sent, **When** the row renders with enrichment, **Then** the recommended action is "Draft reply," the priority indicator is high, the why line names the original outgoing message date, and the effort estimate is "1 min" or "5 min."
3. **Given** a promotional newsletter, **When** the row renders with enrichment, **Then** the recommended action is "Archive" or "Unsubscribe," the priority indicator is low, and the effort estimate is "no action."
4. **Given** enrichment fails for a specific thread (upstream error, timeout), **When** the list renders, **Then** that row falls back gracefully to the plain layout with sender / subject / snippet / date and the user can still open it.
5. **Given** the user reopens the Gmail tab within 24 hours without any new messages arriving, **When** the list loads, **Then** enriched fields are available immediately from cache (no second round-trip), and rows appear enriched on first paint.

---

### User Story 2 - Bucketed view replaces three tabs (Priority: P1)

Today the Gmail tab header shows three tabs: Inbox, Triage, and Saved. Users have to know to click "Triage" to see the smart view — most don't. In the new view, the three tabs disappear. A single scrollable list groups threads into four action-oriented sections: **Needs reply** (the user owes a response), **Waiting on others** (the user is blocked on someone else), **Quick wins** (one-click archive/unsubscribe candidates), and **Reference / FYI** (collapsed by default). A "Show raw inbox" toggle remains available for users who occasionally want the chronological firehose. The "Saved" concept moves out of the tab bar into a header dropdown so it remains accessible without competing for primary real estate.

**Why this priority**: The bucketed view is what makes enriched rows legible at scale. Without it, a user with 80 threads still sees an undifferentiated wall of enriched rows. Bucketing turns "every row has a recommendation" into "here are the 4 things that need a reply, the 2 quick wins, and the 11 things you can ignore" — the difference between smart decoration and an actual to-do list.

**Independent Test**: Open the Gmail tab. Confirm the header no longer shows three tabs — instead, it shows the four bucket sections with counts. Confirm the Reference/FYI bucket is collapsed by default and expands on click. Confirm the "Show raw inbox" toggle is present and flipping it restores the chronological list. Confirm the Saved view is reachable from a header dropdown, not a top-level tab.

**Acceptance Scenarios**:

1. **Given** the user opens the Gmail tab, **When** the page loads, **Then** threads appear in four bucket sections (Needs reply, Waiting on others, Quick wins, Reference/FYI) ordered by priority within each bucket, and the three-tab header (Inbox/Triage/Saved) is no longer present.
2. **Given** there are 15 threads in the Reference/FYI bucket, **When** the page first renders, **Then** the bucket shows only its header and count — its threads are collapsed — and clicking the header expands them.
3. **Given** the user wants a chronological view, **When** they toggle "Show raw inbox," **Then** buckets collapse into a single flat list ordered by date (preserving the enriched rows), and toggling again restores the bucketed view.
4. **Given** the user had previously used the Saved tab, **When** they reach the new Gmail tab, **Then** a "Saved" entry is available from a header dropdown and clicking it opens the same saved view that exists today (no regression in access).
5. **Given** a thread's bucket changes after an action (e.g., user replies, thread moves from Needs reply to Waiting on others), **When** the list refreshes, **Then** the thread relocates to the correct bucket and its row count badge updates.

---

### User Story 3 - Inline quick actions eliminate routine chat trips (Priority: P2)

Hovering over any row reveals a small row of quick-action buttons whose options depend on the bucket. A Needs-reply row offers "Draft reply," "Snooze 1 day," and "Delegate." A Quick-wins row offers "Archive," "Unsubscribe," and "Create filter." A Waiting row offers "Nudge," "Remind me in 3 days," and "Mark done." Read-only and reversible actions (archive, snooze, mark done) fire directly with an undo affordance. Actions that send, delete, or modify external state (send a draft, unsubscribe, create a filter) route through the existing approval card flow that the user already knows from chat — the same amber card with Confirm / Cancel. "Draft reply" renders the draft inline beneath the row using the existing inline reply composer; the user never has to open chat for a routine reply.

**Why this priority**: This is where the product proves it's not just a prettier Gmail. If the user still has to open chat or switch apps to archive, unsubscribe, or send a quick reply, the work-execution promise stays theoretical. On the other hand, it's P2 rather than P1 because it depends on Stories 1 and 2 for the row model and bucketing — and without them, adding hover actions to a chronological list would feel grafted-on.

**Independent Test**: Hover over a row in each of the four buckets. Confirm the correct bucket-specific quick-action set appears. Confirm read-only actions (archive, snooze, mark done) fire immediately with an undo option and no approval prompt. Confirm write actions (send draft, unsubscribe, create filter) surface the existing approval card from the chat surface — not a new dialog. Confirm "Draft reply" renders the draft inline using the existing inline composer, not by opening chat.

**Acceptance Scenarios**:

1. **Given** a row in the Needs reply bucket, **When** the user hovers over it, **Then** three buttons appear: Draft reply, Snooze 1 day, Delegate — and no other bucket's actions are present.
2. **Given** the user clicks "Archive" on a Quick wins row, **When** the action fires, **Then** the thread disappears from the list immediately, a brief undo toast appears, and clicking undo restores the row to its previous bucket and position.
3. **Given** the user clicks "Unsubscribe" on a newsletter row, **When** the action fires, **Then** the existing approval card appears (the same one used in chat) showing the recipient's unsubscribe address and a Confirm/Cancel pair — no new approval UI is introduced.
4. **Given** the user clicks "Draft reply" on a Needs-reply row, **When** the draft is ready, **Then** the inline composer opens directly underneath the row (same composer used today in the thread reader), pre-populated with the draft, without the user leaving the Gmail tab or opening chat.
5. **Given** the user clicks "Remind me in 3 days" on a Waiting row, **When** the action fires, **Then** a follow-up entry is created (visible in the existing Followup surface) and the thread's row shows a small "Reminder set" chip that persists until the reminder fires or the user cancels it.

---

### User Story 4 - Thread reader becomes a decision surface (Priority: P2)

Opening a thread today drops the user into the raw message chain. They have to read through every message to figure out what the thread is about and what to do next. In the new view, a decision header sits above the message chain and always shows: a one-sentence summary ("AMD recruiter asking for availability next week"), a recommended next action ("Send 3 time slots — Tues/Thu afternoons, Wed morning are free"), a row of context chips ("Replied Apr 8," "Last message 2h ago," "Thread active 11 days"), and a row of first-class action buttons (Draft reply, Pick times, Decline, Delegate, Save to Drive). The "Pick times" action opens an inline mini-calendar showing the user's free slots so they can compose a response without leaving the thread. The message chain itself continues to render below the header, unchanged.

**Why this priority**: This carries the "action-first" promise into the thread view. It's P2 because the row-level changes in Stories 1–3 already give users most of the daily value — the decision header is a higher-cost, lower-frequency improvement (most triage happens at the list level). But it's essential for threads that genuinely need human judgment, where a summary and a recommended action compress 10 minutes of reading into a 10-second decision.

**Independent Test**: Open any thread with at least 3 messages. Confirm the decision header renders above the message chain (the body is unchanged). Confirm the summary is one sentence, the recommended action is specific (not generic like "reply"), the context chips reflect actual thread state, and the action buttons include at least Draft reply and Pick times. Click Pick times and confirm an inline calendar appears with the user's free slots. Confirm the header renders a loading skeleton while the summary is being computed and never blocks the user from reading the thread body.

**Acceptance Scenarios**:

1. **Given** the user opens a thread for the first time in a session, **When** the thread loads, **Then** the message chain body renders immediately and the decision header renders a loading skeleton that resolves into the real summary and recommended action within a few seconds.
2. **Given** a thread asking for a meeting time, **When** the decision header renders, **Then** the recommended action names specific free slots from the user's calendar (not a generic "reply with availability"), and clicking "Pick times" opens an inline mini-calendar with those slots preselected.
3. **Given** a thread the user has already replied to, **When** the decision header renders, **Then** a context chip shows "Replied {date}" and the recommended action reflects that state (e.g., "Waiting on their response — nudge after 3 days" rather than "Draft reply").
4. **Given** a thread summary has been computed before, **When** the user opens the same thread again, **Then** the summary appears immediately from cache without a loading skeleton.
5. **Given** the summary computation fails (upstream error, timeout), **When** the thread loads, **Then** the message chain still renders fully, the decision header shows a minimal fallback ("No summary available — Draft reply" button only), and the user is never blocked from reading the thread.

---

### Edge Cases

- **Enrichment batch partial failure**: a batch enrichment pass returns results for 18 of 20 threads. The 2 that failed render as plain rows alongside the 18 enriched ones; the list is not blocked, retried, or shown as an error.
- **Very old threads with no clear action**: an archival thread from months ago with no recent activity lands in the Reference / FYI bucket with effort "no action" and no recommended action chip.
- **Thread moving between buckets mid-session**: if the user archives a Needs-reply thread via a quick action, its counter decrements in the Needs reply bucket and the thread disappears; if the click was an accident, the undo toast restores it to the same bucket at the same position.
- **Show raw inbox toggled while buckets are expanded**: toggling to raw inbox flattens to a chronological list; toggling back restores the bucketed view with the same expansion state as before.
- **Saved items that were marked important via the old AI triage flow**: they remain accessible from the new Saved header dropdown with no migration required; the existing save/unsave flows continue to work.
- **Thread with no enrichment yet (cold cache)**: row shows a subtle skeleton for the enrichment fields while the plain row is fully interactive — the user can still open it, select it, or bulk-act on it before enrichment resolves.
- **Quick action on a thread whose enrichment is stale (user already archived it in another device)**: the action is issued; if the backend rejects it as already-applied, the row disappears silently (no error toast for a no-op success).
- **Offline or rate-limited state**: if enrichment is unavailable, the Gmail tab falls back entirely to the current three-tab experience with a small unobtrusive banner ("Smart view unavailable — showing standard inbox"). No broken state.
- **Thread reader opened for a thread whose summary hasn't been requested yet**: the decision header shows a skeleton, the thread body renders immediately, and the summary fills in when ready. The user is never told to "wait."
- **Bucket with zero threads**: the section renders its header with "(0)" and a muted "All clear" subline, or collapses entirely if all four buckets other than Reference/FYI are empty. Reference/FYI remains collapsed by default even when populated.
- **Quick action with approval required, user cancels**: the approval card's Cancel button dismisses the card and leaves the thread in place with no side effect.
- **"Pick times" when the user has no free slots in the next 7 days**: the inline calendar shows a helpful message ("No free slots in the next week — offer 'next Monday or later'?") instead of an empty grid.

## Requirements *(mandatory)*

### Functional Requirements

**Row enrichment (Story 1)**

- **FR-001**: The Gmail tab MUST display, for each thread, a priority indicator, a recommended-action label, a one-sentence "why it matters" line, and an effort estimate, in addition to the existing sender / subject / snippet / date fields.
- **FR-002**: The system MUST render the plain thread row within 1 second of the Gmail tab opening, regardless of whether enrichment has completed — enrichment MUST NOT block the initial list paint.
- **FR-003**: The system MUST cache enrichment results so that reopening the Gmail tab within 24 hours for the same threads shows enriched rows on first paint without re-computing.
- **FR-004**: The system MUST invalidate a thread's cached enrichment whenever the user performs a write action on that thread (archive, label change, reply sent, etc.).
- **FR-005**: When enrichment fails for a specific thread, the row MUST fall back to the plain layout without showing an error; the failure MUST NOT block other threads in the same batch.
- **FR-006**: The system MUST derive enrichment using the same triage logic that powers the existing dashboard inbox triage — there MUST be one source of truth for what a "recommended action" or "priority" means across the product.
- **FR-006a**: Data sent to the intelligence service during list-level enrichment MUST be limited to: each thread's subject, sender identity, existing Gmail snippet (the preview the user can already see in the list), recipient list, thread age, and last-message direction (from the user vs. from an external participant). Full message bodies MUST NOT be sent during list enrichment.
- **FR-006b**: Full thread message bodies MAY be sent to the intelligence service only when the user explicitly opens a thread, in which case the transmission powers the decision-header brief (Story 4). Closing a thread without opening any further thread MUST NOT cause additional body-level transmissions.

**Bucketed view (Story 2)**

- **FR-007**: The Gmail tab MUST display threads grouped into four buckets — Needs reply, Waiting on others, Quick wins, Reference/FYI — instead of the current three-tab header (Inbox / Triage / Saved).
- **FR-007a**: A thread MUST be assigned to **Quick wins** only if it has a clear, user-beneficial one-click action (such as archiving a recurring subscription or unsubscribing from a promotional sender). Informational threads that do not require or benefit from user action — including receipts, shipping notifications, read-only confirmations, and system alerts — MUST default to **Reference / FYI**. When a thread could plausibly belong to either bucket, the system MUST prefer Reference / FYI.
- **FR-008**: The Reference/FYI bucket MUST be collapsed by default; the other three buckets MUST be expanded by default.
- **FR-009**: Each bucket header MUST show a thread count that updates in real time as threads are acted on or enrichment reassigns them.
- **FR-010**: A "Show raw inbox" toggle MUST be available on the Gmail tab; activating it MUST flatten buckets into a chronological list without losing enriched row content.
- **FR-011**: The existing Saved functionality MUST remain reachable via a header dropdown on the Gmail tab; existing save/unsave flows MUST continue to work without change.
- **FR-012**: When a thread's state changes such that it belongs in a different bucket (e.g., the user sends a reply), the thread MUST relocate to the new bucket automatically on the next list refresh.

**Inline quick actions (Story 3)**

- **FR-013**: Each row MUST reveal a contextual row of quick-action buttons when the row is either hovered (desktop pointer) or keyboard-focused; the row itself MUST be focusable via `Tab` so keyboard-only users can reach its actions in sequence. The button set MUST depend on the row's bucket — Needs reply rows show Draft reply / Snooze 1 day / Delegate; Quick wins rows show Archive / Unsubscribe / Create filter; Waiting rows show Nudge / Remind me in 3 days / Mark done.
- **FR-013a**: The Gmail tab MUST meet WCAG 2.1 AA for the bucketed list and its quick actions. Screen readers MUST announce each row with its sender, subject, priority, recommended action, and effort estimate as part of the row's accessible name so that the row's meaning is conveyed without the user needing to interact with it. Focus indicators MUST be clearly visible on the row, the quick-action buttons, and the bucket headers.
- **FR-014**: Read-only and reversible actions (archive, snooze, mark done, remind me) MUST fire immediately on click and offer an undo affordance in a toast.
- **FR-015**: Write actions that send, delete, or modify external state (send draft, unsubscribe, create filter, delegate) MUST route through the existing approval flow used in chat — the system MUST NOT introduce a second approval UI.
- **FR-016**: "Draft reply" MUST render the generated draft inline underneath the row using the existing inline reply composer; it MUST NOT open chat or navigate away from the Gmail tab.
- **FR-017**: "Remind me in 3 days" MUST create an entry in the existing follow-up tracking surface; the entry MUST be visible and manageable from both the Gmail tab and the follow-up surface.
- **FR-018**: Quick actions MUST use the existing bulk-action infrastructure where possible; the system MUST NOT create a parallel per-thread action pipeline.

**Thread reader decision header (Story 4)**

- **FR-019**: When the user opens any thread, the system MUST render a decision header above the message chain showing a one-sentence summary, a recommended next action, context chips, and a row of first-class action buttons (at minimum: Draft reply, Pick times, Decline, Delegate, Save to Drive).
- **FR-019a**: The recommended next action in both the row enrichment (FR-001) and the decision header (FR-019) MUST be "specific," defined as naming at least one concrete entity drawn from the thread or the user's context — a date, a time, a person, a document, a number, or a decision. Generic verbs alone (e.g., "Reply," "Follow up," "Draft a response") MUST be rejected and treated as an enrichment failure (triggering the plain-row fallback for list enrichment, or the minimal fallback for the decision header).
- **FR-020**: The thread body MUST render immediately when the thread opens; the decision header MUST NOT block the body — it MAY render a loading skeleton while the summary is being computed.
- **FR-021**: The system MUST cache thread summaries so that reopening the same thread within a session shows the summary on first paint.
- **FR-022**: The "Pick times" action MUST open an inline mini-calendar showing the user's free slots, populated from the user's calendar data — the user MUST be able to compose a reply with selected times without leaving the thread.
- **FR-023**: If summary computation fails, the decision header MUST show a minimal fallback (Draft reply button only) and the user MUST still be able to read and act on the thread.
- **FR-024**: Context chips in the decision header MUST reflect actual thread state at the time of rendering — "Replied {date}", "Last message {relative time}", "Thread active {duration}" — and MUST NOT show stale data from cached summaries.

**Cross-cutting**

- **FR-025**: The feature MUST degrade entirely gracefully if any FlowSpace intelligence service is unavailable: the Gmail tab MUST fall back to the current three-tab experience with a small unobtrusive banner indicating the smart view is temporarily unavailable. No broken or empty states.
- **FR-026**: All existing Gmail tab functionality (search, label filter, bulk action bar, pagination, undo) MUST continue to work unchanged.
- **FR-027**: The system MUST emit the following observability signals so operators can detect regressions, validate cache behavior, and assess rollout health without building new monitoring infrastructure:
  - **Counter: enrichment success rate per batch** — number of threads successfully enriched divided by number of threads requested, reported per batch call.
  - **Counter: cache hit rate** — number of enrichment reads served from cache divided by total enrichment reads over a rolling window.
  - **Counter: fallback rate** — number of Gmail tab sessions that fell back to the pre-existing three-tab experience divided by total Gmail tab sessions over a rolling window.
  - **Counter: decision-header brief success rate** — number of thread-open events whose decision-header brief resolved successfully divided by total thread-open events.
  - **Latency histogram: tab-open to enriched first paint** — the elapsed time between the user opening the Gmail tab and the first paint that includes enriched row fields, distributed across a percentile histogram.

### Key Entities *(include if feature involves data)*

- **Thread enrichment**: per-thread metadata added to existing Gmail threads. Attributes: priority (red/amber/blue/gray), recommended action (one of a fixed set), "why it matters" (one sentence), effort estimate (no action / 1 min / 5 min / 15+ min), bucket assignment (needs_reply / waiting / quick_wins / reference_fyi). Derived from the user's message content, thread history, and calendar context. Cached for 24 hours keyed by thread identity and most-recent-message identity; invalidated on any write action against the thread.
- **Action bucket**: one of four fixed groupings in the new Gmail tab view. Each bucket has a display name, a count of threads currently assigned to it, a collapsed/expanded state, and a set of quick actions appropriate for threads in that bucket.
- **Thread brief**: per-thread decision-header metadata. Attributes: one-sentence summary, recommended next action (specific, not generic), context chips (reply state, last-message age, thread age, external participant count), and a set of first-class action buttons. Computed on thread open, cached per session.
- **Quick action**: a row-level or header-level action the user can fire from the Gmail tab without opening chat. Each quick action has a label, an execution mode (direct-fire with undo vs. approval-required), a target (single thread vs. batch), and a bucket affinity that determines when it appears.
- **Free-slot suggestion**: data returned when the user clicks "Pick times" in the decision header. Attributes: a list of suggested meeting slots from the user's calendar over the next 7 days, each with start time, end time, and a human-readable label.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a user opens the Gmail tab with a cold cache, the plain thread list is interactive (rows visible, scrollable, clickable) within 1 second; enriched fields appear progressively within the following 5 seconds for a typical 25-thread page.
- **SC-002**: When a user reopens the Gmail tab within 24 hours with no new messages, enriched rows render on first paint (no visible delay between list appearance and enrichment appearance).
- **SC-003**: At least 70% of routine inbox actions (archive, unsubscribe, snooze, mark done, send short reply) can be completed from the Gmail tab without the user opening chat or switching apps.
- **SC-004**: In user testing, users can correctly identify the three most urgent threads in their inbox in under 10 seconds — a meaningful improvement over the current chronological list.
- **SC-005**: In user testing, users can decide on a next action for a newly-opened thread in under 15 seconds using only the decision header, without scrolling through the message chain.
- **SC-006**: Zero new approval UIs are introduced — all write actions that require confirmation use the existing chat-surface approval card, verifiable by visual inspection against the current approval card.
- **SC-007**: When any FlowSpace intelligence service is unavailable, the Gmail tab falls back to the pre-existing three-tab experience within 500 ms of detecting the failure, with zero broken or empty states.
- **SC-008**: The bucketed default view shows no more than 4 top-level sections; no user needs to navigate tabs, filters, or menus to see what they owe a reply on, what they're waiting on, and what they can clear quickly.
- **SC-009**: Clicking "Pick times" in the decision header produces a response with specific time suggestions drawn from the user's calendar in under 3 seconds for a user with a normal calendar (up to 50 events in the next 7 days).
- **SC-010**: All existing Gmail tab functionality (search, label filter, bulk actions, pagination, undo) passes regression testing — no degradation in the raw-inbox path.

## Out of Scope

The following are explicitly excluded from this feature (v1). They may be addressed in follow-up specs:

- **Unified Tracked store.** Merging the current Saved concept with follow-ups and the future Waiting screen into a single data model. The Saved view in v1 continues to behave exactly as it does today; only its entry point moves (to a header dropdown).
- **Missed-commitment scan.** A server-side pass that extracts commitments from sent mail and cross-references the inbox for completion. Deferred — depends on the Tracked store.
- **Semantic search.** Natural-language search rewrites using the agent tool suite. Gmail's native keyword search continues unchanged in v1.
- **Cleanout focus mode.** Full-screen keyboard-driven inbox cleanup loop. Deferred as a delight feature.
- **Navigation demotion.** Moving Gmail/Drive/Calendar/Tasks under a single Workspace parent route in the app rail. Belongs with the broader product navigation redesign.
- **Memory integration.** Surfacing memory hits in the decision header (e.g., "You met this person at X conference"). Deferred until the memory surface has user-validated usage signals.
- **Cross-account enrichment.** Users with multiple connected Google accounts will see enrichment per-account with no cross-account aggregation in v1.
- **Mobile-specific interactions.** Swipe-to-action gestures for quick actions on mobile. v1 ships hover-based desktop interactions; mobile users get tap-to-reveal as a fallback.

## Assumptions

These assumptions were made during spec drafting based on the FlowSpace codebase, existing user patterns, and industry defaults. Each can be revisited during clarification if it turns out not to hold.

- **Enrichment is a batch operation.** Enrichment runs on a page of threads at a time (typically 25), not per-thread round-trips. This matches the existing triage pipeline and avoids N round-trips on every list load.
- **24-hour cache TTL is acceptable.** Most threads' recommended action doesn't change materially within a day. The cache is invalidated on write actions anyway, so the TTL is a safety net, not the primary freshness mechanism.
- **"Waiting on others" detection is intelligence-driven.** The heuristic is "last message is from the user AND is more than 24 hours old AND the thread has external participants" — but the actual bucket assignment is made by the same intelligence that enriches the row, so it can override the heuristic with thread-specific judgment.
- **Undo is already supported.** The existing bulk-action infrastructure supports undo via an audit-log pattern. Quick actions reuse this — no new undo backend is built.
- **The existing approval card is sufficient for all quick actions.** The amber confirmation card currently used in chat has enough fields (before/after preview, editable recipients, editable body) to handle every write action the quick-action menu introduces. If a new field is needed for a specific action, the existing card is extended rather than replaced.
- **"Pick times" reads from one calendar.** If the user has multiple calendars connected, the system uses the primary calendar. Multi-calendar free-slot aggregation is out of scope.
- **Thread brief caching is per-session.** Unlike enrichment (24h persistent cache), thread briefs are cached only for the current session. Briefs are cheap to recompute and stale briefs are worse than stale enrichment (they drive a single decision, not a list scan).
- **Graceful degradation means the three-tab fallback.** When intelligence services are unavailable, the Gmail tab reverts to the current Inbox/Triage/Saved experience rather than showing an error or a partially-enriched view. This is the safest fallback because the current experience is known-working.
- **No new icons or design tokens.** The feature uses existing FlowSpace color tokens, icon set, and card styles. Any new visual variant (e.g., the priority bar) is a recombination of existing tokens.
- **Bulk selection continues to work across buckets.** Users can select threads across multiple buckets and apply a bulk action (archive, trash, mark read, mute). The bulk action bar behavior is unchanged from today.
