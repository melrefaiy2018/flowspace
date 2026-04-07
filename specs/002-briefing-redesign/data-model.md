# Data Model: Nail the Briefing

**Feature**: `002-briefing-redesign`
**Date**: 2026-03-07

## Entity Changes

### DayEvent (Modified)

Existing entity with new `priority_group` field.

```typescript
interface DayEvent {
  time: string;              // "HH:MM" format
  title: string;
  event_id: string;
  attendees: string[];
  has_notes_doc: boolean;
  prep_note: string | null;
  // NEW FIELDS
  priority_group: 'needs_prep' | 'show_up' | 'fyi';
  linked_docs?: LinkedDoc[];  // Drive docs linked to this event
}

interface LinkedDoc {
  name: string;
  url: string;
  type: 'notes' | 'agenda' | 'shared_file';
}
```

**Validation rules**:
- `priority_group` is required (AI must classify every event)
- Backend enforces max 8 events total: max 3 needs_prep, max 3 show_up, remainder fyi (capped at 2)
- `linked_docs` is optional, populated when AI detects relevant Drive files

**Priority classification rules** (embedded in AI prompt):
- `needs_prep`: External attendees, >3 attendees without notes doc, 1-on-1s, events with "review" or "presentation" in title
- `show_up`: Recurring standups/syncs, <3 internal attendees, events with existing notes doc
- `fyi`: All-hands, company meetings, optional events, FYI calendar invites

---

### Briefing (Modified)

Existing entity — no structural changes, but behavioral contract changes.

```typescript
interface Briefing {
  greeting: string;
  summary: string;
  attention_items: AttentionItem[];
  inbox_triage: {
    needs_reply: InboxTriageItem[];
    needs_input: InboxTriageItem[];  // Emails where AI needs user guidance
    fyi_only: InboxTriageItem[];
    can_ignore: InboxTriageItem[];
  };
  day_at_a_glance: DayEvent[];    // Now capped at 8, with priority_group
  followups?: FollowupItem[];
  error?: string;
}
```

**Behavioral changes**:
- `day_at_a_glance` max 8 items (was unlimited)
- `attention_items` only includes `drive_file` type when contextually relevant (not all shared files)
- `inbox_triage` is now the PRIMARY email view, not secondary to briefing

---

### AttentionItem (Unchanged)

```typescript
interface AttentionItem {
  type: 'email_reply' | 'meeting_prep' | 'drive_file' | 'deadline' | 'followup';
  priority: 'high' | 'medium';
  title: string;
  description: string;
  action_label: string;
  action_context: string;  // Thread ID, Event ID, or File ID
}
```

No changes — drive_file items are now contextual-only (prompt change, not schema change).

---

### InboxTriageItem (Modified)

```typescript
type EmailActionType =
  | 'draft_reply' | 'accept_meeting' | 'reject_meeting' | 'suggest_time'
  | 'create_task' | 'approve_request' | 'open_form' | 'add_to_calendar';

interface EmailAction {
  type: EmailActionType;
  label: string;
  detail?: string;
  context: Record<string, string>;  // thread_id, event_start, form_url, deadline, etc.
  needs_input?: string;
  conflict?: string;                // Calendar conflict description
}

interface InboxTriageItem {
  subject: string;
  sender: string;
  thread_id?: string;
  summary?: string;
  urgency?: 'urgent_action' | 'needs_input' | 'review' | 'fyi';  // AI-assigned urgency
  actions?: EmailAction[];  // Max 3 per email, AI-generated proactive actions
}
```

**Action generation rules** (embedded in AI prompt):
- Every `needs_reply` item gets at least `draft_reply` as a default action
- Meeting invites: AI cross-references calendar for conflicts → `accept_meeting` or `reject_meeting` + `suggest_time`
- Approvals/sign-offs → `approve_request`
- Deadlines → `create_task` with extracted date
- Forms/surveys → `open_form` with URL
- `needs_input` items: AI can't determine action without user guidance

---

### FallbackTriageResult (New — Frontend Only)

Used when AI briefing is unavailable to provide heuristic-based inbox triage.

```typescript
interface FallbackTriageResult {
  needs_reply: InboxTriageItem[];
  needs_input: InboxTriageItem[];
  fyi_only: InboxTriageItem[];
  can_ignore: InboxTriageItem[];
}
```

**Heuristic classification**:
- `needs_reply`: User in To: field, sender is human (no `noreply@`, `no-reply@`, `notifications@`), not a mailing list
- `fyi_only`: User in CC field, or from a known person but doesn't require action
- `can_ignore`: Automated senders, newsletters (contains "unsubscribe" in headers), notification emails

---

## State Changes

### useBriefing Hook (Modified)

```typescript
interface BriefingState {
  briefing: Briefing | null;
  loading: boolean;
  error: boolean;
  retrying: boolean;           // NEW: true during retry attempt
  newItemCount: number;
  acknowledge: () => void;
  refresh: () => void;
}
```

**Retry state machine**:
```
IDLE → LOADING → [SUCCESS → CACHED] | [FAIL → RETRYING → [SUCCESS → CACHED] | [FAIL → FALLBACK]]
```

---

### ToolTimeline Visibility (New — Frontend State)

No new data model needed. The `ToolTimeline` component receives a `collapsed` prop (default: `true`). User toggle is local component state.

---

## Cache Behavior

| Cache Key | TTL | Invalidation |
|-----------|-----|-------------|
| `briefing` | 10 minutes | Manual refresh, logout |
| `stats` | 60 seconds | Manual refresh |
| `gmail_recent_*` | 60 seconds | Manual refresh |
| `calendar_upcoming_*` | 60 seconds | Manual refresh |

No changes to caching — existing strategy is appropriate.
