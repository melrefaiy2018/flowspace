# Phase 3 Implementation Memo — Embedding Retrieval

> Date: 2026-04-12
> Status: Implemented (commit 3087361 on branch 005-harness-improvements)
> Design spike: [phase3-design-spike.md](./phase3-design-spike.md)
> Harness overview: [harness-overview.md](./harness-overview.md)

---

## What was implemented

Embedding-based memory retrieval for FlowSpace. The agent can now recall memories using semantic similarity when the user's active LLM provider supports embeddings (OpenAI, OpenRouter). All other providers fall back to keyword-only retrieval with no regression.

---

## Embedding retrieval behavior

### How it works

1. **On memory creation:** When a tool executes successfully and memory is extracted, the harness checks `supportsEmbeddings()`. If true, it calls the provider's embedding endpoint with the memory's content + tags and stores the resulting 1536-dim vector in a separate embedding file.

2. **On retrieval:** When the user sends a message, the harness embeds the query once, loads the embedding file, and scores every memory using cosine similarity (50% weight) blended with keyword/tag/recency/access signals (50% combined). Memories without embeddings use keyword-only scoring.

3. **On lazy migration:** After selecting the top-N memories, any selected memory without an embedding gets one computed on the fly (up to 5 per retrieval call). This gradually populates the embedding file without a batch migration.

### Provider strategy

| Provider | Embedding model | Behavior |
|----------|----------------|----------|
| OpenAI | `text-embedding-3-small` | Full embedding retrieval |
| OpenRouter | `text-embedding-3-small` (proxied) | Full embedding retrieval |
| Anthropic | None | Keyword-only retrieval |
| Claude Code | None | Keyword-only retrieval |
| LM Studio | None | Keyword-only retrieval |
| Codex | None | Keyword-only retrieval |

The check is in `supportsEmbeddings()` in `memory-embeddings.ts`. It reads the active provider config and returns true only for `openai` and `openrouter`.

### Provider switching

The embedding file stores a `model` field in its header. On load, the stored model is compared against `getEmbeddingModel()`. If they differ (provider changed, or model updated), all cached embeddings are treated as invalid — `loadEmbeddings()` returns `{}`. Lazy migration recomputes them as memories are accessed.

Embeddings are never deleted from disk on switch. They are ignored and overwritten incrementally.

### Storage

| File | Format | Max size | Write pattern |
|------|--------|----------|--------------|
| `.memory/{userHash}.json` | Pretty-printed JSON | ~400 KB at 500 entries | Atomic (temp+rename), batched per turn |
| `.memory/{userHash}.embeddings.json` | Compact JSON (no pretty-print) | ~9 MB at 500 entries | Atomic (temp+rename), batched per turn |

The embedding file is loaded once per retrieval (at the start of `handleChat`), not on every memory write. Embedding saves accumulate in memory and flush once at the end of the chat turn via `beginEmbeddingBatch()`/`flushEmbeddingBatch()`.

---

## Remaining continuity gaps

### What works now

| Capability | Mechanism | Scope |
|-----------|-----------|-------|
| Memory persists across sessions | Server-side `.memory/{userHash}.json` | Per-user, survives server restart |
| Embeddings persist across sessions | Server-side `.embeddings.json` | Per-user, survives server restart |
| Draft context indexed into memory | `mergeMemory()` in horizon-scanner.ts | Per-draft linked docs and emails |
| Draft discussions link to events | `eventId` on conversation | Resume via CalendarPage |
| Conversations survive browser refresh | `localStorage` per-user key | Single browser only |

### What is still missing

| Gap | Impact | Blocker |
|-----|--------|---------|
| Server has no conversation index | Cannot check "already prepped?" or reference past conversations | Requires architectural decision on server-side conversation state |
| Conversations are browser-local | Lost on device/browser switch | Requires server-side conversation storage or sync |
| No conversation summarization | Long conversations use full message history (truncated at 100K) | Requires conversation index + summarization strategy |
| threadBrief is the only continuity bridge to server | Free-text string, set once on creation, rarely updated | StructuredThreadBrief type exists but frontend does not produce it yet |
| Memory has no conversation-level scope | All memories are global per-user, not per-conversation | Would require `conversationId` in memory source + scoped retrieval |

### Recommended next continuity improvement

**Server-side conversation index.** This is the single highest-leverage continuity improvement remaining. A lightweight index (not full message storage) would enable:
- Horizon scanner checks "has this meeting been prepped?"
- Memory source includes `conversationId` for "you discussed X in conversation Y"
- Future: server-initiated summarization

The index should be updated as a side effect of `/api/chat/stream` requests (the frontend already sends `conversationId`). It should store: `{ id, title, eventId, threadBrief (summary only), lastMessageAt, messageCount }` per conversation. The frontend remains the source of truth for message content.

---

## Acceptance criteria for the next harness improvement slice

### If the next slice is server-side conversation index:

| Criterion | Test |
|-----------|------|
| Index file created on first chat request | Send a chat message. Verify `.conversations.{userHash}.json` exists in DATA_DIR. |
| Index updated on each chat request | Send 3 messages across 2 conversations. Verify index has 2 entries with correct `lastMessageAt` and `messageCount`. |
| eventId linkage in index | Start a meeting prep conversation. Verify the index entry has the calendar `eventId`. |
| Horizon scanner reads index | Generate a draft for a meeting that was already prepped. Verify scanner can detect the existing conversation. |
| Index does not store message content | Read the index file. Verify it contains only metadata, not message text. |
| Index survives server restart | Restart dev server. Verify index file persists and loads correctly. |

### If the next slice is StructuredThreadBrief on frontend:

| Criterion | Test |
|-----------|------|
| Meeting prep creates structured brief | Start meeting prep from CalendarPage. Verify `threadBrief` in localStorage is JSON with `type: 'meeting_prep'` and `entityId`. |
| Email thread creates structured brief | Open an email discussion. Verify `threadBrief` has `type: 'email_thread'`. |
| Legacy string briefs still work | Open an existing conversation with a plain string `threadBrief`. Verify it loads and renders correctly. |
| Context assembler renders structured brief | Verify system prompt includes structured metadata (attendees, time) not just raw text. |

### If the next slice is conversation summarization:

| Criterion | Test |
|-----------|------|
| Summary generated after N messages | Send 20+ messages. Verify a summary is generated and stored. |
| Summary replaces old messages in context | Verify the LLM receives the summary + recent messages, not all 20+. |
| Summary preserves key facts | Verify the summary mentions tool results, decisions, and key entities from the conversation. |
| Token usage decreases | Compare token estimates before and after summarization for the same conversation length. |

---

## Files involved in Phase 3

| File | Lines | Role |
|------|-------|------|
| `src/agent/memory/memory-embeddings.ts` | 287 | Embedding computation, file I/O, provider detection, batch support |
| `src/agent/memory/memory-retriever.ts` | 249 | Dual-path scoring, lazy migration, async retrieval |
| `src/agent/chat.ts` | 641 | Embedding store init, load, save, batch wiring, context truncation |
| `src/agent/context-assembler.ts` | 182 | MAX_CONTEXT_TOKENS, truncateMessages (now wired) |
| `src/agent/memory/__tests__/memory-embeddings.test.ts` | 446 | Embedding module tests |
| `src/agent/memory/__tests__/memory-retriever.test.ts` | 200+ | Retriever tests including embedding scoring and fallback |

---

## Decisions made (from design spike)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding provider | Tiered: use when available, keyword fallback | Preserves portability, no forced OpenAI dependency |
| Storage | Separate `.embeddings.json` per user | Main memory stays fast (<15ms); embedding file loaded on-demand |
| threadBriefSuggestion | Deferred | Generation logic too weak; low payoff for Phase 3 |
| Context budget | 100K tokens, wire truncateMessages | Minimal protective measure; per-provider limits deferred |

---

## What to monitor after shipping

1. **Embedding API latency**: `computeEmbedding()` adds ~100ms per call. Query embedding happens once per chat turn. Lazy migration adds up to 5 calls. Monitor whether this noticeably delays `assistant_begin` events.

2. **Embedding file size**: At 500 entries with 1536-dim vectors, the file reaches ~9MB. Monitor actual user file sizes. If any user exceeds 10MB, consider binary storage or a vector-specific format.

3. **Retrieval quality**: Log when embedding-scored top-5 differs from keyword-only top-5 for the same query. This measures how often embeddings change the result vs. confirming keyword matches.

4. **Provider distribution**: Track which providers users are on. If >70% are on Anthropic (no embeddings), the local embedding fallback becomes higher priority.

5. **Lazy migration completion**: Track how many retrieval calls trigger lazy embedding computation. Once a user's embedding file is fully populated, lazy migration calls should drop to zero.
