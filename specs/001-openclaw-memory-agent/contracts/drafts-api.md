# API Contract: /api/drafts

## POST /api/drafts/scan

Trigger a horizon scan of the next 48 hours of calendar events.

**Auth**: Required (auth guard)
**Rate limit**: One scan at a time (returns 409 if scan in progress)

### Request
```
POST /api/drafts/scan
Content-Type: application/json

{}
```

No body required. Scan uses the authenticated user's calendar.

### Response (200)
```json
{
  "drafts": [
    {
      "id": "uuid",
      "meetingId": "google-calendar-event-id",
      "meetingTitle": "Q3 Board Review",
      "meetingTime": "2026-04-09T10:00:00Z",
      "attendees": ["sarah@example.com", "mike@corp.com"],
      "summary": "## Meeting Prep: Q3 Board Review\n\n...",
      "linkedDocs": [{ "title": "Q3 Revenue Report", "url": "https://..." }],
      "relatedEmails": [{ "subject": "Re: Board deck", "from": "sarah@example.com", "snippet": "..." }],
      "suggestedActions": ["Review Q3 revenue numbers", "Prepare board questions"],
      "confidence": 1.0,
      "confidenceReason": "",
      "createdAt": "2026-04-08T06:00:00Z",
      "status": "pending"
    }
  ],
  "meta": {
    "scannedAt": "2026-04-08T06:00:00Z",
    "meetingsFound": 8,
    "meetingsPrepped": 5,
    "errors": [
      { "meetingId": "evt-123", "meetingTitle": "1:1 with intern", "error": "LLM unavailable" }
    ]
  }
}
```

### Response (409)
```json
{ "error": "Scan already in progress" }
```

### Response (401)
```json
{ "error": "Not authenticated" }
```

---

## GET /api/drafts

List all staged drafts. Sets `seenAt` on pending items (used for Phase 2 "ignored" detection).

### Request
```
GET /api/drafts
```

### Response (200)
```json
{
  "drafts": [ /* StagedDraft[] */ ],
  "lastScan": {
    "scannedAt": "2026-04-08T06:00:00Z",
    "meetingsFound": 8,
    "meetingsPrepped": 5,
    "errors": []
  }
}
```

Returns drafts sorted by `meetingTime` ascending. Auto-purges expired drafts (>7 days or past meetingTime) before returning.

---

## POST /api/drafts/:id/approve

Mark a draft as approved. Returns the draft data for chat context injection.

### Request
```
POST /api/drafts/:id/approve
Content-Type: application/json

{}
```

### Response (200)
```json
{
  "draft": { /* StagedDraft with status: "approved" */ },
  "threadBrief": "Meeting prep for Q3 Board Review (Tomorrow 10:00am):\n\n..."
}
```

The `threadBrief` field is a pre-formatted string ready to inject into ChatContext.

### Response (404)
```json
{ "error": "Draft not found" }
```

### Response (409)
```json
{ "error": "Draft already approved" }
```

---

## POST /api/drafts/:id/dismiss

Mark a draft as dismissed.

### Request
```
POST /api/drafts/:id/dismiss
```

### Response (200)
```json
{ "success": true }
```

### Response (404)
```json
{ "error": "Draft not found" }
```

---

## PATCH /api/drafts/:id/useful

Toggle the "useful" boolean on a draft.

### Request
```
PATCH /api/drafts/:id/useful
Content-Type: application/json

{ "useful": true }
```

### Response (200)
```json
{ "success": true, "useful": true }
```

### Response (404)
```json
{ "error": "Draft not found" }
```
