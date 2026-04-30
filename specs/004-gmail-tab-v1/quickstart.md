# Quickstart: Gmail Tab v1 — Action-First Work Surface

**Audience**: Developer validating the v1 milestone manually, or QA running acceptance.
**Prerequisites**: Feature fully implemented on branch `004-gmail-tab-v1`, FlowSpace running locally via `make dev`, a real Google Workspace account connected via gws CLI, an inbox with at least 20 threads spanning multiple types (work replies, promotional, receipts, meeting invites).

This quickstart walks end-to-end through the four user stories, with explicit pass/fail observations at each step. It doubles as the manual-test checklist for pre-release sign-off.

---

## 0. Environment setup

```bash
cd /Users/mohamed/Documents/Research/Projects/GitHub_repo/flowspace
git checkout 004-gmail-tab-v1
npm ci
make dev
```

**Expected**: Express + Vite HMR server starts, logs `[http] listening on http://localhost:3000`. Browser opens to the dashboard, authenticated.

**Pre-check**:
- Confirm at least 20 threads in the Gmail inbox.
- Confirm calendar has events for the next 7 days (for Pick times testing).
- Confirm `DATA_DIR` resolves correctly: `ls .gmail-enrichment.*.json` — file may not exist yet on first run (cold cache), which is expected.

---

## 1. User Story 1 — Action-first rows

### Step 1.1 — Cold cache, first open

1. Open the Gmail tab from the app rail. Watch the network tab.

**Observe**:
- The thread list appears within 1 second of clicking the tab (SC-001).
- During the first second, rows are plain (sender / subject / snippet / date) — no priority indicator, no recommended action chip, no why line, no effort estimate.
- Within the next 5 seconds, enriched fields progressively appear on each row:
  - A 4px colored left border (red / amber / blue / gray).
  - A small chip under the subject showing the recommended action (e.g., "Draft reply," "Archive," "Unsubscribe").
  - A dim one-sentence "why" line below the snippet.
  - A tiny effort estimate on the right ("1 min" / "5 min" / "no action").

**Network tab**:
- One `POST /api/ai-triage` call with the current page of thread ids.
- Response contains `enrichments[]` with priority, recommendedAction, whyItMatters, effortMinutes, bucket for each enriched thread.

**Pass if**: every thread in the first visible page has enriched fields within 5 seconds, the list was interactive within 1 second, rows do not reflow when enrichment fills in.

### Step 1.2 — Warm cache, reopen

1. Navigate away (click Dashboard in the rail).
2. Within the same session and within 24 hours, click Gmail again.

**Observe**:
- The thread list renders **already enriched** on first paint. No visible delay between list appearance and enrichment fields.

**Network tab**:
- One `POST /api/ai-triage` call that resolves in <100 ms.
- Response shows `cacheStats.hits === threads.length`, `cacheStats.misses === 0`.

**Pass if**: enriched rows appear without any progressive fill-in; the server log shows `cacheHitRate: 1.0` in the `gmail_enrichment_batch` event.

### Step 1.3 — Partial failure (simulated)

1. In a terminal, temporarily break the LLM config:
   ```bash
   mv ~/Library/Application\ Support/FlowSpace/.llm-settings.json ~/Library/Application\ Support/FlowSpace/.llm-settings.json.bak
   ```
2. Delete the cache to force a recompute:
   ```bash
   rm ~/Library/Application\ Support/FlowSpace/.gmail-enrichment.*.json
   ```
3. Reload the Gmail tab.

**Observe**:
- The thread list renders plain rows within 1 second.
- No enrichment appears.
- A small unobtrusive banner appears at the top of the Gmail tab: "Smart view unavailable — showing standard inbox."
- The user can still open, archive, search, filter, and bulk-act on threads exactly as in the pre-v1 experience.

**Pass if**: the fallback banner appears within 500 ms of the failure, and no broken/empty states are rendered.

4. Restore the config and reload:
   ```bash
   mv ~/Library/Application\ Support/FlowSpace/.llm-settings.json.bak ~/Library/Application\ Support/FlowSpace/.llm-settings.json
   ```

---

## 2. User Story 2 — Bucketed view

### Step 2.1 — Four buckets replace three tabs

1. With a populated Gmail tab (warm cache), inspect the header area.

**Observe**:
- The three-tab header (Inbox / Triage / Saved) is **gone**.
- In its place, four bucket sections are rendered as a single scrollable list:
  - **Needs reply** (expanded, with thread count)
  - **Waiting on others** (expanded, with thread count)
  - **Quick wins** (expanded, with thread count)
  - **Reference / FYI** (collapsed by default, with thread count)
- A header dropdown or icon labeled "Saved" is available.
- A small toggle labeled "Show raw inbox" is present.

**Pass if**: all four buckets render with correct counts, Reference/FYI is collapsed, Saved is reachable via dropdown, the three-tab header is not present.

### Step 2.2 — Expand Reference/FYI

1. Click the Reference/FYI section header.

**Observe**:
- The section expands and reveals its threads.
- The chevron icon rotates.
- `aria-expanded` attribute on the header is `true` (inspect in DevTools).

**Pass if**: expansion works smoothly, aria-expanded updates, clicking again collapses.

### Step 2.3 — Show raw inbox

1. Toggle "Show raw inbox".

**Observe**:
- The four bucket headers disappear.
- Threads render as a single chronological list, preserving the enriched row content (priority bar, recommended action chip, why line, effort estimate).
- The "Show raw inbox" toggle now shows an active state.
2. Toggle off.

**Observe**:
- The bucketed view returns with the same expansion state as before (Reference/FYI collapsed if that was its prior state).

**Pass if**: toggling does not lose scroll position or row state, enriched fields persist in both views.

### Step 2.4 — Bucket relocation after action

1. In the Needs reply bucket, note the count.
2. Open any thread from Needs reply and send a reply using the inline composer (see Story 3 below for details).
3. Return to the list.

**Observe**:
- The thread relocates from Needs reply to Waiting on others.
- Both bucket counts update.
- The thread row's recommended action chip changes to something like "Nudge in 3 days" or similar waiting-state action.

**Pass if**: relocation happens on the next list refresh, both counts update, the row does not silently disappear.

### Step 2.5 — Saved preserved

1. Click the Saved header dropdown.

**Observe**:
- The existing Saved view opens (Important / Not important categories as today).
- Previously saved emails are visible and unchanged.
- The unsave action still works.

**Pass if**: Saved behavior is unchanged — no regressions in access or functionality.

---

## 3. User Story 3 — Inline quick actions

### Step 3.1 — Hover reveals bucket-specific actions

1. Hover over a row in **Needs reply**.

**Observe**:
- A row of three buttons appears: `Draft reply`, `Snooze 1 day`, `Delegate`.
- No other bucket's actions are visible.
2. Hover over a row in **Quick wins**.
- Three different buttons: `Archive`, `Unsubscribe`, `Create filter`.
3. Hover over a row in **Waiting on others**.
- Three buttons: `Nudge`, `Remind me in 3 days`, `Mark done`.

**Pass if**: each bucket shows the correct action set; switching buckets swaps the action buttons.

### Step 3.2 — Keyboard access (WCAG 2.1 AA)

1. Click somewhere outside the row list.
2. Press `Tab` repeatedly to walk into the list.

**Observe**:
- Focus lands on the first row. A visible focus ring appears.
- The quick-action buttons become visible when the row is focused (same as on hover).
- Pressing `Tab` again moves focus to the first quick-action button on that row.
- Pressing `Tab` further walks through the other quick-action buttons and then to the next row.
- A screen reader (VoiceOver on macOS: Cmd+F5) announces the row as: "[sender], [subject], [priority] priority, recommended action: [action], effort: [effort], button".

**Pass if**: every row and every quick-action button is reachable via Tab, focus indicators are clearly visible, screen reader announces the row's recommended action as part of the accessible name.

### Step 3.3 — Direct-fire action (Archive with undo)

1. Click `Archive` on a Quick wins row.

**Observe**:
- The row disappears from the list immediately.
- A brief toast appears at the bottom: "Archived. Undo."
- The Quick wins count decrements.
2. Click `Undo`.

**Observe**:
- The row reappears in its original bucket at its original position.
- The count increments back.

**Pass if**: action fires without an approval prompt, undo restores the row correctly.

### Step 3.4 — Approval-required action (Unsubscribe)

1. Click `Unsubscribe` on a newsletter row.

**Observe**:
- An amber approval card slides in beneath the row (or as an inline overlay).
- The card is **visually identical** to the approval cards shown in chat (same amber theme, same layout, same Confirm / Cancel buttons).
- The card shows:
  - Title: "Unsubscribe from [sender]"
  - Summary explaining what will happen
  - A `beforePreview`: "Subscribed"
  - An `afterPreview`: "Unsubscribed"
  - Editable fields if applicable
2. Click `Cancel`.

**Observe**:
- The card dismisses.
- The row remains unchanged.
3. Click `Unsubscribe` again, then `Confirm`.

**Observe**:
- The card dismisses.
- The row disappears from Quick wins.
- A success toast appears.

**Pass if**: the approval card is the existing chat approval card (no new UI), Cancel leaves the row untouched, Confirm executes the action.

### Step 3.5 — Inline draft reply

1. Click `Draft reply` on a Needs reply row.

**Observe**:
- A draft is computed (spinner on the button briefly, ≤3s).
- The inline reply composer (`InlineReplyCompose.tsx`) appears directly beneath the row.
- The composer is **visually identical** to the one used in the thread reader today.
- The textarea is pre-populated with the generated draft.
- The user can edit the draft, click Send, and the reply is sent.
- After Send, the composer collapses and the row relocates to Waiting on others.

**Pass if**: no chat opens, the composer is the existing component, Send works end-to-end.

### Step 3.6 — Remind me in 3 days

1. Click `Remind me in 3 days` on a Waiting row.

**Observe**:
- A toast appears: "Reminder set for [date]."
- A small "Reminder set" chip appears on the row.
- Opening the FollowupPanel (dashboard) shows the new reminder entry linked to this thread.

**Pass if**: the entry is visible in both the Gmail tab row and the follow-up surface.

---

## 4. User Story 4 — Thread reader decision header

### Step 4.1 — Open a thread, decision header appears

1. Click any thread with at least 3 messages.

**Observe**:
- The thread body renders **immediately** — all messages visible, scrollable.
- **Above** the message chain, a decision header renders a skeleton (loading shimmer) for ~1–3 seconds.
- The skeleton resolves into:
  - A one-sentence summary ("AMD recruiter asking for availability next week.")
  - A specific recommended action ("Send Tue 2pm or Thu 10am as slots — both free on your calendar.")
  - 2–4 context chips ("Replied Apr 8", "Last message 2h ago", "Thread active 11 days")
  - An action button row: `Draft reply`, `Pick times`, `Decline`, `Delegate`, `Save to Drive`

**Pass if**: the body renders first, the header resolves within 5 seconds, the summary is one sentence, the recommended action names at least one concrete entity (specific per FR-019a), action buttons are rendered.

### Step 4.2 — Cache hit on reopen

1. Click Back (or navigate away and back to the same thread).

**Observe**:
- The decision header appears **immediately**, no skeleton.

**Pass if**: the header is cached per-session; server log shows `cacheHit: true` in the `thread_brief_complete` event.

### Step 4.3 — Pick times

1. Click the `Pick times` action button in the decision header.

**Observe**:
- An inline mini-calendar slides in (or expands beneath the header).
- It shows a 7-day grid of free slot chips drawn from the user's primary calendar.
- Each chip is labeled "Tue Apr 14, 2:00 PM – 3:00 PM" or similar.
- Clicking a chip appends the selected slot to a draft reply (opens the inline composer with the times pre-filled).

**Pass if**: the calendar response is under 3 seconds (SC-009), slots are specific to the user's actual free time, clicking a slot drafts a reply with the times.

### Step 4.4 — Pick times with no slots available

1. Block every free slot in the next 7 days in Google Calendar.
2. Reopen the thread and click `Pick times`.

**Observe**:
- The mini-calendar shows a helpful message: "No free slots in the next week — offer 'next Monday or later'?" (matching the edge case in spec.md).
- The user is not blocked — they can still draft a manual reply.

**Pass if**: no broken/empty grid, copy matches the spec edge case.

### Step 4.5 — Fallback on brief failure

1. Break the LLM config again (see Step 1.3).
2. Open a thread.

**Observe**:
- The message chain renders immediately.
- The decision header shows a minimal fallback: a single `Draft reply` button plus maybe one deterministic context chip (e.g., "Last message 2h ago" — derived from metadata, not the LLM).
- No summary, no recommended action.
- The user can still read and act on the thread.

**Pass if**: the header never blocks the body, the fallback is minimal but usable, restoring the LLM config allows the brief to resume on the next thread open.

---

## 5. Regression checks (SC-010)

These verify that existing Gmail tab functionality is untouched.

### 5.1 — Search

1. Type a query in the search box.

**Pass if**: search works as before, results filter the bucketed list (or the raw inbox if toggled), no broken state.

### 5.2 — Label filter

1. Select a label from the label dropdown.

**Pass if**: the list filters to threads with that label, buckets recompute, enrichment re-fetches if needed.

### 5.3 — Bulk action bar

1. Select multiple threads (checkboxes).
2. Use the bulk action bar (Archive all, Mark read, etc.).

**Pass if**: bulk actions work across buckets, selection persists across bucket sections, undo works.

### 5.4 — Pagination

1. Scroll to the bottom of the list.

**Pass if**: the "Load more" button loads the next page of threads; enrichment fires for the new page only.

### 5.5 — Undo

1. Perform any bulk action, then click the undo toast.

**Pass if**: the action is reversed via `/api/inbox-actions/:auditId/undo`, threads return to their prior state and bucket assignment.

---

## 6. Observability verification

After running the above flow, inspect the server logs.

**Expected log events** (grep for the `event` field in the server output):

- **`gmail_enrichment_batch`** — one per `/api/ai-triage` call. Fields: `batchSize`, `successCount`, `successRate`, `cacheHits`, `cacheHitRate`, `durationMs`, `requestId`, `accountKey`, `timestamp`.
- **`thread_brief_complete`** — one per `/api/thread-brief/:id` call. Fields: `threadId`, `success`, `isFallback`, `cacheHit`, `durationMs`, `accountKey`, `timestamp`.
- **`gmail_tab_fallback`** — one whenever the frontend triggers the fallback banner. Sent via `POST /api/telemetry/fallback`. Fields: `reason`, `accountKey`.
- **`gmail_tab_interactive`** — one per Gmail tab open. Sent via `POST /api/telemetry/gmail-interactive`. Fields: `msFromOpen`, `threadCount`.

**Pass if**: every user action produces the expected log event, all fields are populated, JSON parses cleanly.

---

## 7. Accessibility audit (automated)

Run the jest-axe integration tests:

```bash
npx vitest run src/components/gmail/__tests__/
```

**Pass if**: all new component tests pass, including the axe assertions. Zero accessibility violations reported for `EnrichedThreadRow`, `BucketedThreadList`, `QuickActionMenu`, `ThreadDecisionHeader`, `PickTimesInlineCalendar`.

---

## 8. Sign-off checklist

Before merging v1:

- [ ] All four user stories pass their manual acceptance scenarios
- [ ] All regression checks (Section 5) pass
- [ ] All 10 success criteria in spec.md are observable during manual test
- [ ] Observability log events (Section 6) appear in server logs
- [ ] jest-axe accessibility tests pass
- [ ] No new approval UI introduced (spot-check: compare the Unsubscribe card against the chat approval card — they must look identical)
- [ ] Graceful fallback works end-to-end (break LLM config, verify banner + three-tab fallback, restore config)
- [ ] `.gmail-enrichment.*.json` file exists in DATA_DIR after a Gmail tab open, with valid JSON
- [ ] Server restart clears the thread-brief cache (second restart + same thread → cache miss on first open)
- [ ] Pick times returns within 3 seconds for a calendar with up to 50 events
- [ ] The decision header never blocks the message body from rendering
