# Contract: `GET /api/thread-brief/:threadId`

**Status**: New endpoint
**Depends on**: `src/agent/prompts/gmail-enrichment.ts` (new, see research Decision 2), `createLLMClient()` (`src/agent/llm-client.ts:20-40`, existing), `/api/gmail/thread/:threadId` (existing, `server.ts:1578`)

---

## 1. Purpose

Powers User Story 4: the decision header above the message chain in `ThreadReader.tsx`. Returns a one-sentence summary, a specific recommended next action, context chips describing thread state, and a list of first-class action buttons.

This is the **only** endpoint in this feature that causes full message bodies to be transmitted to the intelligence service. Per FR-006b, it is called only when the user explicitly opens a thread.

---

## 2. Request

### Method & Path

```
GET /api/thread-brief/:threadId
```

### Path parameters

- `threadId` — the Gmail thread id. Must match the regex `^[A-Za-z0-9_-]+$` for safety. Invalid ids return `400`.

### Headers

- Authentication: same gws CLI credentials flow as the rest of the API. No new auth.

### Query parameters

None in v1. A follow-up spec may add a `refresh=1` option to bypass the session cache.

### Example request

```
GET /api/thread-brief/18fa0c1a9b2d
```

---

## 3. Response

### Success: `200 OK`

```ts
interface ThreadBriefResponse {
  brief: ThreadBrief;
  cacheHit: boolean;
  durationMs: number;
}

// Defined in data-model.md
interface ThreadBrief {
  threadId: string;
  summary: string;
  recommendedAction: string;
  contextChips: ContextChip[];
  firstClassActions: FirstClassAction[];
  isFallback: boolean;
  cachedAt: string; // ISO timestamp
}

interface ContextChip {
  label: string;
  kind: 'reply_state' | 'last_message_age' | 'thread_age' | 'participants' | 'other';
}

type FirstClassAction =
  | { kind: 'draft_reply' }
  | { kind: 'pick_times' }
  | { kind: 'decline' }
  | { kind: 'delegate' }
  | { kind: 'save_to_drive' }
  | { kind: 'nudge' };
```

### Example success — freshly computed

```json
GET /api/thread-brief/18fa0c1a9b2d

200 OK
{
  "brief": {
    "threadId": "18fa0c1a9b2d",
    "summary": "Alice from AMD recruiting is asking for 30 minutes next week to discuss the offer.",
    "recommendedAction": "Send Tue 2pm or Thu 10am as slots — both free on your calendar.",
    "contextChips": [
      { "label": "Replied Apr 8", "kind": "reply_state" },
      { "label": "Last message 2h ago", "kind": "last_message_age" },
      { "label": "Thread active 11 days", "kind": "thread_age" }
    ],
    "firstClassActions": [
      { "kind": "draft_reply" },
      { "kind": "pick_times" },
      { "kind": "decline" },
      { "kind": "delegate" }
    ],
    "isFallback": false,
    "cachedAt": "2026-04-11T14:30:00Z"
  },
  "cacheHit": false,
  "durationMs": 1580
}
```

### Example — cache hit (same session)

```json
200 OK
{
  "brief": { /* same as above */ "cachedAt": "2026-04-11T14:30:00Z" },
  "cacheHit": true,
  "durationMs": 8
}
```

### Example — fallback on failure

When the LLM call fails, times out, or returns a generic recommendation (specificity rule violation), the endpoint returns a fallback brief. The client renders the minimal header (Draft reply button only) per FR-023.

```json
200 OK
{
  "brief": {
    "threadId": "18fa0c1a9b2d",
    "summary": "",
    "recommendedAction": "",
    "contextChips": [
      { "label": "Last message 2h ago", "kind": "last_message_age" }
    ],
    "firstClassActions": [
      { "kind": "draft_reply" }
    ],
    "isFallback": true,
    "cachedAt": "2026-04-11T14:30:00Z"
  },
  "cacheHit": false,
  "durationMs": 5120
}
```

Note: even fallback responses return `200 OK`, not an error status. The client's success path handles `isFallback: true` to render the degraded header. The fallback response still includes at least one context chip derived from deterministic metadata (not from the LLM) so the header isn't empty.

### Errors

| Status | Meaning | Client behavior |
|---|---|---|
| `400 Bad Request` | Invalid `threadId` format | Log error, render fallback header |
| `401 Unauthorized` | Gws credentials missing or expired | Redirect to sign-in |
| `404 Not Found` | Thread does not exist or is not accessible to the user | Show error in the reader, close the reader |
| `500 Internal Server Error` | Unexpected exception in the handler (not an LLM failure — those return fallback briefs as 200) | Render fallback header |

### Timeout behavior

The LLM call has a 5000 ms timeout (longer than list enrichment because the brief is a single-thread latency-sensitive UX, and the user is already looking at the thread body while waiting). If the timeout fires, the endpoint returns a fallback brief with `isFallback: true`. The client renders the minimal header. Observability event `thread_brief_complete` is emitted with `success: false`.

---

## 4. Caching behavior

### In-memory session cache

The server maintains a `Map<threadId, ThreadBrief>` in process memory. Lookups:

1. Check the map for the requested `threadId`.
2. If present, return with `cacheHit: true`.
3. If absent, compute the brief and insert before returning.

### Eviction

- **On server restart.** The map is cleared automatically.
- **On invalidation.** When any write action fires on the thread (handled via the same `invalidateEnrichmentForThread(threadId)` helper), the brief entry is also removed. Same helper, two cache layers.
- **No TTL.** Briefs are session-scoped; a user who keeps the server running for 24 hours will see the same brief for a thread they opened at the start of the day. This is acceptable per the spec assumption ("thread brief caching is per-session"). A follow-up spec can add a short TTL if users report staleness.

---

## 5. LLM call details

### Prompt source

The brief prompt lives in the new `src/agent/prompts/gmail-enrichment.ts` module (see research Decision 2). Function signature:

```ts
function buildThreadBriefPrompt(thread: GmailThreadDetail): {
  system: string;
  user: string;
};
```

### System prompt (conceptual — final wording lives in code)

```
You are FlowSpace's decision helper. Given a Gmail thread, return a one-sentence
summary (≤140 chars), a specific recommended next action that names at least one
concrete entity from the thread or the user's context (date, time, person, document,
number, or decision), and up to 4 context chips. Generic verbs alone ("reply,"
"follow up," "draft a response") are not specific and MUST NOT be returned.

Response MUST be valid JSON in this exact shape:
{
  "summary": string,
  "recommendedAction": string,
  "contextChips": [ { "label": string, "kind": "reply_state" | "last_message_age" | "thread_age" | "participants" | "other" } ],
  "firstClassActions": [ { "kind": "draft_reply" | "pick_times" | "decline" | "delegate" | "save_to_drive" | "nudge" } ]
}
```

### User message

Concatenated thread history (sender, date, body) for each message in the thread, up to 5 messages max (to stay within token budget). Message bodies are truncated to 2000 chars each (matching the existing `/api/draft-reply` behavior at `server.ts:3605-3616`).

### LLM config

- Provider/model: whatever `createLLMClient()` resolves from `.llm-settings.json` (user-configured).
- Temperature: `0.3` (slightly more deterministic than `/api/draft-reply`'s 0.4, because we need reliable JSON parsing).
- Timeout: `5000 ms`.
- Retry: 1 attempt (matches the existing `callWithRetry` pattern).

### Post-processing

After the LLM returns:

1. Parse the JSON response. On parse failure → fallback.
2. Validate `summary.length <= 140`. Truncate with ellipsis if longer.
3. Apply the **specificity rule** (FR-019a): if `recommendedAction` matches the generic-verb regex (see research Decision 2), downgrade to `isFallback: true`.
4. Cap `contextChips` at 4 entries.
5. Ensure `firstClassActions` starts with `{ kind: 'draft_reply' }` — insert it if missing.
6. Merge deterministic chips (computed from thread metadata, not the LLM) with LLM-provided ones, deduping by `label`.

---

## 6. Observability

Every request emits one structured log line on completion:

```json
{
  "event": "thread_brief_complete",
  "threadId": "18fa0c1a9b2d",
  "success": true,
  "isFallback": false,
  "cacheHit": false,
  "durationMs": 1580,
  "accountKey": "default",
  "timestamp": "2026-04-11T14:30:00Z"
}
```

---

## 7. Test fixtures

Unit tests at `tests/contract/thread-brief.test.ts` cover:

1. **Cold fetch, success.** Mock a thread detail, mock the LLM to return valid JSON with a specific recommendation, assert the brief is returned with `isFallback: false`.
2. **Cache hit on second call.** Call twice in one session, assert `cacheHit: false` then `cacheHit: true`, assert only one LLM call.
3. **LLM returns generic recommendation.** Mock LLM to return `"Reply to the thread"`, assert `isFallback: true`.
4. **LLM returns malformed JSON.** Mock LLM to return non-JSON text, assert `isFallback: true`.
5. **LLM timeout.** Mock LLM to never resolve, assert `isFallback: true` after 5000 ms.
6. **Thread not found.** Mock `/api/gmail/thread/:id` to return 404, assert endpoint returns 404.
7. **Invalidation.** Compute a brief, invalidate via `invalidateEnrichmentForThread(threadId)`, assert next call is a cache miss.
8. **Summary length cap.** Mock LLM to return a 200-char summary, assert response is truncated to 140 chars with ellipsis.
9. **`firstClassActions` guarantee.** Mock LLM to return an empty actions array, assert response includes `{ kind: 'draft_reply' }`.

---

## 8. Privacy and data transmission

Per FR-006b, this endpoint is the **only** list-level or thread-level endpoint that causes full message bodies to be transmitted to the intelligence service. The user has explicitly opened the thread — their action constitutes consent to body-level analysis.

The endpoint does **not**:

- Transmit message bodies for threads the user has not opened.
- Pre-compute briefs in the background.
- Cache briefs to disk (only in-memory, cleared on server restart, so bodies leave no persistent trace).
- Send thread data to any service other than the one `createLLMClient()` is configured for.

Message bodies are truncated to 2000 chars per message and capped at 5 messages per thread before transmission, matching the existing `/api/draft-reply` behavior.
