# FlowSpace Memory System — Engineering Plan

> **Status**: Approved (CEO Review + Eng Review, 2026-03-17)
> **Mode**: EXPANSION → BIG CHANGE
> **Branch**: `codex/multi-account-google-isolation`
> **Base**: `main`
> **Eng Review**: 10 decisions resolved, 0 critical gaps

---

## Problem Statement

When the user chats with the AI agent about tracking job emails in a spreadsheet, the agent creates the spreadsheet. But in the next message (or a new conversation), the agent doesn't remember:

- That a spreadsheet was created
- What its ID/URL is
- What structure it has
- What the user's ongoing workflow is

The user must re-explain everything every time. This makes the agent feel stateless and dumb.

### Existing (Insufficient) Memory Mechanisms

| Mechanism | What It Does | Why It Fails |
|-----------|-------------|--------------|
| `threadBrief` (manual) | User types a text blurb per conversation, injected into system prompt | Manual — user must write it. Doesn't auto-capture IDs, schemas, workflows. |
| `dynamic-tool-registry` | Persists user-created composite tools to disk | Remembers *tools*, not *context* (spreadsheet IDs, data schemas, workflows) |
| Conversation history (localStorage) | Full message history per conversation | Siloed per conversation. Cross-conversation recall = zero. Context window limits mean older messages get dropped. |

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FLOWSPACE MEMORY SYSTEM                         │
│                                                                          │
│  FRONTEND (React)                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                  │    │
│  │  ChatContext ──── sendMessage() ──────────────────▶ /api/chat   │    │
│  │       │                                             /stream     │    │
│  │       │          ┌──────────────────────┐                       │    │
│  │       └────────▶ │ Memory Sidebar (new) │ ◀── /api/memory/*    │    │
│  │                  │ - View memories       │                       │    │
│  │                  │ - Edit/delete          │                       │    │
│  │                  │ - "Remember this" btn  │                       │    │
│  │                  └──────────────────────┘                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  BACKEND (Express server.ts)                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                  │    │
│  │  /api/chat/stream                                                │    │
│  │       │                                                          │    │
│  │       ▼                                                          │    │
│  │  handleChat(opts: HandleChatOptions)  ← userEmail added           │    │
│  │       │                                                          │    │
│  │       ├──▶ BEFORE LLM call:                                     │    │
│  │       │    retrieveMemories(userMessage, userEmail)              │    │
│  │       │    → inject into system prompt                           │    │
│  │       │                                                          │    │
│  │       ├──▶ DURING: tool-calling loop + save_memory/search_memory│    │
│  │       │                                                          │    │
│  │       ├──▶ AFTER tool results (BOTH read AND write tools):      │    │
│  │       │    extractMemoriesFromToolResult(toolName, args, result) │    │
│  │       │    → rule-based extraction → store to memory             │    │
│  │       │                                                          │    │
│  │       └──▶ AFTER approval (executeApprovedAction):              │    │
│  │            extractMemoriesFromToolResult(toolName, args, result) │    │
│  │            → second extraction site for write tools              │    │
│  │                                                                  │    │
│  │  /api/memory (new endpoints)                                     │    │
│  │       ├── GET  /api/memory          → list memories             │    │
│  │       ├── POST /api/memory          → create (explicit save)    │    │
│  │       ├── PUT  /api/memory/:id      → update                    │    │
│  │       ├── DEL  /api/memory/:id      → delete                    │    │
│  │       └── POST /api/memory/search   → search memories            │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────┐            │    │
│  │  │  src/agent/memory/ (new module)                  │            │    │
│  │  │                                                  │            │    │
│  │  │  memory-store.ts     → CRUD + disk (atomic .tmp) │            │    │
│  │  │  memory-extractor.ts → Rule-based extraction    │            │    │
│  │  │  memory-retriever.ts → Search + rank + select   │            │    │
│  │  │  memory-types.ts     → TypeScript interfaces     │            │    │
│  │  └─────────────────────────────────────────────────┘            │    │
│  │                                                                  │    │
│  │  STORAGE: DATA_DIR/.memory/{userHash}.json                      │    │
│  │  (per-user, JSON, same pattern as dynamic-tool-registry)        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Dependency Graph (Before → After)

```
BEFORE:
  handleChat() → buildSystemPrompt() → [threadBrief only]
                → executeTool() → [results discarded after LLM sees them]

AFTER:
  server.ts: getActiveStoredAccount()?.email ──▶ handleChat(opts: { userEmail })
                                                      │
  handleChat() → retrieveMemories(msg, userEmail)     │
              → buildSystemPrompt(threadBrief, memories)
              → executeTool() ──▶ extractMemoriesFromToolResult() → memoryStore.save()
              → save_memory tool ──▶ memoryStore.create() (explicit user save)
              → search_memory tool ──▶ memoryStore.search() (on-demand query)
              │
  executeApprovedAction() ──▶ extractMemoriesFromToolResult() → memoryStore.save()
                                                                         │
  /api/memory/* → memoryStore.* ◀──────────────────────────────────────┘
```

---

## Memory Schema

```typescript
// src/agent/memory/memory-types.ts

export type MemoryCategory = 'resource' | 'workflow' | 'preference' | 'fact';

export interface MemorySource {
  type: 'auto_extraction' | 'llm_extraction' | 'explicit_user';
  conversationId?: string;
  toolName?: string;
  messageId?: string;
}

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;                    // Human-readable summary
  tags: string[];                     // Keywords for retrieval
  metadata: Record<string, unknown>;  // Structured data (spreadsheetId, url, columns, etc.)
  resourceIds?: string[];             // Google resource IDs for dedup + staleness detection
  source: MemorySource;
  stale?: boolean;                    // Marked when referenced resource returns 404
  embedding?: number[];               // Phase 2: vector embedding for semantic search
  createdAt: string;                  // ISO 8601
  updatedAt: string;                  // ISO 8601
  lastAccessedAt: string;             // ISO 8601, updated ONLY when agent references memory
  accessCount: number;                // Incremented ONLY when agent actually uses memory
}

export interface MemoryFile {
  version: 1;
  entries: MemoryEntry[];
}

export interface RetrievedMemory {
  entry: MemoryEntry;
  relevanceScore: number;             // 0-1, used for ranking
}
```

### Memory Categories

| Category | Examples | Extraction Source |
|----------|----------|-------------------|
| `resource` | Spreadsheets, Docs, Drive folders (with IDs, URLs, schemas) | Rule-based from tool results |
| `workflow` | "User tracks job applications by email → spreadsheet" | LLM extraction |
| `preference` | "User likes standups in bullet format" | Explicit "remember" command or LLM |
| `fact` | "Alice is PM on Project X", "Weekly standup is Mondays 10am" | LLM extraction |

---

## Extraction Strategy (Hybrid)

### Path 1: Rule-Based (automatic, free, deterministic)

Triggered after every successful tool execution. Each tool type has a specific extractor:

```
sheets_create → {
  category: "resource",
  content: "Job Applications spreadsheet",
  metadata: { spreadsheetId: "abc123", url: "...", columns: [...] },
  tags: ["spreadsheet", "job", "applications", "tracker"]
}

send_email → {
  category: "fact",
  content: "Sent follow-up to recruiter@amazon.com about SDE II",
  tags: ["email", "amazon", "job", "follow-up"]
}

create_calendar_event → {
  category: "fact",
  content: "Created 'Weekly standup' event on Mondays 10am",
  tags: ["calendar", "standup", "weekly", "monday"]
}
```

### Path 2: Agent Tools (save_memory + search_memory)

Two new tools added to the agent's tool set (in `tools.ts`):

**`save_memory` tool:**
```typescript
{
  name: "save_memory",
  description: "Save information to long-term memory for future conversations",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "What to remember" },
      category: { type: "string", enum: ["resource", "workflow", "preference", "fact"] },
      tags: { type: "array", items: { type: "string" } }
    },
    required: ["content", "category", "tags"]
  }
}
```

Triggered naturally by the LLM when user says "remember that..." — no keyword detection needed. The LLM decides when to call it, just like any other tool. Source: `explicit_user`.

**`search_memory` tool:**
```typescript
{
  name: "search_memory",
  description: "Search long-term memory for previously stored information",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for" }
    },
    required: ["query"]
  }
}
```

Triggered when user asks "what spreadsheets have I created?" or similar. Returns matching memories for the LLM to incorporate into its response.

**Why tools instead of keyword detection + separate LLM pipeline:**
- Fits the existing tool-calling architecture perfectly
- No new `memory-llm.ts` file needed (removes ~80 lines)
- LLM naturally chooses when to save/search — no brittle regex
- Both tools execute inside the existing tool-calling loop

---

## Retrieval Strategy

### Pipeline

```
USER MESSAGE: "add this Amazon email to my tracker"

1. Extract keywords: ["amazon", "email", "tracker", "add"]
2. Search memory by:
   a. Tag intersection (keyword ∩ tags)
   b. Category priority (resource > workflow > preference > fact)
   c. Recency weighting (lastAccessedAt)
   d. Access frequency (accessCount — popular memories rank higher)
   e. Exclude stale memories (deprioritize, don't eliminate)
3. Select top-K memories (K=5, capped by token budget ~800 tokens)
4. Inject into system prompt as structured context
5. AFTER response: update lastAccessedAt/accessCount ONLY for memories
   the agent actually referenced (checked via memoriesUsed in response)
```

### System Prompt Injection Format

```
Your memories about this user:

[RESOURCE] Job Applications spreadsheet
ID: abc123 | URL: https://docs.google.com/...
Columns: Company, Role, Date, Status, Notes
Last used: 2 days ago

[WORKFLOW] User tracks job applications by searching emails,
extracting company + role, and appending to the tracker.

[PREFERENCE] Default status for new applications: "Applied"
```

---

## Stale Memory Handling

When a tool call references a resource ID from memory and gets a 404:

1. Mark the memory as `stale: true`
2. Deprioritize in retrieval (lower relevance score)
3. Keep visible in Memory Sidebar for user to manage
4. Agent explains to user: "Your Job Applications spreadsheet seems to have been deleted. Want me to create a new one?"

---

## UI Components

### Memory Sidebar

- Accessible from the chat panel (toggle button)
- Shows all memories grouped by category
- Each memory entry is editable and deletable
- Shows metadata (created, last accessed, access count)
- Stale memories shown with a warning indicator

### Memory Trace (on chat messages)

After each agent response, show a subtle indicator:

```
┌──────────────────────────────────────────┐
│ Agent: Added Amazon SDE II to your       │
│ Job Applications tracker.                │
│                                          │
│ 🧠 Used 3 memories                      │
│   • Job Applications spreadsheet (abc123)│
│   • Workflow: email → extract → append   │
│   • Preference: default status "Applied" │
└──────────────────────────────────────────┘
```

### Auto-ThreadBrief

When the agent creates or modifies a resource, automatically update the conversation's `threadBrief` with context like:
```
This thread tracks Job Applications in spreadsheet abc123.
```
Still user-editable. Bridges existing threadBrief mechanism with memory.

### Memory-Powered Suggestions

`[SUGGEST: ...]` buttons reference known resources:
- Instead of "Create a spreadsheet" → "Update Job Applications tracker"
- Instead of "Search emails" → "Check for new job-related emails"

---

## File Structure

### New Files (~740 lines)

```
src/agent/memory/
  ├── memory-types.ts       (~50 lines)  — interfaces + MemoryFile schema
  ├── memory-store.ts       (~180 lines) — CRUD + atomic disk writes (.tmp → rename)
  │                                        Follows dynamic-tool-registry FileIO pattern
  │                                        Deduplication: merge by resourceId
  ├── memory-extractor.ts   (~190 lines) — rule-based extraction per tool type
  ├── memory-retriever.ts   (~140 lines) — search, rank, token-budget selection
  └── __tests__/
      ├── memory-store.test.ts       — CRUD, corrupt file, empty, 500-cap, atomic writes, dedup
      ├── memory-extractor.test.ts   — each tool type, error results, unknown tools
      ├── memory-retriever.test.ts   — keyword matching, ranking, token budget, no matches
      ├── memory-tools.test.ts       — save_memory/search_memory tool execute functions
      ├── chat-memory.test.ts        — integration: retrieval→injection→extraction in handleChat
      └── memory-api.test.ts         — /api/memory/* endpoint integration tests

src/components/
  └── MemorySidebar.tsx     (~150 lines) — memory management UI
```

**Removed from original plan:** `memory-llm.ts` (~80 lines) — replaced by `save_memory` + `search_memory` tools that leverage the existing tool-calling architecture.

### Modified Files (~150 lines changed)

| File | Changes |
|------|---------|
| `src/agent/chat.ts` | Add `userEmail` to `HandleChatOptions`. Add `retrieveMemories()` before LLM. Extract after tool results (both read and write). Extract in `executeApprovedAction()`. Add `memoriesUsed` to `AssistantPayload`. (~60 lines) |
| `src/agent/tools.ts` | Add `save_memory` + `search_memory` tool definitions + execute functions (~40 lines) |
| `shared/chat.ts` | Add `memoriesUsed?: { id: string; content: string; category: string }[]` to `AssistantPayload` (~5 lines) |
| `server.ts` | Pass `userEmail: getActiveStoredAccount()?.email` to handleChat. Add `/api/memory/*` endpoint block (~60 lines) |
| `src/App.tsx` | Mount MemorySidebar, pass memory trace to chat UI (~20 lines) |

### Tests (~600 lines)

| Test File | Covers |
|-----------|--------|
| `memory-store.test.ts` | CRUD, corrupt file, empty file, 500-entry cap, atomic writes (.tmp), merge-by-resourceId dedup |
| `memory-extractor.test.ts` | Each tool type, error results, unknown tools, empty results |
| `memory-retriever.test.ts` | Keyword matching, ranking, token budget, no matches, stale deprioritization |
| `memory-tools.test.ts` | save_memory execute, search_memory execute, edge cases (empty content, no results) |
| `chat-memory.test.ts` | Integration: retrieval→prompt injection→tool extraction→access tracking on usage |
| `memory-api.test.ts` | GET/POST/PUT/DELETE /api/memory endpoints, auth, validation |

---

## Component Boundaries

| Component | Responsibility | Touches Existing Code? |
|---|---|---|
| `memory-types.ts` | TypeScript interfaces + MemoryFile | No (new) |
| `memory-store.ts` | CRUD, atomic disk writes, per-user isolation, merge-by-resourceId dedup | No (new, follows `dynamic-tool-registry` FileIO pattern) |
| `memory-extractor.ts` | Rule-based extraction from tool results | No (new) |
| `memory-retriever.ts` | Search, rank, token-budget selection | No (new) |
| `tools.ts` | `save_memory` + `search_memory` tool definitions | **Yes** — add 2 new tools |
| `chat.ts` | Inject memories, extract after tools, `memoriesUsed` on response | **Yes** — modify `handleChat()`, `buildSystemPrompt()`, `executeApprovedAction()` |
| `shared/chat.ts` | `memoriesUsed` field on `AssistantPayload` | **Yes** — add field to type |
| `server.ts` | `/api/memory/*` endpoints, pass `userEmail` | **Yes** — add route block + modify chat endpoint |
| `MemorySidebar.tsx` | Memory management UI | **Yes** — add to `App.tsx` |

---

## Error & Rescue Registry

```
METHOD                    | EXCEPTION             | RESCUED? | ACTION              | USER SEES
--------------------------|----------------------|----------|---------------------|-------------------
memoryStore.load()        | JSON.SyntaxError     | Y        | Return [], log warn | Nothing
memoryStore.load()        | EACCES               | Y        | Return [], log err  | Nothing
memoryStore.save()        | ENOSPC/EACCES        | Y        | Log error, skip     | "Memory save failed"
memoryStore.save()        | Write race            | Y        | Atomic write (.tmp) | Nothing
memoryStore.merge()       | Dup resourceId        | Y        | Merge fields        | Nothing
extractFromToolResult()   | TypeError             | Y        | Skip, log           | Nothing
extractFromToolResult()   | JSON.SyntaxError     | Y        | Skip, log           | Nothing
save_memory tool          | Invalid category     | Y        | Return error msg    | Agent explains
save_memory tool          | Empty content        | Y        | Return error msg    | Agent explains
search_memory tool        | Empty query          | Y        | Return []           | Agent says "no matches"
retrieveMemories()        | Any                   | Y        | Return [], log      | Nothing (no memories)
buildSystemPrompt()       | Token overflow         | Y        | Budget cap (800tok) | Nothing
```

**CRITICAL GAPS: 0** — all error paths are rescued.

---

## Failure Modes

```
CODEPATH              | FAILURE MODE      | RESCUED? | TEST? | USER SEES?      | LOGGED?
----------------------|-------------------|----------|-------|-----------------|--------
memory-store read     | Corrupt file      | Y        | Y     | Nothing         | Y
memory-store write    | Disk full         | Y        | Y     | Soft warning    | Y
memory-store write    | Race condition    | Y        | Y     | Nothing (atomic)| Y
memory-store merge    | Dup resourceId    | Y        | Y     | Nothing (merged)| Y
memory-extractor      | Bad tool result   | Y        | Y     | Nothing         | Y
save_memory tool      | Invalid input     | Y        | Y     | Agent explains  | Y
search_memory tool    | No matches        | Y        | Y     | Agent says so   | N
memory-retriever      | No matches        | Y        | Y     | Nothing         | Y
memory-retriever      | Token overflow    | Y        | Y     | Nothing         | Y
stale resource        | 404 from Google   | Y        | Y     | Agent explains  | Y
```

**CRITICAL GAPS: 0.**

---

## Security Assessment

| Threat | Likelihood | Impact | Mitigated? |
|---|---|---|---|
| Memory file contains PII | High | Medium | **Accepted** — same as existing credential/conversation files. All local. |
| LLM prompt injection via memory | Low | Medium | **Yes** — memories injected as system-level context with clear delimiter. |
| Memory file accessible by other apps | Low | Low | **Accepted** — macOS Tauri sandbox limits cross-app access. |
| LLM extraction leaks data | Medium | Medium | **Yes** — same LLM provider already receives all user data. No new exposure. |

No new attack vectors beyond existing risk profile.

---

## Performance

| Concern | Assessment |
|---|---|
| Memory file read | <5ms for ~500 entries (~50KB JSON) |
| Retrieval search | <1ms keyword search over 500 entries |
| Token budget | 800 tokens max = ~5 memories at ~120 tokens each |
| LLM extraction | ~1-2s extra (on-demand only, does not block chat) |
| Rule-based extraction | <1ms per tool result |
| Disk writes | One JSON write per extraction, ~50KB |
| Memory growth | Capped at 500 entries per user, LRU eviction |

---

## Rollback Plan

1. Revert the commit
2. Memory files on disk are harmless leftovers
3. No data corruption risk
4. No migrations to reverse

**Reversibility: 5/5.**

---

## Delight Features (Approved for Phase 1)

1. **Auto-ThreadBrief** — auto-populate threadBrief when agent creates/modifies resources (~20 lines)
2. **"Remember This" Command** — handled by `save_memory` tool (built into Phase 2, no extra code)
3. **Memory-Powered Suggestions** — [SUGGEST:] buttons reference known resources (~40 lines)
4. **Memory Search via Chat** — handled by `search_memory` tool (built into Phase 2, no extra code)
5. **Memory Trace on Responses** — "Used 3 memories" badge via `memoriesUsed` on `AssistantPayload` (~50 lines)

---

## NOT in Scope

| Item | Rationale |
|------|-----------|
| Vector/semantic search | Phase 2. Keyword matching sufficient for <500 memories. Schema has `embedding` field ready. |
| Cloud sync of memories | No server infrastructure. Desktop-first. |
| Multi-user memory sharing | Single-user desktop app. |
| Proactive temporal suggestions | Phase 3. Requires pattern detection over access logs. |
| Memory import/export | Nice-to-have. User can copy the JSON file manually. |
| Memory deduplication via embeddings | Phase 2. Rule-based dedup by resourceId is sufficient. |

---

## What Already Exists (Reused)

| Existing Code | How It's Reused |
|---|---|
| `dynamic-tool-registry.ts` — FileIO pattern | Same architectural pattern for `memory-store.ts` |
| `buildSystemPrompt()` — system prompt with threadBrief | Extended with memories parameter |
| `storageKeys(userKey)` — per-user isolation | Same approach for memory file naming |
| `verboseCompletedDetail()` — tool result parsing | Similar parsing logic in extractor |
| `createLLMClient()` — LLM client factory | Reused for LLM-based extraction |

---

## Dream State Delta

```
12-MONTH IDEAL:   Semantic memory graph, proactive patterns, cross-device sync
THIS PLAN GETS:   Structured memory store, auto-extraction, keyword retrieval,
                  memory management UI, memory trace in chat
GAP REMAINING:    Semantic search (Phase 2), temporal patterns (Phase 3),
                  cloud sync (if/when FlowSpace goes multi-device)
CONFIDENCE:       This plan builds 60% of the 12-month ideal and creates
                  the foundation for the remaining 40%.
```

---

## Future Phases

### Phase 2: Vector Embeddings for Semantic Search (P2, M effort)

Replace keyword matching with embedding similarity. Use the `embedding` field already in the schema. Requires a local embedding model (ONNX) or API-based embeddings.

**Why:** Keyword matching breaks with synonyms or vague references. "Find memories about my job search" should work even without the word "tracker."

**Depends on:** Phase 1 (this plan).

### Phase 3: Proactive Memory-Based Suggestions (P3, L effort)

Agent detects temporal patterns in memory access (e.g., user updates tracker every Monday) and proactively suggests actions.

**Why:** Transforms agent from reactive to proactive. "You usually update your tracker on Mondays."

**Depends on:** Phase 1 + access logging.

### Phase 4: Shared JsonFileStore Utility (P3, S effort)

Extract shared `JsonFileStore<T>` utility if a third JSON store is needed (memory-store and dynamic-tool-registry already share the pattern).

---

## Implementation Order

```
PHASE 1: Core Memory Engine (backend, no UI changes)
─────────────────────────────────────────────────────
1. memory-types.ts + memory-store.test.ts (RED)    — schema + test skeleton
2. memory-store.ts (GREEN)                          — CRUD, atomic writes, merge-by-resourceId
3. memory-extractor.test.ts (RED)                   — test each tool type
4. memory-extractor.ts (GREEN)                      — rule-based extraction
5. memory-retriever.test.ts (RED)                   — test search + ranking
6. memory-retriever.ts (GREEN)                      — keyword search, token budget

PHASE 2: Agent Integration (tools + chat wiring)
─────────────────────────────────────────────────────
7. memory-tools.test.ts (RED)                       — test save_memory/search_memory
8. tools.ts changes (GREEN)                         — add save_memory + search_memory tools
9. chat-memory.test.ts (RED)                        — integration test for retrieval→injection→extraction
10. chat.ts changes (GREEN)                          — userEmail in opts, retrieval before LLM,
                                                       extraction after tools + executeApprovedAction,
                                                       memoriesUsed on AssistantPayload
11. shared/chat.ts                                   — add memoriesUsed to AssistantPayload type

PHASE 3: API + UI
─────────────────────────────────────────────────────
12. memory-api.test.ts (RED)                         — test /api/memory/* endpoints
13. server.ts changes (GREEN)                        — /api/memory/*, pass userEmail to handleChat
14. MemorySidebar.tsx                                — memory management UI
15. App.tsx                                          — mount sidebar, wire memory trace

PHASE 4: Delight Features
─────────────────────────────────────────────────────
16. Auto-ThreadBrief                                 — auto-populate on resource create/modify
17. Memory-Powered Suggestions                       — [SUGGEST:] buttons reference known resources
```

**TDD throughout:** Every phase starts with tests (RED), then implementation (GREEN).

---

## Totals

| Metric | Value |
|---|---|
| New code | ~710 lines (4 backend files + 1 UI component) |
| Modified code | ~150 lines (5 existing files) |
| Tests | ~600 lines (6 test files) |
| **Grand total** | **~1,460 lines** |

---

## Engineering Decisions Log (Eng Review 2026-03-17)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Pass `userEmail` in `HandleChatOptions` | Per-user memory isolation via email hash. Server gets email from `getActiveStoredAccount()`. |
| 2 | Extract memories in BOTH `handleChat()` AND `executeApprovedAction()` | Write tools go through approval flow — extraction must happen at both sites. |
| 3 | Access tracking: write-back only when agent references memory | Prevents noisy access counts. Check `memoriesUsed` in response to know which were actually used. |
| 4 | `memoriesUsed` field on `AssistantPayload` | Enables memory trace UI and accurate access tracking. |
| 5 | `save_memory` + `search_memory` tools replace `memory-llm.ts` | Fits existing tool-calling architecture. LLM naturally decides when to save/search. No keyword detection or separate LLM pipeline needed. |
| 6 | Atomic writes in `memory-store.ts` | Write to `.tmp` file, then `rename()`. Prevents corrupt JSON on crash/power loss. |
| 7 | Deduplication: merge by `resourceId` | Same spreadsheet referenced by create + append should be one memory entry, not two. |
| 8 | 6 test files (not 3) | Added `memory-tools.test.ts`, `chat-memory.test.ts`, `memory-api.test.ts` for full coverage. |
| 9 | No `memory-llm.ts` file needed | Removed ~80 lines. `save_memory`/`search_memory` tools handle all "remember" and "search" use cases. |
| 10 | Existing `createLLMClient` not needed for memory | Since we removed LLM-based extraction, the memory module has zero LLM dependencies. Purely rule-based + tool-based. |
