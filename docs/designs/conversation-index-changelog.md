# Conversation Index — Implementation Changelog

> Date: 2026-04-12
> Branch: 005-harness-improvements
> Design: [conversation-index-memo.md](./conversation-index-memo.md)

---

## What was implemented

A metadata-only server-side conversation index that gives the backend awareness of conversation entities without storing message content. Two slices shipped together: the core index with event lookup, and memory-conversation linkage.

---

## New files

### `src/agent/conversation-index.ts` (150 lines)

The core store module. Persists to `DATA_DIR/.conversations.{userHash}.json`.

**Types:**
- `ConversationIndexEntry` — id, lastMessageAt, messageCount (required); title, eventId, threadBrief, createdAt, origin (optional)
- `ConversationIndex` — `{ version: 1, entries: Record<string, ConversationIndexEntry> }`
- `ConversationUpdate` — input type for upsert (id required, all other fields optional)
- `ConversationOrigin` — `'chat' | 'meeting_prep' | 'draft_discuss' | 'action_trigger'`

**Functions:**
- `loadConversationIndex(userHash)` — reads JSON from disk; returns empty index if file missing or version mismatch
- `saveConversationIndex(userHash, index)` — atomic write (temp + rename), pretty-printed JSON
- `upsertConversation(userHash, update)` — creates or updates index entry. First-value-wins for title and eventId (never overwritten once set). threadBrief truncated to 500 chars. messageCount incremented on each call. Skips if id is empty.
- `isEventAlreadyPrepped(userHash, eventId)` — returns true if any entry has matching eventId with messageCount > 0
- `getConversationTitle(userHash, conversationId)` — returns title string or undefined

### `src/agent/__tests__/conversation-index.test.ts` (314 lines)

13 test cases:
- Load returns empty index when file doesn't exist
- Upsert creates new entry with all fields
- Upsert increments messageCount and updates lastMessageAt
- Upsert does NOT overwrite existing title
- Upsert does NOT overwrite existing eventId
- Upsert truncates threadBrief to 500 chars
- Upsert skips empty id
- isEventAlreadyPrepped returns true for known event
- isEventAlreadyPrepped returns false for unknown event
- isEventAlreadyPrepped returns false for event with messageCount 0
- isEventAlreadyPrepped returns false for empty index
- getConversationTitle returns title / undefined / handles no-title
- Persistence across load/save cycles

---

## Modified files

### `server.ts` (+46 lines)

**`/api/chat/stream` endpoint:**
- Now extracts `title` and `eventId` from the request body (new fields sent by frontend)
- Computes `userHash` from authenticated user email
- Calls `upsertConversation(userHash, { id, title, eventId, threadBrief, origin })` best-effort (wrapped in try/catch, never blocks chat)
- Passes `conversationId` to `handleChat()` options (new field)
- `deriveOrigin()` helper: if eventId present → `'meeting_prep'`, if threadBrief contains "meeting" → `'meeting_prep'`, else → `'chat'`

**`/api/chat/approve` endpoint:**
- Looks up `conversationId` from the RunRecord
- Calls `upsertConversation(userHash, { id })` to increment messageCount
- Passes `conversationId` to `executeApprovedAction()` options

### `src/services/api.ts` (+4 lines)

- `streamChat` metadata type extended: `title?: string` and `eventId?: string`
- Both fields forwarded in the request body to `/api/chat/stream`

### `src/context/ChatContext.tsx` (+6 lines)

- `streamAssistantResponse` payload type extended with `title?: string` and `eventId?: string`
- These are passed through to `api.streamChat()` metadata
- `sendMessage()` now passes `title: existingConv?.title` and `eventId: options?.eventId ?? existingConv?.eventId` in the stream payload

### `src/agent/chat.ts` (+9 lines, -4 lines)

- `HandleChatOptions` interface now includes `conversationId?: string`
- `assembleContext()` call now passes `userHash` (computed from userEmail)
- Three `extractFromToolResult()` call sites now pass `conversationId: options.conversationId`:
  - In the tool loop (line 315) for read tool memory extraction
  - In `executeApprovedAction()` (line 463) for approved write tool extraction
  - In dynamic tool resume step loop (line 577) for remaining step extraction

### `src/agent/memory/memory-extractor.ts` (+15 lines)

- `ToolResultInfo` interface extended with `conversationId?: string`
- New `withConversationId()` helper: maps over extracted memories and injects `conversationId` into each memory's `source` object
- `extractFromToolResult()` wraps its return value through `withConversationId()` so every extracted memory carries the conversation context

### `src/agent/memory/memory-retriever.ts` (+19 lines)

- `formatMemoriesForPrompt()` now accepts optional `userHash` parameter
- When formatting a memory for the system prompt, if `source.conversationId` exists and `userHash` is available, looks up the conversation title via `getConversationTitle()`
- If found, appends `(from conversation: {title})` to the memory content in the prompt
- Example: `[RESOURCE] Q1 Revenue Tracker (from conversation: Meeting Prep — Q1 Review)`
- Failure is non-fatal (try/catch)

### `src/agent/context-assembler.ts` (+5 lines)

- `AssembleContextOptions` now includes `userHash?: string`
- `buildSystemPrompt()` accepts and threads `userHash` through to `formatMemoriesForPrompt()`
- `assembleContext()` passes `options.userHash` to `buildSystemPrompt()`

### `src/shared/chat.ts` (+2 lines)

- Re-exports conversation index types: `ConversationIndexEntry`, `ConversationIndex`, `ConversationOrigin`, `ConversationUpdate`
- Makes types available to server.ts and any shared consumer

### `src/agent/horizon-scanner.ts` (+11 lines)

- Imports `isEventAlreadyPrepped` from conversation-index
- Computes `userHashForIndex` from `userEmail` once before the meeting loop
- Before generating a draft for each meeting, checks `isEventAlreadyPrepped(userHashForIndex, meeting.id)`
- If true, logs and skips: `[horizon-scanner] Skipping already-prepped meeting: {title}`

---

## Data flow summary

```
User sends message
    |
    v
ChatContext.tsx sendMessage()
    |  passes: conversationId, title, eventId, threadBrief
    v
api.streamChat() → POST /api/chat/stream
    |  body: { messages, tz, conversationId, sourceMessageId,
    |          threadBrief, title, eventId }
    v
server.ts endpoint handler
    |  1. upsertConversation(userHash, { id, title, eventId, threadBrief, origin })
    |     → loads .conversations.{userHash}.json
    |     → creates or updates entry (first-value-wins for title/eventId)
    |     → saves to disk (atomic write)
    |  2. handleChat(messages, { conversationId, ... })
    v
chat.ts handleChat()
    |  tool loop → extractFromToolResult({ ..., conversationId })
    |               → memory source includes conversationId
    v
memory-retriever.ts formatMemoriesForPrompt(memories, userHash)
    |  for each memory with source.conversationId:
    |    → getConversationTitle(userHash, conversationId)
    |    → appends "(from conversation: {title})" to prompt text
    v
context-assembler.ts buildSystemPrompt()
    |  memories with conversation context in the system prompt
    v
LLM sees: "[RESOURCE] Q1 Tracker (from conversation: Meeting Prep — Q1 Review)"
```

---

## What this enables

| Capability | How |
|-----------|-----|
| Server knows conversations exist | Index file persists per-user with metadata |
| "Already prepped?" check | `isEventAlreadyPrepped()` in horizon scanner |
| Event → conversation lookup | Query index entries by eventId |
| Memory-conversation linkage | Extracted memories carry conversationId in source |
| Conversation-aware prompts | Retriever resolves conversationId to title in formatted memories |
| Foundation for summarization | Index tracks messageCount for size-based triggers |

## What this does NOT do

| Limitation | Why |
|-----------|-----|
| No message content on server | By design — metadata only |
| No cross-device sync | Index has metadata, not messages |
| No automatic summarization | Requires separate design for trigger/storage/usage |
| No index cleanup/pruning | Stale entries are harmless; pruning deferred |
