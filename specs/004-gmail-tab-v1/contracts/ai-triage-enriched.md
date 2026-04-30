# Contract: `POST /api/ai-triage` (extended for enrichment)

**Status**: Extension of existing endpoint
**Current handler**: `server.ts:3516`
**Current shape defined in**: `src/services/api.ts:599-604` (request), `src/lib/ai-triage.ts:11-13` (response)
**Backwards compatibility**: Required — existing dashboard caller must keep working

---

## 1. Purpose

The Gmail tab's action-first row model (User Story 1) and bucketed default view (User Story 2) both depend on per-thread enrichment computed from thread metadata. This endpoint is the single source of truth for that enrichment. It is called once per Gmail tab page load with up to 25 threads, returns enrichment for each, and caches results on disk for 24 hours.

This is an **extension** of the existing `/api/ai-triage` handler. The current handler returns only `{ categories: [...] }`; the extended handler adds `enrichments[]`, `failed[]`, `cacheStats`, `bucketCounts`, and `durationMs` to the response while keeping `categories` optional for legacy callers.

---

## 2. Request

### Method & Path

```
POST /api/ai-triage
```

### Headers

- `Content-Type: application/json`
- Authentication: the caller must be authenticated via the existing gws CLI credentials flow. No new auth introduced.

### Body schema

```ts
interface AiTriageRequest {
  threads: GmailThreadSummary[];  // up to 25 threads (capped server-side)
  // Optional: request legacy categories alongside enrichments (for the dashboard caller)
  legacy?: boolean;
  // Optional: caller-supplied correlation id for observability
  requestId?: string;
}

// Reused from src/services/api.ts:100-110
interface GmailThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  unread: boolean;
  messageCount: number;
  hasAttachments: boolean;
  labelIds: string[];
}
```

### Request validation rules

- `threads` is required, non-empty, max length 25. Longer arrays are truncated server-side and a warning is logged.
- Every `GmailThreadSummary` must have a non-empty `id`. Entries with missing or duplicate ids are skipped.
- **Privacy constraint (FR-006a).** Callers MUST NOT include message bodies in `snippet` beyond what Gmail already exposes as the thread preview. The server does not enforce this cryptographically; it is the caller's contract obligation. The existing `/api/gmail/threads` endpoint already populates `snippet` with Gmail's native preview field, so the default frontend path satisfies this rule automatically.
- `legacy` defaults to `false`. When `true`, the response includes the backwards-compatible `categories[]` field.

### Example request

```json
POST /api/ai-triage
Content-Type: application/json

{
  "threads": [
    {
      "id": "18fa0c1a9b2d",
      "subject": "Re: AMD offer follow-up",
      "snippet": "Hi Mohamed, checking in on your decision...",
      "from": "Alice Lee <alice@amd.com>",
      "date": "2026-04-10T16:22:00Z",
      "unread": true,
      "messageCount": 3,
      "hasAttachments": false,
      "labelIds": ["INBOX"]
    },
    {
      "id": "18fa0c2bff4e",
      "subject": "Your Stripe receipt",
      "snippet": "Receipt for $29.00...",
      "from": "Stripe <receipts@stripe.com>",
      "date": "2026-04-11T03:00:00Z",
      "unread": true,
      "messageCount": 1,
      "hasAttachments": false,
      "labelIds": ["INBOX", "CATEGORY_UPDATES"]
    }
  ],
  "requestId": "gmail-tab-open-1744387200"
}
```

---

## 3. Response

### Success: `200 OK`

```ts
interface AiTriageResponse {
  enrichments: ThreadEnrichment[];
  failed: string[];                 // threadIds that could not be enriched
  cacheStats: {
    hits: number;
    misses: number;
    totalRequested: number;
  };
  bucketCounts: {
    needs_reply: number;
    waiting: number;
    quick_wins: number;
    reference_fyi: number;
  };
  durationMs: number;
  // Optional legacy shape (only when request.legacy === true)
  categories?: { label: string; threadIds: string[] }[];
}

// Defined in data-model.md
interface ThreadEnrichment {
  threadId: string;
  priority: 'high' | 'medium' | 'low' | 'none';
  recommendedAction?: RecommendedAction;
  whyItMatters?: string;
  effortMinutes: 'none' | '1' | '5' | '15+';
  bucket: 'needs_reply' | 'waiting' | 'quick_wins' | 'reference_fyi';
}
```

### Example success response

```json
{
  "enrichments": [
    {
      "threadId": "18fa0c1a9b2d",
      "priority": "high",
      "recommendedAction": "draft_reply",
      "whyItMatters": "External reply — you asked on Apr 8.",
      "effortMinutes": "5",
      "bucket": "needs_reply"
    },
    {
      "threadId": "18fa0c2bff4e",
      "priority": "none",
      "effortMinutes": "none",
      "bucket": "reference_fyi"
    }
  ],
  "failed": [],
  "cacheStats": {
    "hits": 0,
    "misses": 2,
    "totalRequested": 2
  },
  "bucketCounts": {
    "needs_reply": 1,
    "waiting": 0,
    "quick_wins": 0,
    "reference_fyi": 1
  },
  "durationMs": 1420
}
```

### Partial failure: `200 OK` with `failed[]` populated

```json
{
  "enrichments": [
    { "threadId": "18fa0c1a9b2d", "priority": "high", "recommendedAction": "draft_reply", "whyItMatters": "External reply — you asked on Apr 8.", "effortMinutes": "5", "bucket": "needs_reply" }
  ],
  "failed": ["18fa0c2bff4e"],
  "cacheStats": { "hits": 0, "misses": 2, "totalRequested": 2 },
  "bucketCounts": { "needs_reply": 1, "waiting": 0, "quick_wins": 0, "reference_fyi": 0 },
  "durationMs": 1850
}
```

A failed thread id means the row will render with the plain fallback layout on the client (FR-005). The response is still a `200 OK`.

### Errors

| Status | Meaning | Client behavior |
|---|---|---|
| `400 Bad Request` | Malformed body (missing `threads`, wrong type, >25 entries after strict validation) | Show error toast, keep current view |
| `401 Unauthorized` | Gws credentials missing or expired | Redirect to sign-in |
| `429 Too Many Requests` | Per-user rate limit exceeded (not enforced in v1 but reserved) | Fall back to plain rows + show `SmartViewUnavailableBanner` |
| `500 Internal Server Error` | LLM provider unavailable, timeout, or internal exception | Fall back to plain rows + show `SmartViewUnavailableBanner` (FR-025) |
| `503 Service Unavailable` | LLM provider returned an explicit unavailable signal | Same as 500 |

### Timeout behavior

The endpoint's internal LLM call has a 2000 ms timeout (matching the existing `callWithRetry` config at `server.ts:3527-3535`). If the timeout fires:

1. The endpoint returns `500` with body `{ error: "enrichment_timeout", failed: [...all requested threadIds] }`.
2. The frontend (per FR-025) catches the error, shows the `SmartViewUnavailableBanner`, and falls back to the current three-tab experience.
3. The server emits the observability event `gmail_enrichment_batch` with `successCount: 0` and `durationMs: 2000`.

---

## 4. Caching behavior

### Persistent cache

The server maintains a per-account cache at `DATA_DIR/.gmail-enrichment.{accountKey}.json` (see research Decision 3). On every request:

1. For each thread, compute the cache key `{threadId}:{lastMessageId}`. `lastMessageId` is the id of the most recent message in the thread (available in `GmailThreadSummary` via the underlying Gmail thread payload; a helper extracts it from the thread object the caller passed in).
2. Look up the key in the cache. If found and not expired (age < 24h) and not invalidated, use it as a cache hit. Increment `cacheStats.hits`.
3. Otherwise, add the thread to the LLM batch. Increment `cacheStats.misses`.
4. After the LLM call returns, write successful enrichments back to the cache using the atomic tmp-file + rename pattern.

### Invalidation

A cache entry is invalidated when:

- **Any write action fires on the thread.** The existing `/api/inbox-actions` handler (`server.ts:1761`) and `/api/send-reply` handler call a new helper `invalidateEnrichmentForThread(threadId)` after the write succeeds. The helper removes the cached entry. FR-004.
- **The entry is older than 24h.** Rolling TTL, see data-model `EnrichmentCacheEntry`.
- **The thread's `lastMessageId` changes.** New message arrives → new cache key → the old key is orphaned and lazily cleaned on next write.

### Cold vs warm behavior

- **Cold cache (first open):** All 25 threads are misses. Single LLM call. Expected latency: 1–3 seconds. The frontend does not block on this — the plain list renders first, then enriched fields fill in progressively.
- **Warm cache (reopen within 24h, no new messages):** All 25 threads are hits. No LLM call. Expected latency: <100ms (disk read only). Enriched rows render on first paint (SC-002).
- **Mixed (some new messages):** Hits for unchanged threads, misses for changed ones. Single LLM call for the miss subset.

---

## 5. Observability

Every request emits one structured log line on completion:

```json
{
  "event": "gmail_enrichment_batch",
  "batchSize": 25,
  "successCount": 24,
  "successRate": 0.96,
  "cacheHits": 12,
  "cacheHitRate": 0.48,
  "durationMs": 1234,
  "requestId": "gmail-tab-open-1744387200",
  "accountKey": "default",
  "timestamp": "2026-04-11T14:30:00Z"
}
```

Per FR-027, a downstream log pipeline (Datadog, CloudWatch, etc.) aggregates these fields into the four counters and one histogram the spec requires.

---

## 6. Backwards compatibility

### Existing dashboard caller

The dashboard briefing currently calls `POST /api/ai-triage` with `{ threads }` and reads `categories[]` from the response (`src/lib/ai-triage.ts:11-13`). The extended handler:

- Keeps the `categories[]` field in the response when `legacy: true` is passed (or, as a safety net, when `legacy` is missing — for v1 the server defaults to including `categories` when it can cheaply derive it, so no client change is required on day 1).
- Maintains the exact shape of each `categories` entry.

Rolling out the extension requires **zero frontend changes** to the dashboard. A follow-up spec can migrate the dashboard to read `enrichments[]` directly and drop the legacy path.

### Agent tool `gmail_triage`

Unrelated — that tool delegates to `gws gmail +triage` and does not call this endpoint. It continues to work unchanged.

---

## 7. Test fixtures

Unit tests for the extended handler go at `tests/contract/ai-triage-enriched.test.ts` and cover:

1. **Cold cache, all misses.** Assert 1 LLM call, `cacheStats.hits === 0`, `enrichments.length === 25`, `failed === []`.
2. **Warm cache, all hits.** Assert 0 LLM calls, `cacheStats.hits === 25`, response time under 100ms.
3. **Partial cache, some hits some misses.** Assert 1 LLM call for only the missing threads.
4. **LLM returns a generic recommendation for 3 threads.** Assert those 3 end up in `failed[]` and the other 22 succeed. (Specificity rejection per FR-019a.)
5. **LLM returns a `quick_wins` bucket for a receipt thread.** Assert the server rewrites it to `reference_fyi` per Q4 tie-breaker.
6. **LLM timeout.** Assert `500` response with `failed: [...all threadIds]` and `durationMs >= 2000`.
7. **Invalidation path.** Write a cache entry, call `invalidateEnrichmentForThread(threadId)`, assert next request for that thread is a miss.
8. **Legacy compatibility.** Call with no `legacy` field, assert `categories[]` is present in response.

Fixtures include:
- Realistic thread summaries (20 threads covering all 4 bucket types).
- Mocked LLM responses (one file per scenario).
- A temp `DATA_DIR` pointing at a fixture directory so cache behavior can be tested without touching the real user's home.
