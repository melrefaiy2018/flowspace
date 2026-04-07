# API Contracts: Nail the Briefing

**Feature**: `002-briefing-redesign`
**Date**: 2026-03-07

## Modified Endpoints

### GET /api/briefing

**Change**: Retry logic added, response shape updated for DayEvent.

**Request**: No changes (GET, no params).

**Response** (success):

```json
{
  "greeting": "Good morning, Mohamed",
  "summary": "You have 3 meetings today, with your 1-on-1 with Sarah needing prep. 5 emails need your reply, including a client follow-up from Acme Corp.",
  "attention_items": [
    {
      "type": "meeting_prep",
      "priority": "high",
      "title": "1-on-1 with Sarah",
      "description": "No agenda doc created yet — 3 discussion topics pending from last week",
      "action_label": "Create notes doc",
      "action_context": "event_abc123"
    },
    {
      "type": "drive_file",
      "priority": "medium",
      "title": "Review Q1 Report",
      "description": "Shared by Alex yesterday — relevant to your 2pm budget review",
      "action_label": "Open file",
      "action_context": "file_xyz789"
    }
  ],
  "inbox_triage": {
    "needs_reply": [
      {
        "subject": "Re: Proposal feedback",
        "sender": "Jane Smith <jane@acme.com>",
        "thread_id": "18f1a2b3c4d5e6f7",
        "summary": "Asking for your sign-off on the revised pricing section"
      }
    ],
    "fyi_only": [
      {
        "subject": "Team standup notes",
        "sender": "Bot <standup@company.com>",
        "thread_id": "18f1a2b3c4d5e600",
        "summary": "Yesterday's standup summary — no action items for you"
      }
    ],
    "can_ignore": [
      {
        "subject": "Your weekly GitHub digest",
        "sender": "GitHub <notifications@github.com>",
        "thread_id": "18f1a2b3c4d5e601",
        "summary": "Automated repository activity summary"
      }
    ]
  },
  "day_at_a_glance": [
    {
      "time": "09:00",
      "title": "Team standup",
      "event_id": "evt_001",
      "attendees": ["Alice", "Bob"],
      "has_notes_doc": false,
      "prep_note": null,
      "priority_group": "show_up",
      "linked_docs": []
    },
    {
      "time": "10:30",
      "title": "1-on-1 with Sarah",
      "event_id": "evt_002",
      "attendees": ["Sarah Chen"],
      "has_notes_doc": false,
      "prep_note": "Review last week's action items before this meeting",
      "priority_group": "needs_prep",
      "linked_docs": [
        {
          "name": "1-on-1 Notes - Sarah",
          "url": "https://docs.google.com/document/d/abc123",
          "type": "notes"
        }
      ]
    },
    {
      "time": "14:00",
      "title": "All-hands",
      "event_id": "evt_003",
      "attendees": ["Everyone"],
      "has_notes_doc": true,
      "prep_note": null,
      "priority_group": "fyi",
      "linked_docs": []
    }
  ],
  "followups": []
}
```

**Response** (AI failure — after retry):

```json
{
  "error": "briefing_unavailable",
  "reason": "GLM API returned 500 after 2 attempts"
}
```

**Retry behavior**:
- Attempt 1: Call GLM API
- On 5xx/network error: Wait 2s, retry once
- On 4xx/auth error: Return error immediately (no retry)
- On malformed JSON: Attempt secondary extraction, then return error
- Max total latency: ~12s (5s first call + 2s wait + 5s retry)

### Backend Post-Processing (after AI response)

1. Parse JSON from AI response
2. Enforce `day_at_a_glance` max 8 events:
   - Keep all `needs_prep` (max 3)
   - Keep all `show_up` (max 3)
   - Fill remainder with `fyi` (max 2)
3. Inject follow-ups from Google Tasks
4. Inject overdue follow-ups as attention_items
5. Cache result for 10 minutes

---

## No New Endpoints

All changes are modifications to the existing `/api/briefing` response shape. No new endpoints are introduced in this feature.

The following endpoints are **unchanged**:
- `GET /api/stats`
- `GET /api/gmail/recent`
- `GET /api/calendar/upcoming`
- `GET /api/drive/recent` (still available for chat, just not rendered in briefing)
- `GET /api/followups`
- `POST /api/chat`
