# Gmail Tab Enhancement Plan

Companion document to `flowspace-product-redesign.md`. That plan demotes Gmail from a destination to a utility layer under `Workspace`. This plan answers the follow-up question: **when a user does open the Gmail tab, how does it feel like part of a work-execution product instead of a Gmail skin?**

## Framing

Even as a utility, the Gmail tab is still visited — to verify something is there, search history, or work through a backlog. Today it is a competent but inert mailbox clone. Meanwhile, FlowSpace has a lot of intelligence that never reaches this surface.

**Enhancement thesis:** don't build new features for the Gmail tab. **Connect the intelligence that already exists** (`InboxTriage`, `AttentionPanel`, `FollowupPanel`, agent tools, draft/reply flows) so the Gmail tab becomes a tactile "view into my mail through FlowSpace's eyes" instead of a second Gmail client.

## Current state (code-grounded)

The Gmail tab today:

| Component | Path | Lines | What it does |
|---|---|---|---|
| Page | `src/pages/GmailPage.tsx` | 464 | Split pane, 3 tabs (inbox / triage / saved), search, label filter, bulk action bar |
| Hook | `src/hooks/useGmailPage.ts` | 249 | Loads threads/labels, pagination, bulk actions, undo |
| Row list | `src/components/gmail/ThreadList.tsx` | 155 | Sender avatar, subject, snippet, date, unread dot, attachment icon |
| Reader | `src/components/gmail/ThreadReader.tsx` | 354 | Message cards with HTML iframe body, attachments, reply composer, Archive/Trash |
| Triage view | `src/components/gmail/GmailTriageView.tsx` | 457 | 4 heuristic buckets (urgent / needs_attention / informational / low_priority) + custom categories |
| Saved list | `src/components/gmail/SavedThreadList.tsx` | 133 | FlowSpace-specific "Important / Not important" labels, disconnected from Gmail stars |
| Inline reply | `src/components/gmail/InlineReplyCompose.tsx` | 151 | Draft loading, text area, send |

**Backend endpoints:** `/api/gmail/labels` (1494), `/api/gmail/threads` (1511), `/api/gmail/thread/:threadId` (1578), `/api/inbox-actions` (1761), `/api/inbox-actions/:auditId/undo` (1826), `/api/ai-triage` (3516). All in `server.ts`.

## Intelligence that exists but is NOT wired into the Gmail tab

- **`InboxTriage`** (`src/components/InboxTriage.tsx`) — 4 action-oriented buckets (needs_reply / needs_input / fyi_only / can_ignore) + action chips (draft_reply, accept_meeting, suggest_time, create_task, approve_request). Lives only on the dashboard briefing.
- **`AttentionPanel`** (`src/components/AttentionPanel.tsx`) — priority-sorted cards with "why it matters" + recommended actions. Dashboard only.
- **`FollowupPanel`** (`src/components/FollowupPanel.tsx`) — due/overdue tracking with snooze/complete. Dashboard only.
- **Agent tool suite** — `gmail_triage`, `search_emails`, `archive_email_threads`, `mark_threads_read`, `apply_label_to_threads`, `unsubscribe_from_sender`, `create_gmail_filter`, `email_to_task`, `save_email_to_doc`. Reachable only through chat.
- **Thread-level agent actions** (`src/agent/gmail-agent.ts`) — ask_agent, add_to_calendar, draft_follow_up, create_task. Hidden behind an `onAgentAction` callback.
- **Draft / send reply flow** — `/api/draft-reply` + `/api/send-reply` exist and work. Partially wired into `ThreadReader`.

---

## Nine Enhancements, Ranked by Leverage

### 1. Action-first row model

**Problem.** Today's row shows sender / subject / snippet / date — the Gmail format. It tells the user what the email is but not what to do with it.

**Change.** Enrich each row with four FlowSpace-native fields:
- **Priority bar** (4px left edge) — red (urgent) / amber (needs action) / blue (waiting) / gray (FYI)
- **Recommended action chip** — `Draft reply` / `Archive` / `Create task` / `Save to Drive` / `Unsubscribe` (vocabulary from `InboxTriage.tsx`)
- **"Why" line** (one sentence, dimmer than snippet) — "External reply — you asked on Apr 8" / "Receipt, no action needed"
- **Effort estimate** (right side, tiny) — "1 min" / "5 min" / "no action"

**Reuse.** Extend `POST /api/ai-triage` (`server.ts:3516`) so its return shape includes `recommendedAction`, `whyItMatters`, `estimatedEffortMinutes`. Same LLM call, prompt template grows by a few fields.

**Cache.** 24h rolling cache keyed by `threadId + lastMessageId`, persisted to `.gmail-enrichment.json` in DATA_DIR (same pattern as `.followup-state.json`).

**Files to touch.**
- `src/components/gmail/ThreadList.tsx` (155) — replace row body
- `src/components/gmail/EnrichedThreadRow.tsx` — new
- `src/hooks/useGmailPage.ts:74-91` — parallel-fetch enrichment
- `src/services/api.ts` — add `getThreadEnrichments(threadIds[])`
- `server.ts` near 3516 — extend endpoint + cache
- `src/agent/tools.ts` — extract the `gmail_triage` prompt so both the tool and the endpoint share it

**Win.** Every row answers "what is this and what should I do" at a glance.

---

### 2. Merge the three tabs into one triage-led view

**Problem.** Inbox / Triage / Saved are three views of the same data. Users have to know to click "Triage" — most won't.

**Change.** Replace the three-tab header with action-bucket sections in a single scrollable list:
- **Needs reply** (you owe a response)
- **Waiting on others** (you're blocked)
- **Quick wins** (archivable, 1-click)
- **Reference / FYI** (collapsed by default)

This is the `InboxTriage` bucket model applied to the Gmail tab. "All mail" becomes a subtle toggle at the top. Saved moves out of the tab bar into a header dropdown or left-rail chip.

**Reuse.** `src/lib/triage.ts` already produces buckets — swap its 4 heuristic labels for 4 action labels. `GmailTriageView.tsx` already has collapsible bucket headers — lift them into `GmailPage`.

**Files to touch.**
- `src/pages/GmailPage.tsx:15, 38-52, 164-168` — remove tab state, bucketed list as default
- `src/components/gmail/GmailTriageView.tsx` — becomes default
- `src/lib/triage.ts` — relabel buckets, use enrichment from #1
- `src/components/gmail/SavedThreadList.tsx` — relocate

**Win.** User opens Gmail and sees "4 things need my reply, 2 quick wins, 11 you can ignore" instead of a chronological firehose.

---

### 3. Inline quick actions from the agent tool suite

**Problem.** FlowSpace has agent tools for `archive_email_threads`, `unsubscribe_from_sender`, `create_gmail_filter`, `email_to_task`, `save_email_to_doc` — but the Gmail tab only offers Archive / Trash / Mark read / Mute.

**Change.** Per-row quick actions on hover (desktop) or swipe (mobile):
- `needs_reply` row: `[Draft reply]` `[Snooze 1d]` `[Delegate]`
- `quick_wins` row: `[Archive]` `[Unsubscribe]` `[Create filter]`
- `waiting` row: `[Nudge]` `[Remind me in 3d]` `[Mark done]`

Read-only / reversible actions fire directly. Write actions route through the approval flow in `ChatThread.tsx:578-701`. `Draft reply` and `Nudge` use `draftReply` API and render inline — no chat required.

**Reuse.**
- Tool handlers in `src/agent/tools.ts` (~1427-1476 for write tools)
- Approval card rendering in `src/components/ChatThread.tsx:578-701`
- Inline reply composer `src/components/gmail/InlineReplyCompose.tsx`
- `performBulkAction()` in `useGmailPage.ts`

**Files to touch.**
- `src/components/gmail/EnrichedThreadRow.tsx` (new, from #1) — hover action row
- `src/components/gmail/ThreadReader.tsx:198+` — expand message-level toolbar with the same verb set
- `src/hooks/useGmailPage.ts` — per-thread action dispatcher

**Win.** Users never have to open chat for routine inbox actions.

---

### 4. Unify "Saved" with commitments and follow-ups

**Problem.** Saved (important / not_important) is a bespoke filing system disconnected from Gmail stars, `FollowupPanel`, and the Waiting screen in the product redesign.

**Change.** Rename Saved → **Tracked**. Single source of truth for "threads I want to keep my eye on." A tracked thread can have any of:
- **Follow up by {date}** — feeds `FollowupPanel` data model
- **Waiting on {person}** — new state, seeds the future Waiting screen
- **Reference** — equivalent of today's saved+important

Clicking `[Track]` opens a small popover: "When should I remind you?" / "Who's this waiting on?" / "Just save for reference."

**Reuse.** Extend `FollowupPanel` + `.followup-state.json` with `relatedThreadId` and `status: 'followup' | 'waiting' | 'reference'`. The Gmail Tracked view is a filter over that store.

**Files to touch.**
- `src/components/gmail/SavedThreadList.tsx` — replace two-category with tracked layout
- `src/components/FollowupPanel.tsx` — accept thread-linked items
- `server.ts` — extend `/api/followups` to accept `relatedThreadId`
- One-shot migration: transform existing `savedEmails` array in `App.tsx` into the new followup store

**Win.** One mental model for "things I want to remember" across the whole product. The Waiting screen (Phase 2 of the product redesign) falls out for free.

---

### 5. Thread reader becomes a decision surface

**Problem.** The reader renders messages faithfully but gives the user no help deciding what to do.

**Change.** Add a **decision header** above the message list, always present:
- **One-sentence summary** ("AMD recruiter asking for availability next week")
- **Recommended action** ("Send 3 time slots — Tues/Thu afternoons, Wed morning are free")
- **Context chips** — "Replied Apr 8", "Last message 2h ago", "Thread active 11 days"
- **Action row** — `[Draft reply]` `[Pick times]` `[Decline]` `[Delegate]` `[Save to Drive]`

`Pick times` opens an inline mini calendar via `gcal_find_my_free_time` / `calendar_agenda` tooling so the user composes a reply without leaving the thread.

**Reuse.**
- `/api/draft-reply` already returns a structured draft
- `src/agent/gmail-agent.ts` defines 4 thread-level actions — surface them as first-class buttons
- New `/api/thread-brief/:threadId` endpoint reusing `summarizeThread` prompt

**Files to touch.**
- `src/components/gmail/ThreadReader.tsx:1-354` — add `ThreadDecisionHeader` at top
- `src/components/gmail/ThreadDecisionHeader.tsx` — new
- `src/agent/gmail-agent.ts` — expose the 4 actions as typed object
- `server.ts` — add `/api/thread-brief/:threadId` (cached)

**Win.** Opening a thread immediately tells you what it's about and what to do. Act without reading the whole chain.

---

### 6. "Scan for missed commitments" button

**Problem.** Users don't know what they've promised and forgotten. Gmail doesn't help; FlowSpace has the ingredients but hasn't assembled them.

**Change.** Header button: `🔍 Scan for missed commitments`. One click runs a server-side pass that:
1. Pulls last 14 days of sent mail
2. Asks the LLM to extract each commitment ("I'll send you X by Tuesday")
3. Cross-references the inbox for a completion signal
4. Returns commitments without follow-ups as a card list

Results land in the `Tracked` store from #4 as `waiting` items. User reviews and one-click nudges.

**Reuse.** `search_emails` + `email_to_task` + `src/agent/chat.ts` completion infrastructure. Results reuse `AttentionPanel` card layout.

**Files to touch.**
- `src/pages/GmailPage.tsx` — header button
- `server.ts` — `/api/gmail/scan-commitments`
- `src/agent/commitments.ts` — new extraction + cross-reference logic

**Win.** The "aha" feature. No email client can tell you what you forgot; FlowSpace can. Also a natural growth loop into the Waiting screen.

---

### 7. Semantic search

**Problem.** Search calls Gmail-native `q=` keyword matching. "Emails about the AMD offer" returns nothing if "AMD" isn't literally in the thread.

**Change.** Two-pass pipeline:
1. Gmail `q=` with raw query (zero-latency)
2. In parallel, LLM rewrite expanding to Gmail operators ("emails about the AMD offer" → `from:amd.com OR from:careers@amd.com newer_than:60d`) and runs a second search
3. Merge + dedupe

**Reuse.** `search_emails` tool already does this for the agent — lift the same prompt.

**Files to touch.**
- `src/hooks/useGmailPage.ts:74-91` — adjust search path
- `server.ts` — `/api/gmail/semantic-search`
- Debounce LLM pass (300ms)

**Win.** Search finally works the way users expect.

---

### 8. "Clean out 20 minutes" focus mode

**Problem.** Users accumulate 100s of low-priority messages and never triage them.

**Change.** Header button: `🧹 Clean out 20 minutes`. Launches focus mode:
1. Enters `quick_wins` bucket
2. One thread at a time, full-width
3. 4 keys: `[a]rchive`, `[u]nsubscribe`, `[k]eep`, `[d]elegate`
4. Burns through the list like a Tinder for email
5. Stops at 20 min or empty
6. Completion summary: "Archived 47, unsubscribed from 3, kept 8 for later"

**Reuse.** `archive_email_threads`, `unsubscribe_from_sender`, `create_gmail_filter`. Undo via `/api/inbox-actions/:auditId/undo` (`server.ts:1826`).

**Files to touch.**
- `src/pages/GmailPage.tsx` — button
- `src/components/gmail/CleanoutMode.tsx` — new full-screen modal
- Keyboard handler in `useGmailPage.ts`

**Win.** Gamified cleanup loop. The kind of feature that survives Gmail demotion because it's what raw Gmail is worst at.

---

### 9. Demote Gmail in the nav, preserve access via shortcuts

**Problem.** The product redesign plan wants Gmail demoted from top nav. Dropping the rail entry will frustrate muscle memory.

**Change.**
- Remove `Gmail` / `Drive` / `Calendar` / `Tasks` from top-level rail
- Add a single `Workspace` rail entry that expands into the four
- Keyboard shortcut: `g m` → Gmail, `g d` → Drive, etc. (Gmail / Linear convention)
- Extend chat-to-nav router (`App.tsx:1034`) so users can type "open mail" in chat

**Files to touch.**
- `src/components/AppRail.tsx:200-250` — collapse into `Workspace`
- `src/App.tsx:1030-1040` — navigation router
- `src/hooks/useKeyboardNav.ts` — new, two-key chord handler

**Win.** Nav signals "Workspace is secondary" without making it hard to reach.

---

## Prioritization

If only some land, in this order:

1. **#1 Action-first row model** — highest leverage, reuses `/api/ai-triage`, ~1 week, transforms the tab's perceived purpose
2. **#2 Merge tabs into one triage-led view** — depends on #1, ~3 days
3. **#5 Thread reader decision header** — independent, ~3 days, huge per-thread UX win
4. **#3 Inline quick actions** — depends on #1's row model, couple days
5. **#9 Nav demotion** — 1 day, can ship alongside Phase 0 of the product redesign
6. **#4 Unified Tracked store** — bigger lift (migration + backend), prerequisite for Waiting screen in Phase 2
7. **#6 Scan for missed commitments** — the "aha" feature, do once #4 is in place
8. **#7 Semantic search** — quality-of-life, nonblocking
9. **#8 Cleanout mode** — fun, high-delight, low-priority

Items 1–4 together constitute a "v1 of the new Gmail tab" that could ship as a single milestone.

---

## Guiding principles for implementation

- **Reuse over build.** Every enhancement must cite an existing FlowSpace capability it's reusing. No enhancement that adds new infrastructure where an existing tool/hook/endpoint works.
- **Action-first language.** No row, no card, no bucket without a recommended next action visible.
- **Approval flow stays uniform.** All write actions (send, delete, unsubscribe) route through the existing `ChatThread.tsx:578-701` approval cards. Never build a second approval UI.
- **Gmail is secondary.** Every enhancement must leave Gmail feeling like a *view* into work, not the work itself. If an enhancement makes the Gmail tab feel more central, reject it.
- **Progressive disclosure.** Power-user shortcuts (keyboard chords, raw thread view, label filter) stay accessible but not prominent.

---

## Verification checklist

1. **Row enrichment:** open Gmail tab → every row shows priority bar, recommended action, why line, effort estimate. Cold-load latency stays under 1s (enrichment runs in parallel, doesn't block thread list).
2. **Bucketed view:** default Gmail tab view is a single bucketed list (Needs reply / Waiting / Quick wins / Reference), not three tabs. "Show raw inbox" toggle still works.
3. **Quick actions:** hover any row → quick action buttons appear, fire without opening chat for read-only actions, route through approval flow for write actions.
4. **Tracked store unification:** click `[Track]` on a thread → popover with three intents → item appears in `FollowupPanel` and (after Phase 2) the Waiting screen.
5. **Decision header:** open any thread → header shows summary + recommended action + context chips + first-class action row. `Pick times` opens inline mini-calendar.
6. **Commitment scan:** click `Scan for missed commitments` → server pass returns card list → items land in Tracked as `waiting`.
7. **Semantic search:** type "emails about the AMD offer" → relevant results returned even without the literal keyword.
8. **Cleanout mode:** click `Clean out 20 minutes` → full-screen modal, keyboard shortcuts (a/u/k/d) work, completion summary appears.
9. **Nav demotion:** rail shows `Workspace` (not Gmail/Drive/Calendar/Tasks at top level). `g m` keyboard chord jumps to Gmail. Chat "open mail" intent works.
10. **No regressions:** existing bulk actions, undo, label filter, search, pagination all continue to work. Tests for `useGmailPage.ts` and `ThreadList.tsx` still pass.
