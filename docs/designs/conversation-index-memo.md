# Server-Side Conversation Index Memo

> Date: 2026-04-12
> Status: Implementation-ready
> Prerequisite: Phase 3 embedding retrieval shipped (commit 3087361)
> Branch: 005-harness-improvements

---

## 1. Executive Summary

### Current problem

The FlowSpace server is stateless about conversations. It processes each chat request as an independent event. It does not know how many conversations a user has, what events they are linked to, or whether a meeting has already been prepped. All conversation identity — ID, title, eventId, threadBrief, message history — lives in the browser's localStorage, invisible to the backend.

### Why this is the next harness improvement

The harness now has working memory (with access tracking, universal extraction, and embedding retrieval), airtight approval, and modular code. The remaining continuity gap is that server-side systems — the horizon scanner, memory retrieval, future summarization — cannot reason about conversations because they do not know conversations exist.

### What this index solves now

- The server can look up conversations by eventId (enables "already prepped?" checks)
- The server has a per-user conversation manifest (enables cross-conversation awareness)
- Memory extraction can record which conversation it occurred in (enables "you discussed X in conversation Y")
- A clean foundation exists for future conversation summarization

### What this intentionally does not solve

- Full message history on the server (messages stay in localStorage)
- Cross-device conversation sync (requires a sync protocol, out of scope)
- Automatic conversation summarization (requires a separate summarization strategy)
- Server-side conversation reconstruction from memory (the index is metadata, not content)

---

## 2. Current Gap

The backend currently receives three pieces of conversation metadata per chat request:

| Field | Sent by frontend | Used by server |
|-------|-----------------|---------------|
| `conversationId` | Yes (api.ts:530) | Stored in RunRecord (in-memory, 24h TTL). Not persisted. |
| `threadBrief` | Yes (api.ts:532) | Injected into system prompt via context-assembler.ts. Not stored. |
| `sourceMessageId` | Yes (api.ts:531) | Stored in RunRecord. Not persisted. |

The backend does NOT receive:

| Field | Where it lives | Why the server cannot see it |
|-------|---------------|------------------------------|
| `eventId` | Conversation object in localStorage | Never included in API request body |
| `title` | Conversation object in localStorage | Never included in API request body |
| `messageCount` | Derived from Conversation.messages.length | Messages array sent per-request, but count not tracked |
| `groupId` | Conversation object in localStorage | Frontend-only organizational metadata |
| `createdAt` | Conversation.updatedAt in localStorage | Not sent |

**Specific limitations this causes:**

1. **No "already prepped?" check.** The horizon scanner cannot query whether a conversation linked to a calendar event already exists. It would need to call `findConversationByEventId()`, but that function lives in ChatContext.tsx (frontend React state). The server has no equivalent.

2. **No server-side event-to-conversation lookup.** When a meeting prep draft is generated, the server cannot check if an existing conversation is linked to that event. The eventId→conversation mapping exists only in the browser.

3. **No cross-conversation reasoning.** Memory entries track `source.toolName` and `source.conversationId` (when available), but there is no index to look up what conversation that ID refers to, when it was last active, or what it was about.

4. **No foundation for summarization.** To summarize old conversations, the server needs to know which conversations exist and how large they are. Without an index, it cannot even enumerate them.

5. **No persistence of conversation metadata across server restarts.** RunRecord stores conversationId in memory with a 24h TTL. After restart, the server has zero knowledge of any conversation.

---

## 3. Proposed Design

A metadata-only conversation index, persisted as a JSON file per user.

### Schema

```typescript
interface ConversationIndexEntry {
  // Required fields
  id: string;                    // Conversation UUID (from frontend)
  lastMessageAt: number;         // Timestamp of most recent chat request
  messageCount: number;          // Running count of chat turns (incremented per request)

  // Optional fields (populated when available)
  title?: string;                // Conversation title (auto-generated or manual)
  eventId?: string;              // Google Calendar event ID (for meeting prep / event-linked flows)
  threadBrief?: string;          // Summary portion of threadBrief (not the full structured object)
  createdAt?: number;            // Timestamp of first chat request for this conversation
  origin?: ConversationOrigin;   // How the conversation was started
}

type ConversationOrigin = 'chat' | 'meeting_prep' | 'draft_discuss' | 'action_trigger';

interface ConversationIndex {
  version: 1;
  entries: Record<string, ConversationIndexEntry>;  // Keyed by conversationId
}
```

### Field rationale

| Field | Required | Why |
|-------|----------|-----|
| `id` | Yes | Primary key. Matches frontend Conversation.id. |
| `lastMessageAt` | Yes | Enables recency sorting. Updated on every chat request. |
| `messageCount` | Yes | Enables size-based decisions (e.g., "conversation is long enough to summarize"). Incremented per request. |
| `title` | No | Useful for display and search. The frontend may not send it initially (auto-generated after first response). |
| `eventId` | No | Only set for meeting prep and event-linked conversations. Enables event→conversation lookup. |
| `threadBrief` | No | Stores the summary string (not the full StructuredThreadBrief JSON). Enables the server to understand what the conversation is about. Capped at 500 chars. |
| `createdAt` | No | Set on first index entry creation. Enables age-based queries. |
| `origin` | No | Records how the conversation started. Useful for analytics and for distinguishing meeting prep from general chat. |

### What is NOT in the index

- **Message content.** No text, no role, no blocks.
- **Full StructuredThreadBrief.** Only the summary string (first 500 chars). The full structured object stays in localStorage.
- **Approval state.** Approvals are transient and managed per-request.
- **Memory IDs.** The memory system has its own per-user store. Cross-referencing happens via conversationId in memory source metadata, not by duplicating memory pointers in the index.

---

## 4. Source of Truth Decision

### Ownership boundaries

| Data | Owner | Location |
|------|-------|----------|
| Full message history | Frontend | localStorage |
| Conversation title (authoritative) | Frontend | localStorage |
| Conversation groups | Frontend | localStorage |
| UI state (panel, input, view) | Frontend | React state |
| Conversation metadata index | Server | `DATA_DIR/.conversations.{userHash}.json` |
| Memory entries | Server | `DATA_DIR/.memory/{userHash}.json` |
| Embeddings | Server | `DATA_DIR/.memory/{userHash}.embeddings.json` |

### The frontend remains the source of truth for conversation content and identity.

The server index is a **derived, append-mostly projection** of conversation metadata. It is updated as a side effect of chat requests. It does not replace the frontend's conversation model.

### How to avoid drift

1. **The server never creates conversations.** Index entries are created only when the server receives a `conversationId` in a chat request. The frontend creates conversations; the server observes them.

2. **The server never deletes conversations from the index.** If the frontend deletes a conversation from localStorage, the index entry persists as a stale record. This is acceptable — stale entries are harmless metadata. A periodic cleanup (e.g., prune entries older than 90 days with no updates) can be added later.

3. **messageCount may drift.** The server increments `messageCount` on each `/api/chat/stream` request. The frontend may have messages that were never sent to the server (e.g., local-only error messages, or conversations that never triggered a chat request). This is acceptable — `messageCount` reflects server-observed turns, not total frontend messages. The drift is bounded and the field is used for rough size estimation, not exact counting.

4. **title may lag.** The frontend auto-generates titles after the first response. The server receives `title` only if the frontend sends it. Titles set before the first chat request will be missing from the index until the next request includes them. This is acceptable — the title is informational, not structural.

---

## 5. Update Flow

### Step-by-step: `/api/chat/stream`

```
1. Frontend calls POST /api/chat/stream with:
   { messages, tz, conversationId, sourceMessageId, threadBrief }
   NEW: { title?, eventId? }  ← two new optional fields in request body

2. Server extracts conversationId and metadata from request body

3. Server loads conversation index from disk (or creates empty if missing)

4. If conversationId exists in index:
   - Update: lastMessageAt = Date.now()
   - Update: messageCount += 1
   - Update: threadBrief = truncate(threadBrief, 500) if provided
   - Update: title if provided and entry.title is undefined
   - Update: eventId if provided and entry.eventId is undefined
   (Never overwrite existing eventId or title — frontend is authoritative)

5. If conversationId does NOT exist in index:
   - Create new entry:
     {
       id: conversationId,
       createdAt: Date.now(),
       lastMessageAt: Date.now(),
       messageCount: 1,
       title: title ?? undefined,
       eventId: eventId ?? undefined,
       threadBrief: truncate(threadBrief, 500) ?? undefined,
       origin: deriveOrigin(eventId, threadBrief),
     }

6. Write index to disk (atomic temp+rename)

7. Proceed with normal handleChat() flow (unchanged)
```

### Step-by-step: `/api/chat/approve`

```
1. Frontend calls POST /api/chat/approve with { approval }
2. approval.runId links to a RunRecord which has conversationId
3. If conversationId found in RunRecord:
   - Update index: lastMessageAt = Date.now()
   - Update index: messageCount += 1
4. Write index to disk
5. Proceed with normal executeApprovedAction() flow
```

### Draft discussions

When `handleDiscussDraft` triggers a `sendMessage()` with `eventId` and `threadBrief`, the subsequent `/api/chat/stream` request will include these fields (after the frontend change to send them). The index entry is created with `origin: 'draft_discuss'` and the eventId is stored.

### What the frontend must change

The `api.streamChat()` function in `src/services/api.ts` must be extended to accept and forward two new optional fields:

```typescript
metadata?: {
  conversationId?: string;
  sourceMessageId?: string;
  threadBrief?: string;
  title?: string;      // NEW
  eventId?: string;    // NEW
}
```

ChatContext.tsx's `sendMessage()` must pass these from the Conversation object:

```typescript
{
  conversationId: targetConvId,
  sourceMessageId: payload.assistantId,
  threadBrief: existingConv?.threadBrief,
  title: existingConv?.title,         // NEW
  eventId: existingConv?.eventId,     // NEW
}
```

---

## 6. Event Linkage Design

### How meeting prep conversations are linked

1. User clicks "Prepare meeting" on CalendarPage or "Discuss" on DraftQueue
2. Frontend creates a conversation with `eventId: calendarEventId`
3. Frontend sends `/api/chat/stream` with `eventId` in the metadata
4. Server creates an index entry with `eventId` set
5. The index now maps `eventId` → `conversationId`

### How DraftQueue discussions attach to the same event

DraftQueue "Discuss" already sets `eventId: draft.meetingId` (fixed in Phase 1). The `meetingId` is the Google Calendar event ID. Both CalendarPage prep and DraftQueue discuss use the same `eventId` value for the same meeting, so the index will have one or two entries pointing to the same event.

### How CalendarPage resume can use the index

Currently, `findConversationByEventId()` in ChatContext.tsx searches localStorage. This remains the primary resume path (fast, local). The server index is not needed for resume — it is needed for server-side queries like "already prepped?"

### How the server uses this for "already prepped?" checks

```typescript
function isEventAlreadyPrepped(userHash: string, eventId: string): boolean {
  const index = loadConversationIndex(userHash);
  return Object.values(index.entries).some(
    (entry) => entry.eventId === eventId && entry.messageCount > 0
  );
}
```

The horizon scanner calls this before generating a draft. If true, it skips the meeting (or marks the draft as "already discussed").

### Uniqueness assumptions and edge cases

| Case | Behavior |
|------|----------|
| Multiple conversations for same event | Valid. User preps from CalendarPage, then also clicks Discuss on DraftQueue. Both index entries have the same `eventId`. `isEventAlreadyPrepped()` returns true if any of them has `messageCount > 0`. |
| Missing eventId | Most conversations are general chat with no event link. `eventId` is undefined in the index. These entries are ignored by event-based queries. |
| Stale event links | An event may be canceled or moved after the conversation was created. The index retains the original `eventId`. This is acceptable — the link is historical context, not a live reference. The calendar API is the source of truth for event status. |
| eventId set after conversation creation | If the frontend adds `eventId` to an existing conversation (e.g., user links a general chat to an event), the next chat request will send the `eventId`. The index updates only if `entry.eventId` is undefined (no overwrite), so the first eventId wins. |

---

## 7. Immediate Benefits

### What this solves

1. **Server awareness of conversation entities.** The server can enumerate a user's conversations, sort by recency, and query by eventId. This is the prerequisite for every server-side continuity feature.

2. **Event-linked continuity support.** The horizon scanner can check `isEventAlreadyPrepped()` before generating a draft. CalendarPage-initiated and DraftQueue-initiated prep conversations are both visible to the server through the same index.

3. **Foundation for proactive checks.** Beyond "already prepped?", the index enables: "how many active conversations does this user have?", "which conversations are linked to events in the next 48 hours?", "which conversations have been idle for 7+ days?"

4. **Foundation for future summarization.** The index tracks `messageCount`, which tells the server when a conversation is large enough to benefit from summarization. Combined with `conversationId`, a summarization job can request the full message history from the frontend (via a new API) or generate a summary from memory entries linked to that conversation.

5. **Memory-conversation linkage.** Memory extraction already includes `conversationId` in the source metadata (when available). With the conversation index, the server can resolve that ID to a title, eventId, and threadBrief — enabling richer memory context like "you discussed this in your meeting prep for the Q1 review."

### What this does NOT solve

1. **No cross-device synced chat history.** Messages stay in localStorage. A user on a different device sees no conversations. The index contains metadata only.

2. **No full server-side conversation reconstruction.** The server cannot reconstruct a conversation from the index alone. It has titles, timestamps, and event links — not messages.

3. **No automatic summarization.** The index makes summarization possible but does not implement it. Summarization requires a separate design for: when to trigger, what to summarize, where to store summaries, and how to use them in context assembly.

4. **No server-side ownership of message content.** The frontend remains authoritative for messages. The server index is a derived projection, not a primary store.

---

## 8. File-by-File Plan

| File | Action | Purpose | Complexity | Notes |
|------|--------|---------|------------|-------|
| `src/agent/conversation-index.ts` | Create | ConversationIndex store: load, save, upsert, query by eventId, prune stale | Medium | ~150 lines. Follows memory-store.ts pattern. |
| `src/shared/chat.ts` | Modify | Add `ConversationIndexEntry` and `ConversationIndex` types | Low | ~20 lines |
| `src/services/api.ts` | Modify | Add `title` and `eventId` to `streamChat` metadata type | Low | 2 fields |
| `src/context/ChatContext.tsx` | Modify | Pass `title` and `eventId` from Conversation object in streamChat call | Low | ~5 lines |
| `server.ts` | Modify | Import conversation-index. On `/api/chat/stream`: extract metadata, upsert index entry. On `/api/chat/approve`: update index via RunRecord's conversationId. | Medium | ~40 lines |
| `src/agent/horizon-scanner.ts` | Modify | Add `isEventAlreadyPrepped()` check before draft generation | Low | ~10 lines |
| `src/agent/conversation-index.test.ts` | Create | Unit tests for index CRUD, event lookup, prune, edge cases | Medium | ~150 lines |

---

## 9. Persistence Design

### File path

```
DATA_DIR/.conversations.{userHash}.json
```

This follows the existing scoped data pattern used by:
- `.memory/{userHash}.json` (memory store)
- `.memory/{userHash}.embeddings.json` (embedding store)
- `.followup-state.{accountKey}.json` (followup tracker)

Using `userHash` (first 16 chars of SHA256 of email) rather than `accountKey` for consistency with the memory system. Both use the same user email as input.

### Per-user scoping

Each user has their own index file. The `userHash` is derived from the authenticated user's email via `getUserHash()` (same function used by memory-store.ts and memory-embeddings.ts).

### Atomic write pattern

Same as memory-store.ts:
```typescript
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
fs.renameSync(tmpPath, filePath);
```

Pretty-printed JSON (unlike the embedding file) because the conversation index is small — even at 500 conversations, each entry is ~200 bytes, totaling ~100 KB. Pretty-printing aids debuggability with negligible size overhead.

### Schema versioning

The `version: 1` field in `ConversationIndex` enables future schema migrations. On load, if `version` is missing or unexpected, the file is treated as corrupt and replaced with an empty index (no data loss — the index is derived, not authoritative).

### Load and cache

The index is loaded from disk at the start of each chat request and written back after update. No in-memory cache across requests (the file is small enough that read+parse is <1ms). This avoids stale cache issues when the server handles concurrent requests.

---

## 10. Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 1 | Index file created on first chat request | Send a chat message as a new user. Verify `.conversations.{userHash}.json` exists in DATA_DIR with one entry. |
| 2 | Index updated on subsequent requests | Send 3 messages in the same conversation. Verify `messageCount: 3` and `lastMessageAt` is the most recent request timestamp. |
| 3 | eventId stored correctly | Start a meeting prep conversation with `eventId`. Verify the index entry has the correct `eventId`. |
| 4 | Multiple conversations tracked | Send messages in 2 different conversations. Verify the index has 2 entries with distinct IDs. |
| 5 | No message text stored | Read the index file. Verify it contains only metadata fields (id, title, eventId, threadBrief summary, timestamps, counts). No `content`, `role`, or `blocks` fields. |
| 6 | threadBrief truncated to 500 chars | Send a chat request with a threadBrief longer than 500 characters. Verify the stored value is exactly 500 chars. |
| 7 | Persistence across server restart | Create index entries. Restart the dev server. Verify the index file persists and loads correctly. |
| 8 | Safe behavior when metadata missing | Send a chat request without `conversationId`. Verify no index entry is created and no error is thrown. |
| 9 | eventId not overwritten | Create an index entry with `eventId: 'event-1'`. Send a subsequent request with `eventId: 'event-2'`. Verify the entry still has `eventId: 'event-1'`. |
| 10 | title not overwritten | Create an entry with `title: 'Meeting Prep'`. Send a request with `title: 'New Title'`. Verify title remains 'Meeting Prep'. |
| 11 | Approval updates index | Approve a write action. Verify the conversation's `lastMessageAt` and `messageCount` are updated. |
| 12 | isEventAlreadyPrepped returns true | Create a conversation linked to event-1 with messageCount > 0. Call `isEventAlreadyPrepped(userHash, 'event-1')`. Verify it returns true. |
| 13 | isEventAlreadyPrepped returns false for unknown event | Call `isEventAlreadyPrepped(userHash, 'event-unknown')`. Verify it returns false. |
| 14 | No breakage to existing frontend flow | Run the app. Create conversations, send messages, resume meeting prep. Verify all existing behavior works unchanged. |

---

## 11. Risks and Constraints

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Duplicated state between frontend and backend | Medium | The index is explicitly a derived projection. The frontend remains authoritative. The server never creates or deletes conversations — it only observes. |
| Conflicting source of truth | Medium | The index stores a subset of fields (title, eventId, threadBrief) that the frontend also stores. The server's copy may lag behind the frontend. This is acceptable because server consumers (horizon scanner, memory linkage) need approximate metadata, not authoritative records. |
| Storing too much user data on server | Low | The index stores only metadata: IDs, timestamps, a title, and a truncated brief. No message content. At 500 conversations with full metadata, the file is ~100 KB. |
| messageCount drift | Low | The server counts chat requests, not frontend messages. Local-only messages (errors, UI state) are not counted. The drift is bounded and the field is used for rough estimation. |
| Premature expansion into full conversation storage | Medium | The schema explicitly excludes message content. The `ConversationIndexEntry` type has no `messages` field. Adding one later would require a deliberate schema version bump and a new design decision. |

### How the design avoids these risks

1. **Metadata-only schema.** The type definition excludes message content. This is a structural constraint, not a guideline.
2. **No server-initiated mutations.** The server never creates conversations, never changes titles authoritatively, never deletes entries. It only appends and updates timestamps.
3. **Derived, not authoritative.** If the index is deleted, nothing breaks. The frontend still works. The server loses its metadata projection and will rebuild it incrementally as new chat requests arrive.
4. **Small file, simple format.** JSON with atomic writes. No database dependency. Debuggable with `cat`.

---

## 12. Future Compatibility

### Conversation summarization

The index tracks `messageCount`. A summarization system can query: "which conversations have messageCount > 20 and no summary?" It can then request message history (via a new frontend→server API or by having the frontend include a summary in the next chat request) and store the summary alongside the index or in a separate file. The index provides the trigger signal; the summarization logic is a separate concern.

### "Already prepped?" proactive checks

Implemented directly by `isEventAlreadyPrepped()` querying the index. The horizon scanner calls this before generating a draft. No additional infrastructure needed beyond the index itself.

### Conversation-scoped memory

Currently, all memories are global per-user. With the conversation index, a future improvement could add `conversationId` filtering to `retrieveMemories()`: "show me memories from the conversation about the Q1 review." The index resolves the conversationId to a title and context, making the scoped retrieval meaningful.

### Better threadBrief evolution

The `StructuredThreadBrief` type exists but the frontend does not produce it yet. When it does, the index can store the `type` and `entityId` fields alongside the summary string, enabling richer server-side queries: "find all meeting_prep conversations for events in the next week."

### Cross-conversation continuity

The index enables queries like: "what conversations has this user had about project X?" — by searching titles and threadBrief summaries. Combined with memory-conversation linkage (memory entries with `source.conversationId`), the server can build a rough timeline of the user's work across conversations. This is a future feature, not part of this slice.

---

## 13. Final Recommendation

### First implementation slice: Core index with event lookup

**Goal:** Create the conversation index store, wire it into `/api/chat/stream` and `/api/chat/approve`, extend the frontend to send `title` and `eventId` in chat requests, and implement `isEventAlreadyPrepped()`.

**Files:** `src/agent/conversation-index.ts` (create), `src/shared/chat.ts` (modify), `src/services/api.ts` (modify), `src/context/ChatContext.tsx` (modify), `server.ts` (modify), `src/agent/conversation-index.test.ts` (create).

**Scope:** Acceptance criteria 1-14 all pass. The horizon scanner has a working "already prepped?" check.

### Second slice: Memory-conversation linkage

**Goal:** When memory entries are extracted during a chat turn, include the `conversationId` in the memory source metadata. When the retriever formats memories for prompt injection, resolve the conversationId to a title via the index, enabling context like "from your meeting prep for Q1 review."

**Files:** `src/agent/memory/memory-extractor.ts` (modify source metadata), `src/agent/memory/memory-retriever.ts` (modify prompt formatting), `src/agent/conversation-index.ts` (add `getConversationTitle()` lookup).

### Why this sequence

The first slice is pure infrastructure: create the index, populate it, verify it works. It has no user-visible behavior change except the "already prepped?" check in the horizon scanner — a concrete, testable improvement that justifies the index's existence.

The second slice uses the index to improve agent response quality: memories become conversation-aware, and the agent can reference prior conversations by name. This builds on the index without requiring any additional persistence or API changes.

Both slices are small, independently testable, and low risk. The index is derived (deletable without data loss), the schema is narrow (no messages), and the update flow piggybacks on existing chat request handling. No new endpoints, no new databases, no competing sources of truth.
