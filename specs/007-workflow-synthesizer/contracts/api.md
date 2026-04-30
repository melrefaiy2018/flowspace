# API Contracts — Workflow Synthesizer

All endpoints live in `server.ts` (per Constitution II, single Express boundary) and are consumed by the frontend via typed wrappers in `src/services/api.ts`. Standard envelope: 200 OK on success with the documented body, 4xx with `{ error: string }` on validation failure, 5xx with `{ error: string }` on internal failure.

All bodies are JSON. All endpoints are local-only and do not transmit data to third parties (Constitution I).

---

## GET `/api/synthesizer/settings`

Get current synthesis settings.

**Response 200**:
```json
{
  "enabled": false,
  "minOccurrences": 3,
  "lookBackDays": 14,
  "maxSequenceLength": 5,
  "dismissCooldownDays": 30,
  "logCapEntries": 1000,
  "logRetentionDays": 30
}
```

---

## PATCH `/api/synthesizer/settings`

Update one or more settings. All fields optional; omitted fields keep current value.

**Request**:
```json
{ "enabled": true, "minOccurrences": 4 }
```

**Response 200**: same shape as GET.

**Response 400**: if any field is out of its documented range (see data-model.md Entity 5).

**Side effects**:
- Toggling `enabled: false → true` does NOT replay history; observation begins from the next dispatch.
- Toggling `enabled: true → false` stops new appends immediately.

---

## GET `/api/synthesizer/log`

Read the recorded invocation log (newest-first).

**Query params**: `limit` (default 200, max 1000).

**Response 200**:
```json
{
  "totalEntries": 537,
  "entries": [
    {
      "id": "f3b1...",
      "name": "search_emails",
      "argsHash": "9c2e1a4d6b7f8e0c",
      "timestamp": "2026-04-29T19:42:11.123Z",
      "success": true,
      "approval": "auto",
      "source": "chat"
    }
  ]
}
```

**Response 200 with empty entries** if `enabled` is false or no entries recorded yet.

---

## DELETE `/api/synthesizer/log`

Clear the entire invocation log. Does not affect proposals or samples.

**Response 200**: `{ "cleared": true, "deletedCount": 537 }`.

---

## GET `/api/synthesizer/proposals`

List active proposals (and dismissed ones still in cooldown, if `?includeDismissed=true`).

**Response 200**:
```json
{
  "proposals": [
    {
      "id": "p_8a1c...",
      "sequence": ["search_emails", "apply_label_to_threads", "archive_email_threads"],
      "occurrences": 4,
      "firstSeen": "2026-04-15T08:12:00Z",
      "lastSeen": "2026-04-29T17:01:00Z",
      "containsDestructive": false,
      "sampleAvailable": true,
      "dismissedAt": null
    }
  ]
}
```

`sampleAvailable: true` indicates a literal-arg sample is stored and available via the promote endpoint.

---

## POST `/api/synthesizer/proposals/:id/dismiss`

Dismiss a proposal. Sets `dismissedAt` to now; prevents re-emission until `dismissCooldownDays` elapses.

**Response 200**: `{ "dismissed": true, "id": "p_8a1c..." }`.

**Response 404**: proposal not found.

---

## GET `/api/synthesizer/proposals/:id/sample`

Fetch the literal-argument sample for a proposal — used by the editor pre-fill flow. Returns the most recent sample only.

**Response 200**:
```json
{
  "proposalId": "p_8a1c...",
  "capturedAt": "2026-04-29T17:01:00Z",
  "steps": [
    { "action": "search_emails", "args": { "query": "from:newsletter@..." } },
    { "action": "apply_label_to_threads", "args": { "label": "Newsletters", "threadIds": ["..."] } },
    { "action": "archive_email_threads", "args": { "threadIds": ["..."] } }
  ]
}
```

**Response 404**: no sample stored (proposal exists but sample was cleared, or process restarted before capture).

**Response 200 fallback**: if sample missing, the editor pre-fills with empty `args: {}` for each step and shows a "no sample available" notice.

---

## POST `/api/synthesizer/proposals/:id/promote`

Promote a proposal to a saved dynamic tool. Server-side this is the same operation as creating any dynamic tool; this endpoint just composes the proposal's sequence + sample into a `DynamicToolDef` and calls `registerDynamicTool()`.

**Request**:
```json
{
  "name": "newsletter_archive",
  "description": "Archive newsletter emails after labeling them.",
  "label": "Newsletter Archive",
  "parameters": { "type": "object", "properties": {} },
  "isWriteTool": true,
  "steps": [
    { "action": "search_emails", "args": { "query": "from:newsletter@..." } },
    { "action": "apply_label_to_threads", "args": { "label": "Newsletters", "threadIds": "{{steps.0.threadIds}}" } },
    { "action": "archive_email_threads", "args": { "threadIds": "{{steps.0.threadIds}}" } }
  ]
}
```

**Response 201**:
```json
{ "registered": true, "name": "newsletter_archive" }
```

The proposal and its sample are deleted server-side on success.

**Response 409**: name collides with existing static or dynamic tool — `{ "error": "Tool name already in use" }`.

**Response 400**: validation error (sequence empty, name invalid, step action unknown).

---

## DELETE `/api/synthesizer/samples`

Clear all proposal samples without affecting the proposals themselves. Surfaces in Settings under "Clear sample data".

**Response 200**: `{ "cleared": true, "deletedCount": 7 }`.

---

## Internal contract: observation hook

Not an HTTP endpoint, but a contract between `tool-dispatch.ts` and the synthesizer module:

```ts
// src/agent/synthesizer/observer.ts
export function recordInvocation(input: {
  name: string;
  args: Record<string, unknown>;
  success: boolean;
  approval: 'auto' | 'user_approved' | 'user_rejected' | 'pending';
  source: 'chat' | 'scheduler';
}): void;
```

**Contract**:
- MUST return synchronously in O(1) wall-clock time excluding the file write.
- MUST NOT throw; internal errors are caught and logged.
- MUST be a no-op when settings.enabled is false.
- MUST hash `args` per the algorithm in research R2 before persisting; raw `args` MUST NOT be written to disk except via the in-memory ring → ProposalSampleStore path.
