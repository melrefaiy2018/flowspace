# Feature Specification: Nail the Briefing

**Feature Branch**: `002-briefing-redesign`
**Created**: 2026-03-07
**Status**: Draft
**Input**: Phase 1 roadmap — fix AI briefing reliability, smart prioritization, pre-triaged inbox, contextual Drive, clean assistant output

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable AI Briefing on Every Load (Priority: P1)

When the user opens FlowSpace, the AI briefing loads reliably every time. If the AI is temporarily unavailable, the app falls back gracefully to raw data panels without showing a broken state. Briefing errors are retried with exponential backoff before giving up.

**Why this priority**: The briefing IS the product. Without it, FlowSpace is just a worse Gmail + Calendar split screen. Users who see errors on first load will not come back.

**Independent Test**: Open the app 10 times — briefing should render 10/10 times. Disconnect GLM API — fallback panels should appear within 3s, not a blank screen.

**Acceptance Scenarios**:

1. **Given** the user opens FlowSpace with valid auth and GLM_API_KEY configured, **When** the app loads, **Then** the AI briefing renders within 8 seconds with greeting, summary, attention items, inbox triage, and calendar
2. **Given** the GLM API returns a 500 error, **When** the briefing request fails, **Then** the system retries once after 2s, and if still failing, shows fallback panels (raw calendar + inbox) with a subtle "AI briefing unavailable" indicator
3. **Given** the GLM API returns malformed JSON, **When** the response parsing fails, **Then** the system treats it as a failure and retries/falls back gracefully
4. **Given** the briefing was previously cached (10-min TTL), **When** the user reopens the app within 10 minutes, **Then** the cached briefing renders instantly

---

### User Story 2 - Smart Calendar Prioritization (Priority: P1)

The "Your Day" panel shows a maximum of 5-8 items, grouped into meaningful categories: "Needs prep" (meetings with agendas/attendees requiring review), "Just show up" (casual/optional meetings), and "FYI" (all-hands, company updates). Events are not a flat chronological list.

**Why this priority**: A wall of 20+ events is useless. Users need to know which 3 meetings actually matter and need preparation.

**Independent Test**: Load briefing with 15+ calendar events — panel should show max 8 items with clear priority grouping, not a scrollable list.

**Acceptance Scenarios**:

1. **Given** the user has 15 events today, **When** the briefing renders, **Then** the "Your Day" panel shows max 8 events grouped by priority: "Needs prep" (top), "Just show up" (middle), "FYI" (collapsed)
2. **Given** an event has 3+ attendees and no linked notes doc, **When** the AI analyzes the calendar, **Then** the event is categorized as "Needs prep" with a prep_note explaining why
3. **Given** an event is an all-hands or recurring standup, **When** the AI categorizes it, **Then** it appears in "FYI" or "Just show up" (not "Needs prep")
4. **Given** the user has 3 or fewer events, **When** the briefing renders, **Then** all events are shown without grouping (no need to collapse)

---

### User Story 3 - Pre-triaged Inbox as Default State (Priority: P1)

The inbox triage is the default view for email — not "Summarize all unread" as a click action. On load, the briefing shows emails already bucketed into "Action required," "Review," and "Low priority." The user sees their triaged inbox without any interaction.

**Why this priority**: Email triage is the highest-value daily action. Making users click "Summarize unread" defeats the purpose of an AI assistant.

**Independent Test**: Open the app with 20 unread emails — inbox triage should be pre-populated with categorized emails, zero clicks required.

**Acceptance Scenarios**:

1. **Given** the user has 20 unread emails, **When** the briefing loads, **Then** the InboxTriage panel shows all emails categorized into needs_reply, fyi_only, and can_ignore sections
2. **Given** the "needs_reply" section has 3 emails, **When** the briefing renders, **Then** the section is open by default with Draft Reply buttons visible
3. **Given** the inbox has 0 emails needing reply, **When** the briefing renders, **Then** the "Needs your reply" section shows "No emails in this category" and the FYI section is expanded instead
4. **Given** the AI fails to triage an email (missing thread_id), **When** the briefing renders, **Then** the email still appears in can_ignore with a "(could not categorize)" note

---

### User Story 4 - Contextual Drive Files (Priority: P2)

Drive files are only surfaced when they are linked to today's meetings or flagged by the AI as relevant. The standalone "Recent Files" panel is removed from the default view. Files appear inline within meeting prep cards or attention items.

**Why this priority**: A generic "recent files" list adds noise. Files only matter in context of meetings or tasks.

**Independent Test**: Load briefing with meetings that have linked Drive docs — those docs should appear as prep materials inside the meeting card. The "Recent Files" panel should not appear.

**Acceptance Scenarios**:

1. **Given** a meeting has a linked Google Doc (meeting notes), **When** the briefing renders the YourDay panel, **Then** the event card shows a "Meeting notes" link to that doc
2. **Given** a Drive file was shared in the last 48h and is linked to an upcoming meeting attendee, **When** the AI generates the briefing, **Then** the file appears as an attention item ("Review shared file before 2pm meeting")
3. **Given** no Drive files are relevant to today's meetings or flagged, **When** the briefing renders, **Then** no file panel or file cards are shown
4. **Given** the user navigates to the chat and asks "List my recent files", **When** the chat responds, **Then** all recent files are available (not removed, just hidden from briefing)

---

### User Story 5 - Clean Assistant Output (Priority: P2)

The assistant panel shows briefing results and conversational responses only. Tool execution logs ("Searching Gmail — COMPLETED", "Reading calendar — COMPLETED") are hidden from the user. A compact progress indicator replaces the verbose tool timeline.

**Why this priority**: Debug logs destroy the polished feel. Users don't care that the AI searched Gmail — they care about the result.

**Independent Test**: Send "Summarize my unread emails" in chat — see a clean summary response without tool execution timeline entries.

**Acceptance Scenarios**:

1. **Given** the user sends a chat message that triggers tool calls, **When** the assistant responds, **Then** the tool timeline is hidden and replaced by a compact "Working..." indicator with a spinner
2. **Given** the assistant finishes a tool-calling loop, **When** the final response renders, **Then** only the markdown content and structured blocks (lists, cards) are visible
3. **Given** a tool call fails during the response, **When** the error occurs, **Then** the user sees a brief error message ("Couldn't access Gmail — please retry") without the full tool event log
4. **Given** the user is a developer and wants debug info, **When** they click an expand caret on the assistant message, **Then** the full tool timeline is revealed (optional, hidden by default)

---

### Edge Cases

- What happens when the user has 0 unread emails and 0 calendar events? (Show "Clear day ahead" state)
- How does the system handle a briefing that takes >10 seconds to generate? (Show skeleton + progress, don't time out prematurely)
- What if the GLM API rate-limits the briefing request? (Respect 429, retry with backoff, fall back after 2 attempts)
- What happens when the briefing cache expires during a session? (Silent background refresh, no UI flash)
- How do we handle events that span midnight? (Include in today's briefing if start or end is today)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate an AI briefing on every app load with <8s latency (p95)
- **FR-002**: System MUST retry failed briefing requests once with 2s delay before falling back
- **FR-003**: System MUST categorize calendar events into "needs_prep", "show_up", "fyi" groups
- **FR-004**: System MUST limit the YourDay panel to 8 events maximum, prioritized by prep need
- **FR-005**: System MUST pre-triage inbox into needs_reply, fyi_only, can_ignore on initial load (no click required)
- **FR-006**: System MUST surface Drive files only when contextually linked to today's events or AI-flagged
- **FR-007**: System MUST NOT show the RecentFiles panel in the default briefing view
- **FR-008**: System MUST hide tool execution logs from the chat assistant panel by default
- **FR-009**: System MUST show a compact progress indicator during tool-calling (spinner + "Working...")
- **FR-010**: System MUST preserve the ability to expand tool logs for debugging (hidden by default)
- **FR-011**: System MUST cache briefings for 10 minutes (existing behavior, preserved)
- **FR-012**: System MUST silently refresh briefing every 30 minutes without UI flash

### Key Entities

- **Briefing**: The AI-generated daily overview — greeting, summary, attention_items, inbox_triage, day_at_a_glance, followups
- **DayEvent**: Calendar event with new `priority_group` field: "needs_prep" | "show_up" | "fyi"
- **AttentionItem**: Priority card — existing type with optional linked Drive file context
- **InboxTriageItem**: Email bucket item — existing type, now the default view (not behind a click)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Briefing renders on 95%+ of app loads (measured by error rate in console)
- **SC-002**: YourDay panel shows max 8 items regardless of calendar event count
- **SC-003**: Inbox triage is visible on initial load with zero user interaction
- **SC-004**: No "Recent Files" panel in default briefing view
- **SC-005**: Chat responses show no tool timeline by default (only content + blocks)
- **SC-006**: Fallback panels render within 3s when AI is unavailable
