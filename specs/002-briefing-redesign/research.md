# Research: Nail the Briefing

**Feature**: `002-briefing-redesign`
**Date**: 2026-03-07

## Research Topics

### 1. Briefing Reliability & Error Recovery

**Decision**: Implement retry-with-backoff in both backend and frontend, plus structured fallback hierarchy.

**Rationale**:
- The current `/api/briefing` endpoint has a single try-catch with no retry logic. If GLM returns a 500 or malformed JSON, the frontend gets `{ error: 'briefing_unavailable' }` immediately.
- The `useBriefing` hook sets `error: true` and shows a static fallback — but the fallback is a completely different UI (TodayPanel + InboxPreview + RecentFiles) that shares no structure with the briefing view.

**Implementation approach**:
1. **Backend retry** (server.ts): Wrap the GLM API call in a retry loop (max 2 attempts, 2s delay). Only retry on 5xx/network errors, not on 4xx or auth failures.
2. **JSON extraction hardening**: The current regex `/\{[\s\S]*\}/` is fragile. Add a secondary extraction attempt with `JSON.parse()` on the raw response if regex fails.
3. **Frontend retry** (useBriefing.ts): If the backend returns `error`, retry once after 3s before showing fallback.
4. **Fallback hierarchy**: Instead of showing completely different panels, show the briefing layout with raw data injected (calendar events as-is in YourDay, emails as-is in InboxTriage, no AI summary).

**Alternatives considered**:
- Client-side AI fallback (call a different model): Rejected — adds complexity, latency, and a second API key requirement.
- Aggressive caching (1-hour TTL): Rejected — stale briefings are worse than raw data fallbacks.

---

### 2. Calendar Event Prioritization

**Decision**: Extend the BRIEFING_SYSTEM_PROMPT to return a `priority_group` field per event, with backend post-processing to enforce the 8-event cap.

**Rationale**:
- The AI already generates `day_at_a_glance` with `prep_note`. We can extend this to include a `priority_group` classification without a separate API call.
- Grouping heuristics can be partially rule-based (as backup to AI):
  - "needs_prep": >3 attendees, no linked doc, external attendees, 1-on-1 with manager
  - "show_up": recurring standups, <3 attendees, internal-only
  - "fyi": all-hands, company meetings, optional attendance

**Implementation approach**:
1. **Prompt update**: Add `priority_group: "needs_prep" | "show_up" | "fyi"` to the `day_at_a_glance` schema in the system prompt. Add rules: max 3 "needs_prep", max 3 "show_up", rest in "fyi".
2. **Backend enforcement**: After AI response, cap total events at 8. If AI returns more, truncate "fyi" first, then "show_up".
3. **Frontend rendering**: Group events by `priority_group` in YourDayPanel with section headers.

**Alternatives considered**:
- Pure rule-based classification (no AI): Rejected — can't detect context like "this is a client pitch" vs "team lunch."
- Separate classification API call: Rejected — doubles latency and API cost.
- Client-side classification: Rejected — frontend doesn't have attendee context or email threads.

---

### 3. Inbox Triage as Default State

**Decision**: Keep the existing InboxTriage component as the primary email view. Remove the "Summarize all unread" click-to-trigger pattern.

**Rationale**:
- The current `InboxTriage` component already renders bucketed emails (needs_reply, fyi_only, can_ignore) from the briefing response. The issue is that this only appears when the AI briefing succeeds.
- In fallback mode, the app shows `InboxPreview` (a flat list of recent emails) — this should be replaced with a client-side approximation of triage.

**Implementation approach**:
1. **Default state**: InboxTriage is always rendered in the briefing layout, even in fallback mode.
2. **Fallback triage**: When AI is unavailable, use simple heuristics to bucket emails:
   - `needs_reply`: emails where user is in To: (not CC/BCC) and sender is a human (no `noreply@`)
   - `fyi_only`: emails where user is in CC
   - `can_ignore`: newsletters, notifications, automated emails
3. **Remove InboxPreview from default view**: Keep the component for potential reuse but don't render in the main briefing.

**Alternatives considered**:
- Always require AI for triage: Rejected — AI unavailability shouldn't break the core feature.
- Show flat email list as default: Rejected — defeats the purpose of FlowSpace vs plain Gmail.

---

### 4. Contextual Drive Files

**Decision**: Remove standalone RecentFiles panel from briefing. Surface Drive files inline in meeting prep cards and attention items only.

**Rationale**:
- The current briefing prompt already fetches "recently shared Drive files (last 48h)" and can link them to meetings via attendee overlap or file names matching meeting titles.
- The AI already generates attention_items of type `drive_file` — these are the only files that should appear in the briefing.

**Implementation approach**:
1. **Prompt update**: Add instruction: "Only include drive_file attention items when the file is directly relevant to today's events or requires action. Do not list all shared files."
2. **YourDay enhancement**: If the AI detects a Drive doc linked to a meeting (via doc URL in calendar event or shared by an attendee), include a `linked_docs` array in the event.
3. **Remove RecentFiles rendering**: In App.tsx, remove `<RecentFiles>` from both briefing and fallback views. Keep the component and the `/api/drive/recent` endpoint for chat access.

**Alternatives considered**:
- Show files in a separate "Relevant docs" section: Rejected — adds another panel, goes against the "ruthless prioritization" goal.
- Remove the Drive data source from briefing entirely: Rejected — drive_file attention items are valuable when contextual.

---

### 5. Clean Assistant Output (Hide Tool Logs)

**Decision**: Hide ToolTimeline by default with an optional expand toggle. Replace with a compact "Working..." indicator during tool execution.

**Rationale**:
- The current `ChatThread.tsx` renders `ToolTimeline` for every assistant message that has `toolEvents`. This shows "Searching Gmail — COMPLETED", "Reading calendar — COMPLETED" etc. — useful for debugging but noisy for daily use.
- The `ToolTimeline` component already has all the event data — we just need to gate its visibility.

**Implementation approach**:
1. **Default hidden**: Wrap `ToolTimeline` in a collapsible that is closed by default.
2. **Compact indicator**: When `toolEvents` exist and `status === 'streaming'`, show a single-line "Working..." with spinner icon. When complete, show nothing (just the content).
3. **Expand toggle**: Small "Show details" link below the assistant message that reveals the full ToolTimeline.
4. **Error surfacing**: If any tool event has `status === 'error'`, surface a brief inline error ("Couldn't access Gmail") without the full timeline.

**Alternatives considered**:
- Remove ToolTimeline entirely: Rejected — debugging value is real, just needs to be optional.
- Settings toggle for verbose mode: Rejected — overengineered for current user base.
- Show tool names only (no status): Rejected — still noisy with 3-5 tool calls per response.

---

## Technology Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Retry strategy | Backend: 1 retry, 2s delay. Frontend: 1 retry, 3s delay | Simple, avoids cascading retries, total max wait ~13s |
| Calendar grouping | AI-classified with backend cap enforcement | AI understands context; backend enforces UX constraints |
| Fallback triage | Simple heuristic (To/CC/noreply) | Works without AI, covers 80% of cases |
| Drive context | Inline in meeting cards + attention items | Files only matter in context |
| Tool log visibility | Hidden by default, expandable | Clean UX with debug escape hatch |
