# FlowSpace Agent Harness — Deep Exploration & Enhancement Plan

> Generated: 2026-04-12
> Branch: 004-gmail-tab-v1
> Principle: Memory is not a plugin. It lives inside the harness. The harness owns context, tools, approvals, memory, sessions, persistence, and proactive handoff.

---

## 1. Harness Map

### 1.1 Context Runtime

| | |
|---|---|
| **Files** | `src/agent/chat.ts` (lines 71-153 `buildSystemPrompt()`), `src/agent/memory/memory-retriever.ts` (`formatMemoriesForPrompt()`), `src/agent/prompts/` (unused — prompts are inline) |
| **Responsibilities** | Assemble the full system prompt before every LLM call. Compose persona, time context, threadBrief, retrieved memories, tool-use guidelines, and suggestion format. |
| **Inputs** | `persona` (from options), `threadBrief` (from frontend via request body), `retrievedMemories` (from memory-retriever), `userTz` (from request body), `AGENT_NAME` constant |
| **Outputs** | A single system prompt string prepended to `chatMessages[]` |
| **Dependencies** | Memory Runtime (retrieval), Frontend Bridge (threadBrief passthrough) |
| **Owner of truth** | `chat.ts:buildSystemPrompt()` — the only place where all context sources merge |

**What the backend cannot see:** Full conversation history (only the messages array sent per-request), conversation title, conversation groupId, eventId linkage, which conversation this is within the user's history.

**What the frontend cannot see:** Retrieved memories, system prompt text, memory extraction results, tool execution internals.

---

### 1.2 Tool Runtime

| | |
|---|---|
| **Files** | `src/agent/tools.ts` (~2900 lines), `src/agent/tool-composer.ts` (239 lines), `src/agent/dynamic-tool-registry.ts` (170 lines), `src/agent/dynamic-tool-bridge.ts` |
| **Responsibilities** | Register all tools (static + dynamic + meta). Dispatch tool execution via `gws` CLI. Normalize results as strings. Classify read vs write. Build approval payloads for write tools. |
| **Inputs** | Tool name + args from LLM response, Google access token (env var), AbortSignal |
| **Outputs** | String result (raw JSON or error prefixed with `"Error:"`), `ApprovalRequest` for write tools |
| **Dependencies** | `gws` CLI (external process), Google auth (`getAccessToken()`), dynamic tool registry (file I/O) |
| **Owner of truth** | `TOOL_DEFINITIONS` array in tools.ts for static tools, `.dynamic-tools.json` for user-authored tools, `getAllToolDefinitions()` in dynamic-tool-bridge.ts for the merged set |

**Key structural issue:** `tools.ts` is a ~2900-line monolith containing definitions, dispatch, approval builders, and result formatting in one file. Each tool's execution is a case in a giant switch statement.

---

### 1.3 Approval Runtime

| | |
|---|---|
| **Files** | `src/agent/chat.ts` (lines 586-606 gate, lines 712-813 `executeApprovedAction()`), `src/agent/tools.ts` (`isWriteTool()` lines 409-415, `buildApprovalRequest()` lines 417-772), `src/shared/chat.ts` (`ApprovalRequest` type), `src/context/ChatContext.tsx` (`approveAction()` lines 722-768, `dismissApproval()` lines 770-782) |
| **Responsibilities** | Classify tool calls as write operations. Halt execution. Build editable approval payloads. Stream approval event to frontend. Accept user edits. Resume single-tool execution. Feed result back to memory. |
| **Inputs** | Tool name + args (from LLM), user-edited fields (from frontend approval card) |
| **Outputs** | `ApprovalRequest` (to frontend), post-approval `AssistantPayload` (streamed back) |
| **Dependencies** | Tool Runtime (classification + execution), Frontend Bridge (approval card rendering + field editing) |
| **Owner of truth** | `WRITE_TOOL_NAMES` set in tools.ts (18 tools). Frontend holds the approval in `Message.approval` until user acts. |

**Key structural issue:** Approval is not a standalone runtime. It is deeply woven into `handleChat()` (the gate) and exists as a separate function `executeApprovedAction()` (the resume). The two paths share no explicit contract — they are connected only by the `ApprovalRequest` type.

---

### 1.4 Memory Runtime

| | |
|---|---|
| **Files** | `src/agent/memory/memory-store.ts` (250 lines), `src/agent/memory/memory-extractor.ts` (280+ lines), `src/agent/memory/memory-retriever.ts` (180+ lines), `src/agent/memory/memory-types.ts` |
| **Responsibilities** | Store per-user memories in JSON files. Auto-extract facts from tool results. Retrieve relevant memories by keyword match. Format memories for prompt injection. Deduplicate by Google resource IDs. Evict LRU entries at 500 cap. |
| **Inputs** | User email (for scoping), tool name + args + result (for extraction), query text (for retrieval) |
| **Outputs** | `MemoryEntry[]` (stored), `RetrievedMemory[]` (for prompt), formatted prompt text |
| **Dependencies** | File system (DATA_DIR), tool execution results (from chat.ts) |
| **Owner of truth** | `.memory/{userHash}.json` in DATA_DIR. In-memory cache (`memoryCache`) is the working copy, flushed to disk on every write. |

**Key structural issue:** Memory retrieval is keyword-based only (no embeddings, no semantic search). The `embedding` field exists on `MemoryEntry` but is never populated. Retrieval quality depends entirely on tag overlap with the user's query words.

---

### 1.5 Session Runtime

| | |
|---|---|
| **Files** | `src/context/ChatContext.tsx` (880+ lines — conversation CRUD, localStorage persistence, per-user scoping, event linking, thread brief, group management) |
| **Responsibilities** | Create and persist conversations. Scope storage by user email. Link conversations to calendar events. Manage thread briefs. Handle conversation groups. Provide `findConversationByEventId()` for resume. |
| **Inputs** | User email (for storage key), eventId (for calendar linking), threadBrief (for persistent context) |
| **Outputs** | `Conversation` objects in localStorage, `conversationId` passed to server |
| **Dependencies** | localStorage API, user auth state (for email) |
| **Owner of truth** | `localStorage` keyed by `flowspace.chat.{userKey}.conversations.v1`. The server has no access to conversation state — it receives only the messages array and metadata per request. |

**Key structural issue:** Session state is entirely frontend-owned. The server is stateless with respect to conversations. This means the server cannot:
- Resume a conversation without the frontend resending all messages
- Know which conversation a request belongs to (except via `conversationId` metadata, which is only used for run association)
- Access conversation history for proactive work (e.g., horizon scanner cannot check if a meeting was already prepped)

---

### 1.6 Proactive Runtime

| | |
|---|---|
| **Files** | `src/agent/horizon-scanner.ts`, `src/agent/draft-store.ts`, `src/agent/draft-types.ts`, `src/components/DraftQueue.tsx` |
| **Responsibilities** | Scan upcoming calendar (48h window). Filter meetings by criteria (duration, external attendees). Gather email/Drive context per meeting. Generate LLM briefs. Store as `StagedDraft` objects. Surface in DraftQueue UI. Accept/dismiss/discuss actions. |
| **Inputs** | Calendar events, email search results, Drive file context, LLM calls |
| **Outputs** | `StagedDraft[]` persisted to `DATA_DIR/staged-drafts.json` |
| **Dependencies** | Calendar API, Gmail API, Drive API, LLM client, draft-store file I/O |
| **Owner of truth** | `staged-drafts.json` in DATA_DIR. Frontend fetches via `/api/drafts`. |

**Key structural issue:** The proactive runtime is a standalone scanner with its own LLM calls, its own persistence, and its own UI component. It does not share the chat harness's tool loop, memory system, or approval flow. When a user clicks "Discuss" on a draft, it starts a new conversation with the draft content injected — but the draft's gathered context (emails, docs) is not carried into the conversation as structured memory.

---

### 1.7 Persistence Layer

| | |
|---|---|
| **Files** | `server.ts` (`getDataDir()`, `getScopedDataPath()`), `src/agent/memory/memory-store.ts` (file I/O), `src/agent/draft-store.ts` (file I/O), `src/agent/dynamic-tool-registry.ts` (file I/O), `src/agent/llm-settings.ts` (file I/O) |
| **Responsibilities** | Read/write JSON files in DATA_DIR. Atomic writes (temp + rename). Per-user scoping for memory files. Mode 0o600 for secrets. |
| **Inputs** | Data objects to persist |
| **Outputs** | JSON files on disk |
| **Dependencies** | `fs` module, DATA_DIR resolution |
| **Owner of truth** | Disk files. Each subsystem owns its own file(s). |

**Files in DATA_DIR:**
| File | Owner | Scope |
|------|-------|-------|
| `.memory/{userHash}.json` | Memory Runtime | Per-user |
| `.llm-settings.json` | LLM Client | Global |
| `.dynamic-tools.json` | Tool Runtime | Global |
| `staged-drafts.json` | Proactive Runtime | Global |
| `runs.json` | Server (run tracking) | Global, ephemeral (24h TTL) |
| `.gws-credentials.json` | Auth system | Global |
| `.gmail-enrichment.{accountKey}.json` | Gmail enrichment | Per-account |
| `.followup-state.{accountKey}.json` | Followup tracker | Per-account |

---

### 1.8 Frontend Bridge

| | |
|---|---|
| **Files** | `src/context/ChatContext.tsx`, `src/services/api.ts`, `src/shared/chat.ts` |
| **Responsibilities** | Serialize messages for server. Parse NDJSON stream events. Manage approval UI lifecycle. Pass threadBrief and eventId as metadata. Handle run state. |
| **Inputs** | User input, conversation state, server stream events |
| **Outputs** | HTTP requests to `/api/chat/stream` and `/api/chat/approve`, UI state updates |
| **Dependencies** | React state, localStorage, fetch API |
| **Owner of truth** | Frontend owns conversation identity, message history, approval UI state, and navigation. Server owns tool execution, memory, and LLM calls. |

**Data that crosses the boundary:**

| Direction | Data | Purpose |
|-----------|------|---------|
| Frontend → Server | `messages[]`, `threadBrief`, `tz`, `conversationId`, `sourceMessageId` | Chat request |
| Frontend → Server | `ApprovalRequest` (with edited fields) | Approval confirmation |
| Server → Frontend | `ChatStreamEvent[]` (NDJSON) | Real-time updates |
| Server → Frontend | `AssistantPayload` (in `assistant_complete` event) | Final response with blocks, suggestions, memories used, threadBriefSuggestion |

---

## 2. Runtime Flow Maps

### 2.1 Reactive Chat Flow

```
1. User types message in ChatContext input
2. sendMessage() called with content + options (threadBrief, eventId, displayContent)
3. User message appended to conversation.messages[]
4. Empty assistant message created with status: 'streaming'
5. Conversation persisted to localStorage

6. POST /api/chat/stream sent with:
   - messages[] (full conversation history)
   - threadBrief (from conversation or options)
   - tz (user timezone)
   - conversationId, sourceMessageId

7. Server creates RunRecord, starts AbortController
8. Server calls handleChat(messages, options)

9. handleChat():
   a. Initialize memory store for user (if userEmail provided)
   b. Retrieve memories: extractKeywords(lastUserMessage) → score all entries → top 5 by relevance
   c. Build system prompt: time + persona + threadBrief + formatted memories + guidelines
   d. Prepend system message to chatMessages[]
   e. Call LLM: client.complete(chatMessages, { tools: getAllToolDefinitions() })

10. Tool-calling loop (max 5 rounds):
    a. Parse LLM response for tool_calls
    b. If no tool_calls → break loop, use response as final text
    c. For each tool_call:
       - If isWriteTool(name) → build ApprovalRequest → emit approval_required → RETURN
       - If read tool → executeTool(name, args, signal) → get string result
       - If result not error → extractFromToolResult() → mergeMemory() for each extraction
       - Push tool result as role:'tool' message
       - Emit tool_event to stream
    d. Re-send enriched chatMessages to LLM → next round

11. After loop: final LLM text (or summary if 5 rounds exhausted)
12. Parse [SUGGEST: ...] markers from response
13. Build AssistantPayload: content, blocks, toolEvents, suggestions, memoriesUsed, threadBriefSuggestion
14. Emit assistant_complete event
15. Stream NDJSON to client

16. Frontend parses stream events:
    - assistant_chunk → append to message content
    - tool_event → upsert into message.toolEvents[]
    - assistant_complete → finalize message with all payload fields
    - Set message status: 'complete'
17. Conversation persisted to localStorage
```

### 2.2 Write Approval Flow

```
1. LLM returns tool_call where isWriteTool(name) === true
2. chat.ts builds ApprovalRequest via buildApprovalRequest(name, args):
   - Generates id: `${toolName}:${Date.now()}`
   - Creates title, summary, confirmLabel
   - Creates editable fields[] (e.g., to, subject, body for send_email)
   - Preserves toolArgs for dynamic tools (fields not editable)
3. Emits tool_event with status: 'approval_required'
4. Returns AssistantPayload with approval field set
5. Execution HALTS — no more tool rounds

6. Frontend receives assistant_complete with approval
7. Stores approval in Message.approval
8. Renders ApprovalCard with editable fields
9. User reviews, optionally edits fields
10. Frontend validates required fields (per-tool switch in ChatThread.tsx)

11a. User clicks Approve:
    - approveAction(messageId, modifiedApproval) called
    - Approval removed from message
    - New empty assistant message created (streaming)
    - POST /api/chat/approve with { approval }
    - Server: executeApprovedAction(approval, options)
      - Reconstructs tool args from edited fields (or preserved toolArgs)
      - Executes single tool: executeTool(name, args, signal)
      - Extracts memories from result
      - Returns AssistantPayload with success/error text
    - Frontend updates message from stream

11b. User clicks Dismiss:
    - dismissApproval(messageId) called
    - Approval removed from message
    - Status block added: "Action canceled"
    - No server call
```

### 2.3 Memory Lifecycle Flow

```
EXTRACTION (write path):
1. Tool executes successfully (result does not start with "Error:")
2. chat.ts calls extractFromToolResult({ toolName, args, result })
3. memory-extractor.ts switch statement checks if toolName has an extractor (12 tools)
4. Extractor parses result JSON, builds CreateMemoryInput:
   - category: 'resource' | 'fact'
   - content: human-readable summary
   - tags: extracted keywords (stopwords removed, max 5 per source)
   - metadata: IDs, URLs, titles
   - resourceIds: Google resource IDs (for dedup)
   - source: { type: 'auto_extraction', toolName }
5. mergeMemory(input):
   - Check resourceIds against existing entries
   - If match: merge tags + metadata into existing entry
   - If no match: create new entry with id "mem-{timestamp}-{random}"
6. If entries > 500: LRU eviction (sort by accessCount asc, then lastAccessedAt asc)
7. Write to disk: atomic temp+rename to .memory/{userHash}.json

RETRIEVAL (read path):
1. handleChat() receives user message
2. Extract keywords from last user message (remove stopwords, lowercase, >2 chars)
3. Score every memory entry:
   - tagScore = matching tags * 0.25
   - keywordScore = (matching keywords / total query keywords) * 0.35
   - categoryScore = (5 - priority) * 0.05  [resource=1, workflow=2, preference=3, fact=4]
   - recencyScore = max(0, 0.15 - daysSinceAccess * 0.005)
   - accessScore = min(accessCount * 0.015, 0.1)
   - stale penalty: score * 0.5
4. Filter score > 0, sort by score desc, take top 5 (within 800 token budget)
5. Format as prompt text with category labels, URLs, internal IDs
6. Inject into system prompt via buildSystemPrompt()

STALENESS:
- stale flag exists on MemoryEntry but is never automatically set
- No invalidation mechanism — if a Google Doc is deleted, its memory persists
- LRU eviction is the only cleanup (at 500 cap)

ACCESS TRACKING:
- incrementAccess() exists in memory-store.ts but is NOT called from chat.ts
- lastAccessedAt and accessCount are set on creation but not updated on retrieval
- Recency and frequency scores in retriever use these fields, but they reflect creation time, not actual usage
```

### 2.4 Session Continuity Flow

```
CONVERSATION IDENTITY:
1. Each conversation gets a UUID on creation
2. Stored in localStorage: flowspace.chat.{userKey}.conversations.v1
3. userKey = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
4. Server receives conversationId as metadata but does not store or use it for state

THREAD BRIEF:
1. Created when starting meeting prep (buildEventThreadBrief in CalendarPage.tsx)
   - Contains: event title, time, attendees, description, video link
2. Stored in Conversation.threadBrief in localStorage
3. Passed to server on every request as metadata
4. Server injects into system prompt via buildSystemPrompt()
5. Can be updated via updateThreadBrief() or auto-suggested via threadBriefSuggestion in payload
6. Never expires — persists for life of conversation

EVENT-LINKED RESUME:
1. User clicks "Prepare meeting" on CalendarPage
2. findConversationByEventId(eventId) searches all conversations
3. If found: open existing conversation (resume)
4. If not found: create new conversation with eventId + threadBrief + prompt
5. eventId stored in Conversation.eventId in localStorage

WHAT SURVIVES:
- Browser refresh: conversations, groups, threadBriefs, eventIds (all in localStorage)
- Browser tab close + reopen: same as refresh
- Different browser/device: NOTHING — localStorage is device-local
- Server restart: memories survive (disk), conversations survive (client localStorage), runs lost (in-memory 24h TTL)
```

### 2.5 Proactive Artifact Flow

```
SCAN:
1. horizon-scanner.ts triggered (manually or on schedule)
2. Fetches calendar events for next 48 hours
3. Filters: >=30 min, >=2 external attendees, max 10 meetings
4. For each meeting: gathers related emails + Drive files
5. Calls LLM to generate brief (summary, linked docs, suggested actions)
6. Returns StagedDraft[]

STORAGE:
1. draft-store.ts persists to DATA_DIR/staged-drafts.json
2. Dedup by meetingId (Google Calendar event ID)
3. 7-day TTL or past-meeting auto-purge

SURFACING:
1. DraftQueue.tsx fetches from /api/drafts
2. Renders cards with: time, title, attendees, preview, sources
3. Each draft has status: pending | approved | dismissed | error

HANDOFF TO CHAT:
1. User clicks "Discuss" on a draft
2. Creates new conversation with draft content as initial prompt
3. Draft's gathered context (emails, docs) is NOT structured memory
   - It becomes text in the first user message
   - The memory system does not index it
   - If the user asks about a doc mentioned in the brief, memory cannot find it
4. No eventId linking (drafts use meetingId but don't set Conversation.eventId)
   - Cannot resume a draft discussion via CalendarPage's "Resume prep" flow
```

---

## 3. Harness Contracts

These are the interfaces the system should conceptually have. Some partially exist; others are implicit.

### 3.1 ContextAssembler

```
Purpose: Build the complete context window before each LLM invocation.

Inputs:
  - persona: Persona | undefined
  - threadBrief: string | undefined
  - retrievedMemories: RetrievedMemory[]
  - userTz: string
  - priorMessages: ChatMessage[]
  - toolDefinitions: ToolFunctionDef[]

Outputs:
  - systemPrompt: string
  - chatMessages: ChatMessage[]  (system + prior + tool results)
  - tokenEstimate: number  (for budget tracking)

Invariants:
  - System prompt is always the first message
  - Memory context is always included if memories exist
  - threadBrief is always included if present
  - Total token estimate never exceeds provider's context limit

Failure behavior:
  - If memory retrieval fails: proceed without memories (log warning)
  - If token budget exceeded: truncate oldest messages first, then memories

Current state: PARTIALLY EXISTS in chat.ts:buildSystemPrompt() but no token budgeting, no message truncation, no explicit contract.
```

### 3.2 ToolRuntime

```
Purpose: Register, dispatch, and normalize tool execution.

Inputs:
  - toolName: string
  - args: Record<string, any>
  - signal?: AbortSignal

Outputs:
  - result: string (success) or Error (failure)
  - metadata: { duration, toolType: 'static'|'dynamic'|'meta' }

Invariants:
  - All tools return strings (never throw for tool-level errors)
  - Error results always start with "Error:"
  - Tool definitions are frozen after initialization (no mid-request mutation)
  - Dynamic tools validate template references at registration, not execution

Failure behavior:
  - Timeout: return "Error: Tool execution timed out"
  - gws CLI crash: return "Error: <stderr>"
  - Invalid args: return "Error: Invalid arguments: <detail>"

Current state: EXISTS but as a monolith. tools.ts contains definitions, dispatch, approval builders, and formatting in one 2900-line file. No metadata returned. No duration tracking.
```

### 3.3 ApprovalRuntime

```
Purpose: Gate write operations, build editable proposals, pause execution, resume on user confirmation.

Inputs (gate):
  - toolName: string
  - args: Record<string, any>

Inputs (resume):
  - approval: ApprovalRequest (with user-edited fields)

Outputs (gate):
  - ApprovalRequest with editable fields, preview, metadata

Outputs (resume):
  - AssistantPayload with execution result

Invariants:
  - Every write tool MUST go through approval (no bypass)
  - Edited fields are re-validated before execution
  - Post-approval execution is exactly one tool call (no looping)
  - Approval state survives page refresh (persisted in conversation)

Failure behavior:
  - Tool execution error after approval: return error in payload, do not retry
  - Approval timeout: no timeout (user acts when ready)
  - Invalid edited fields: reject at frontend validation, do not send to server

Current state: PARTIALLY EXISTS. Gate is in handleChat(). Resume is in executeApprovedAction(). Connected only by ApprovalRequest type. No field re-validation on server side. Approval survives refresh (stored in Message.approval in localStorage).
```

### 3.4 MemoryRuntime

```
Purpose: Extract, store, retrieve, and manage per-user memory.

Inputs (extract):
  - toolName: string
  - args: Record<string, any>
  - result: string

Inputs (retrieve):
  - query: string
  - options: { maxResults, maxTokens }

Outputs (extract):
  - MemoryEntry[] (newly created or merged)

Outputs (retrieve):
  - RetrievedMemory[] (scored and formatted)
  - promptText: string (ready to inject)

Invariants:
  - Per-user isolation (userHash scoping)
  - Dedup by resourceIds (no duplicate entries for same Google resource)
  - Max 500 entries per user
  - Atomic file writes (no corruption on crash)
  - Retrieval is deterministic for same query + same store state

Failure behavior:
  - File read error: start with empty store
  - File write error: log, do not crash chat
  - No matching memories: return empty array (system prompt still valid)

Current state: EXISTS but with gaps:
  - incrementAccess() never called (access tracking is dead code)
  - No stale detection (stale flag never set automatically)
  - Keyword-only retrieval (embedding field unused)
  - Extraction hardcoded to 12 tools (new tools silently skip memory)
```

### 3.5 SessionRuntime

```
Purpose: Manage conversation identity, continuity, and cross-session resume.

Inputs:
  - userEmail (for storage scoping)
  - eventId (for calendar linking)
  - threadBrief (for persistent context)
  - conversationId (for server association)

Outputs:
  - Conversation objects with full message history
  - Resume capability via eventId lookup
  - Thread brief passthrough to server

Invariants:
  - Conversations are per-user (scoped by email)
  - eventId links are unique per conversation (but multiple conversations can share an eventId)
  - threadBrief persists for conversation lifetime
  - Conversations survive page refresh

Failure behavior:
  - localStorage full: graceful degradation (new conversations work, old ones may fail to save)
  - Corrupt localStorage: fallback to empty state

Current state: EXISTS entirely in frontend. No server-side session state. Server is stateless — it processes messages arrays as if every request is independent.
```

### 3.6 ProactiveArtifactRuntime

```
Purpose: Generate, store, surface, and hand off proactive artifacts to chat.

Inputs:
  - Calendar events (next 48h)
  - Related emails and Drive files
  - LLM generation

Outputs:
  - StagedDraft[] (meeting briefs)
  - UI cards in DraftQueue
  - Chat handoff (new conversation with brief content)

Invariants:
  - Dedup by meetingId (no duplicate briefs for same meeting)
  - Auto-purge past meetings and 7-day-old drafts
  - User can approve, dismiss, or discuss each draft
  - Discuss creates a new chat conversation

Failure behavior:
  - LLM generation error: draft gets status 'error'
  - No meetings found: empty draft queue

Current state: EXISTS as a standalone system. Not integrated with:
  - Memory (draft context not indexed)
  - Session (no eventId linking from drafts to conversations)
  - Approval (drafts have their own approve/dismiss, separate from tool approval)
```

### 3.7 PersistenceStore Contract

```
Purpose: Consistent read/write interface for all JSON file persistence.

Invariants:
  - Atomic writes (temp + rename)
  - Per-user scoping where needed (via userHash or accountKey)
  - DATA_DIR resolution is consistent across all subsystems
  - Schema versioning (version field in file format)

Current state: IMPLICIT. Each subsystem implements its own file I/O. Pattern is consistent (atomic writes, version field) but there is no shared utility. Each file has its own read/write/validate logic.
```

### 3.8 StreamEvent Contract

```
Purpose: Real-time communication from server to frontend during agent execution.

Event types:
  - assistant_begin: Agent started processing
  - assistant_chunk: Incremental text (140-char word-boundary chunks)
  - tool_event: Tool status change (pending → running → completed | error | approval_required)
  - run_started | run_progress | run_status_changed | run_completed | run_failed: Run lifecycle
  - assistant_complete: Final payload with all structured data
  - navigate: Tab/view change request
  - assistant_aborted | assistant_error: Failure states

Invariants:
  - Events are NDJSON (one JSON object per line)
  - assistant_complete is always the last success event
  - Every stream ends with either assistant_complete, assistant_error, or assistant_aborted
  - Tool events have stable IDs for dedup on frontend

Current state: EXISTS and is well-defined in src/shared/chat.ts (ChatStreamEvent type). The contract is clear and consistent.
```

---

## 4. Current Pain Points

### P1 (Critical) — Memory access tracking is dead code

| | |
|---|---|
| **What** | `incrementAccess()` in memory-store.ts is never called from chat.ts or memory-retriever.ts |
| **Where** | memory-store.ts:243-249 (function exists), chat.ts (never imported or called) |
| **Why it hurts** | The retriever's scoring formula uses `accessCount` and `lastAccessedAt` for ranking, but these fields are frozen at creation time. Memory ranking is therefore based on creation recency, not actual usage frequency. The retriever thinks it's using access patterns but it's not. |
| **Severity** | **Critical** — directly degrades memory retrieval quality, which directly degrades response quality |

### P2 (Critical) — Keyword-only memory retrieval

| | |
|---|---|
| **What** | Retrieval uses only keyword overlap (stopword-filtered word matching) between query and tags/content |
| **Where** | memory-retriever.ts:15-69 |
| **Why it hurts** | Semantic similarity is entirely absent. "quarterly revenue report" won't match a memory tagged "Q1 financial summary spreadsheet" because no keywords overlap. The user's natural language rarely uses the exact words that were auto-extracted as tags. |
| **Severity** | **Critical** — the #1 factor determining whether memory improves response quality |

### P3 (High) — Proactive artifacts are isolated from memory and session

| | |
|---|---|
| **What** | Horizon scanner generates meeting briefs with rich context (emails, docs, attendees), but this context never enters the memory system and drafts don't link to conversations via eventId |
| **Where** | horizon-scanner.ts, draft-store.ts, DraftQueue.tsx |
| **Why it hurts** | When a user clicks "Discuss" on a draft, the agent starts a fresh conversation with no memory of the documents and emails that were gathered. The gathered context is dumped as text in the first message and lost after that conversation's context window fills up. The user also can't "Resume prep" from CalendarPage because there's no eventId link. |
| **Severity** | **High** — proactive work is wasted if its context doesn't persist |

### P4 (High) — Server is stateless about conversations

| | |
|---|---|
| **What** | The server has no knowledge of conversation history, identity, or continuity. Every request is independent. |
| **Where** | server.ts chat endpoints, chat.ts handleChat() |
| **Why it hurts** | The server cannot: (1) resume conversations without the frontend resending all messages, (2) check if a meeting was already prepped, (3) use conversation history for proactive work, (4) implement server-side context summarization. All intelligence about session continuity must live in the frontend. |
| **Severity** | **High** — limits what the harness can do server-side |

### P5 (High) — Memory extraction is hardcoded to 12 tools

| | |
|---|---|
| **What** | Only 12 specific tools trigger memory extraction (switch statement in memory-extractor.ts). Adding a new tool silently skips memory. |
| **Where** | memory-extractor.ts:296-335 |
| **Why it hurts** | As the tool set grows (currently ~40 static + dynamic + meta), the memory system falls behind. Dynamic tools never extract memories. New static tools require explicit extractor code. |
| **Severity** | **High** — memory coverage degrades as tool count grows |

### P6 (Medium) — tools.ts is a 2900-line monolith

| | |
|---|---|
| **What** | Tool definitions, dispatch switch, approval builders, result formatters, and gws CLI invocation are all in one file |
| **Where** | src/agent/tools.ts |
| **Why it hurts** | Adding or modifying a tool requires navigating a massive file. Approval builder logic is interleaved with tool definitions. No separation between tool metadata and tool execution. Hard to test individual tools. |
| **Severity** | **Medium** — maintainability cost, not a runtime quality issue |

### P7 (Medium) — Approval has no server-side field validation

| | |
|---|---|
| **What** | `executeApprovedAction()` reconstructs tool args from edited fields but does not validate them against the tool's parameter schema |
| **Where** | chat.ts:712-745 |
| **Why it hurts** | A malformed or empty field could cause a gws CLI error deep in execution. The frontend validates required fields, but the server trusts them blindly. |
| **Severity** | **Medium** — defense-in-depth gap |

### P8 (Medium) — threadBrief is the only continuity mechanism

| | |
|---|---|
| **What** | The only way the server knows about conversation context beyond the current messages is the threadBrief string |
| **Where** | chat.ts:74-76 (injection), ChatContext.tsx (management) |
| **Why it hurts** | threadBrief is a free-text string with no schema. It's set once (on conversation creation for meeting prep) and rarely updated. For non-meeting conversations, it's usually empty. The server has no structured understanding of what the conversation is about. |
| **Severity** | **Medium** — limits context quality for non-meeting conversations |

### P9 (Low) — No memory write batching

| | |
|---|---|
| **What** | Each `mergeMemory()` call triggers an atomic file write. A tool loop with 5 tool calls could write to disk 5+ times. |
| **Where** | memory-store.ts:116-123, chat.ts:639-646 |
| **Why it hurts** | Synchronous file I/O per extraction. Performance impact is low at current scale but would matter with higher tool throughput. |
| **Severity** | **Low** — not a quality issue at current scale |

### P10 (Low) — No stale memory detection

| | |
|---|---|
| **What** | The `stale` flag on MemoryEntry is never automatically set. If a Google Doc is renamed or deleted, the memory entry persists with outdated info. |
| **Where** | memory-store.ts (MemoryEntry.stale), no auto-setter anywhere |
| **Why it hurts** | Agent may reference documents that no longer exist or have changed names. User trust erodes when the agent confidently cites stale information. |
| **Severity** | **Low** — rare at current memory volumes but grows with usage |

---

## 5. Enhancement Options

### Option A: Low-Risk Improvements

Fix the harness's existing contracts without changing architecture.

**Changes:**
1. **Fix memory access tracking** — Call `incrementAccess()` in memory-retriever.ts when memories are selected for prompt injection. ~5 lines.
2. **Widen memory extraction** — Add a generic extractor that captures tool name + args summary for any tool not in the specific extractor switch. New tools automatically get basic memory entries.
3. **Link drafts to conversations** — When DraftQueue "Discuss" creates a conversation, set `eventId` to the draft's `meetingId`. Enables CalendarPage "Resume prep" flow.
4. **Index draft context as memory** — When horizon scanner generates a draft, call `mergeMemory()` for each linked doc and related email. Draft context survives into future conversations.
5. **Add server-side approval field validation** — Validate required fields are non-empty before executing tool in `executeApprovedAction()`.

| | |
|---|---|
| **Expected benefit** | Memory retrieval immediately improves (access tracking feeds scoring). Proactive artifacts become useful across sessions. Approval is more robust. |
| **Implementation cost** | 1-2 days. Each change is <50 lines and independently testable. |
| **Migration risk** | Near zero. All changes are additive. No breaking changes to existing data or APIs. |
| **Effect on agent quality** | Moderate improvement. Memory ranking becomes data-driven. Draft context persists. |
| **Effect on future work** | Unblocks memory improvements. Establishes draft-to-memory pipeline. |

### Option B: Medium Refactor

Extract internal runtimes as explicit modules with clear contracts.

**Changes (includes all of Option A, plus):**
1. **Split tools.ts** — Separate into `tool-definitions.ts` (metadata), `tool-dispatch.ts` (execution), `tool-approval.ts` (approval builders). Each file <600 lines.
2. **Extract ContextAssembler** — Move `buildSystemPrompt()` + memory formatting + token estimation into `src/agent/context-assembler.ts`. Add token budget tracking (estimate tokens, truncate if over limit).
3. **Extract ApprovalRuntime** — Move gate logic and resume logic into `src/agent/approval-runtime.ts`. Shared contract between gate and resume. Add server-side field validation.
4. **Add structured threadBrief** — Change threadBrief from free-text string to a typed object: `{ type: 'meeting_prep' | 'email_thread' | 'task' | 'general', entityId?, summary, context: Record<string, string> }`. Serialize as JSON string for backward compatibility.
5. **Batch memory writes** — Accumulate extractions during a tool loop, flush to disk once at the end of `handleChat()`.

| | |
|---|---|
| **Expected benefit** | Codebase becomes modular and testable. Context assembly is explicit and budgeted. Approval logic is reusable. Memory I/O is efficient. |
| **Implementation cost** | 3-5 days. Mostly file splitting and import rewiring. Structured threadBrief requires frontend + backend changes. |
| **Migration risk** | Low. Internal restructuring only. API shapes unchanged. Structured threadBrief needs a migration path (detect string vs JSON). |
| **Effect on agent quality** | Moderate. Token budgeting prevents context overflow. Structured threadBrief enables richer context for non-meeting conversations. |
| **Effect on future work** | Major. Clean module boundaries make every future feature easier to build. |

### Option C: Deeper Harness Redesign

Rebalance ownership between frontend and backend. Unify session state model.

**Changes (includes all of Option B, plus):**
1. **Server-side conversation index** — Server maintains a lightweight conversation index in `DATA_DIR/conversations.json`: `{ id, title, eventId, threadBrief, lastMessageAt, messageCount }`. Frontend still owns full message history. Server uses index for: proactive work checks ("was this meeting already prepped?"), cross-conversation memory ("you discussed X in conversation Y"), and context summarization.
2. **Server-side context summarization** — When message count exceeds a threshold, server generates a summary of older messages and uses it instead of full history. Reduces token usage. Enables longer effective conversations.
3. **Unified artifact model** — Replace `StagedDraft` with a general `ProactiveArtifact` type that covers meeting briefs, email digests, task reminders, and future artifact types. Each artifact has: `{ id, type, entityId, content, linkedMemories[], status, createdAt }`. Artifacts are first-class in the memory system.
4. **Memory Runtime upgrade** — Add embedding-based retrieval (compute embeddings via LLM on extraction, store in memory entry, use cosine similarity for retrieval). Fall back to keyword matching if embeddings unavailable. This is the single biggest quality improvement possible.
5. **Conversation-scoped memory** — In addition to global per-user memory, maintain per-conversation memory that captures what was discussed, decided, and referenced. Enables true conversation resume without resending all messages.

| | |
|---|---|
| **Expected benefit** | Agent becomes truly continuous across sessions. Memory quality dramatically improves with embeddings. Proactive artifacts are first-class. Server can reason about conversation history. |
| **Implementation cost** | 2-3 weeks. Conversation index and summarization are new subsystems. Embedding pipeline requires choosing a provider/model. Artifact model is a data migration. |
| **Migration risk** | Medium. Conversation index is additive. Embedding migration can be lazy (compute on next access). Artifact model change requires draft-store migration. |
| **Effect on agent quality** | Transformative. Embedding retrieval alone fixes the #1 quality bottleneck. Conversation-scoped memory enables multi-session workflows. |
| **Effect on future work** | Enables: autonomous agents, multi-step approval chains, proactive inbox triage, cross-conversation reasoning, and server-side scheduled workflows. |

---

## 6. Recommended Path

### Recommendation: Option A now, then Option B, with one element from Option C pulled forward.

**Justification:**

Option A fixes the most impactful bugs (dead access tracking, missing draft-to-memory pipeline) with near-zero risk. These fixes take 1-2 days and immediately improve agent quality.

Option B should follow because it makes the codebase maintainable before adding new features. The tools.ts split and ContextAssembler extraction are prerequisites for any serious harness evolution.

The one Option C element to pull forward: **embedding-based memory retrieval**. This is the single highest-leverage change in the entire plan. Keyword matching is the primary bottleneck for memory quality. Embeddings can be added incrementally (compute on new extractions, lazy-compute on access for existing entries) without migrating existing data.

### Staged Plan

**Slice 1: Fix memory access tracking** (30 min)
- Call `incrementAccess(entry.id)` in memory-retriever.ts after selecting memories for prompt
- Verify scoring formula uses updated values
- Test: create memory, retrieve it twice, verify accessCount increments

**Slice 2: Widen memory extraction** (1 hour)
- Add generic fallback extractor in memory-extractor.ts for unhandled tools
- Extract: `{ category: 'fact', content: "${toolName}: ${summary of args}", tags: [toolName, ...argKeywords] }`
- Test: execute a tool not in the switch, verify memory entry created

**Slice 3: Link drafts to conversations via eventId** (1 hour)
- In DraftQueue "Discuss" handler, pass `eventId: draft.meetingId` to `sendMessage()`
- Verify CalendarPage "Resume prep" finds the conversation
- Test: create draft, discuss it, navigate to CalendarPage, verify "Resume" button

**Slice 4: Index draft context as memory** (2 hours)
- In horizon-scanner.ts, after generating a draft, call `mergeMemory()` for each linkedDoc and relatedEmail
- Use `resourceIds: [docId]` or `resourceIds: [emailThreadId]` for dedup
- Test: generate draft, verify memory entries exist, start new conversation, verify memories retrieved

**Slice 5: Server-side approval field validation** (1 hour)
- In `executeApprovedAction()`, validate required fields are non-empty before executing
- Return error in payload if validation fails
- Test: submit approval with empty required field, verify error returned

**Slice 6: Split tools.ts** (half day)
- `tool-definitions.ts`: TOOL_DEFINITIONS array + WRITE_TOOL_NAMES set
- `tool-dispatch.ts`: executeTool() + executeGws() + helper functions
- `tool-approval.ts`: isWriteTool() + buildApprovalRequest()
- Verify all imports updated, no behavior change
- Test: run existing test suite, verify green

**Slice 7: Extract ContextAssembler** (half day)
- Move buildSystemPrompt() to `src/agent/context-assembler.ts`
- Add token estimation (length/4 heuristic)
- Add message truncation if over budget (drop oldest non-system messages first)
- Test: verify system prompt output unchanged for existing inputs

**Slice 8: Batch memory writes** (1 hour)
- Accumulate CreateMemoryInput[] during handleChat() tool loop
- Flush all at once after loop completes
- Test: execute multi-tool conversation, verify single disk write

**Slice 9: Add embedding-based retrieval** (1-2 days)
- On memory extraction: compute embedding via LLM (small model, e.g., text-embedding-3-small)
- Store in MemoryEntry.embedding field
- In retriever: if embedding available, use cosine similarity as primary score (weight 0.5), keyword as secondary (weight 0.3), other signals (0.2)
- Fallback: if no embeddings (old entries), use current keyword scoring
- Lazy migration: compute embedding on first retrieval access for entries without one
- Test: store memory about "quarterly revenue", query "Q1 financial report", verify it's retrieved

---

## 7. Key Evaluation Answers

### Context

**Who truly owns context assembly today?**
`chat.ts:buildSystemPrompt()` (lines 71-153). It is the single point where persona, threadBrief, memories, time, and guidelines merge. However, it has no concept of token budget — it assembles everything and hopes it fits.

**Is threadBrief a real context contract or a patch over split ownership?**
It is a patch. It was created to solve the meeting prep resume problem specifically. It has no schema, no update protocol, and no expiration. For non-meeting conversations it is usually empty, which means the server has no persistent context at all. It works for meeting prep because the brief is set once and the conversation is focused. It would not scale to general-purpose conversation continuity.

**What context is currently invisible to the backend harness?**
Conversation title, conversation groupId, eventId linkage, which conversation this is in the user's history, how many prior conversations exist, what other conversations discussed, full conversation history beyond what the frontend sends per-request.

**What context is currently invisible to the frontend?**
Retrieved memories (which ones were selected and why), system prompt text, memory extraction results, tool execution internals (only summary events streamed), scoring details, token usage.

### Memory

**Is memory retrieval strong enough to influence response quality reliably?**
No. Keyword matching is too brittle. It works when the user's query words happen to match extracted tags. It fails for semantic similarity, paraphrasing, or domain terminology differences. The scoring formula is reasonable but its inputs (keyword overlap) are too weak.

**Does memory extraction capture the right kinds of facts?**
Partially. The 12 supported tools cover the most important Google Workspace operations. But dynamic tools, navigation tools, and newer tools are excluded. The extracted content is good (human-readable summaries with metadata), but the tag extraction is too simple (stopword-filtered words, max 5).

**Is memory coupled too tightly to chat orchestration?**
Yes. Extraction happens inline in the tool loop (chat.ts:632-656). Retrieval happens at the top of handleChat(). If you wanted to use memory from a different entry point (e.g., proactive scanner, API endpoint, scheduled job), you'd need to duplicate the initialization and retrieval logic.

**Does memory need a clearer runtime boundary?**
Yes. The memory system should expose: `init(userEmail)`, `retrieve(query, options)`, `extractFromToolResult(toolName, args, result)`, `flush()`. These exist as separate functions today but are called from scattered locations in chat.ts with initialization checks mixed in.

### Tools

**Is the tool runtime modular enough to support growth?**
No. The 2900-line monolith in tools.ts makes every addition expensive. The switch-based dispatch means adding a tool requires modifying a core file. Dynamic tools are modular (registered via JSON), but static tools are not.

**Are static, dynamic, and meta tools unified cleanly?**
Yes, at the definition level. `getAllToolDefinitions()` in dynamic-tool-bridge.ts merges all three into a single array for the LLM. At the execution level, less so — static tools go through the switch in tools.ts, dynamic tools go through tool-composer.ts, and the meta-tool goes through dynamic-tool-registry.ts.

**Are tool results normalized consistently?**
No. All results are strings, but some are raw JSON (parseable), some are formatted text, and some are error strings with "Error:" prefix. The block builder in chat.ts parses results heuristically per tool name. If a tool changes its output format, the UI breaks silently.

### Approval

**Is approval a clean pause-and-resume runtime?**
No. The gate is embedded in handleChat()'s tool loop (lines 586-606). The resume is a separate function executeApprovedAction() (lines 712-813). They share the ApprovalRequest type but no explicit contract about how fields map to args, what validation is expected, or what state must be preserved.

**Can the system support richer approval patterns later?**
With difficulty. The current design assumes: one write tool per turn, user edits fields, single execution. To support multi-step approval chains, conditional approvals, or approval delegation would require reworking both the gate and resume logic.

### Session Continuity

**Should more state move server-side?**
Yes, but not full conversation storage. A lightweight conversation index (id, title, eventId, threadBrief, lastMessageAt) on the server would enable: proactive checks ("already prepped?"), cross-conversation memory, and server-initiated summarization. Full message history should stay client-side for responsiveness and privacy.

**Should some conversation state remain client-side?**
Yes. Message content, UI state (panel open, active view), and input buffer should stay client-side. Moving them to the server adds latency and complexity without benefit.

**What is the correct source of truth for session continuity?**
A hybrid: frontend owns message content and UI state. Server owns a conversation index for cross-conversation reasoning. threadBrief is shared (written by frontend, consumed by server). Memory is server-only. The current pure-frontend model is too limited for proactive and cross-session features.

### Proactive Work

**What is the reusable contract for a proactive artifact entering chat?**
It should be: `{ type, entityId, content, linkedMemoryIds[], threadBrief }`. When an artifact enters chat, the harness should: (1) set `Conversation.eventId = entityId`, (2) set `Conversation.threadBrief` from the artifact, (3) ensure linked memories are indexed and retrievable, (4) start the conversation with context pre-loaded. Currently, only step (4) partially happens (content dumped as text).

**Can the harness support more proactive artifact types without special-casing?**
Not today. The horizon scanner, draft store, and DraftQueue are all meeting-prep-specific. To support email digests, task reminders, or other artifact types would require duplicating the scanner-store-UI pattern. A unified `ProactiveArtifact` model with type-specific renderers would make this generic.

---

## 8. Unknowns Surfaced During Exploration

These items were ambiguous in the code. They are marked explicitly rather than guessed.

1. **Is `incrementAccess()` intentionally unused or accidentally dropped?** The function exists with correct logic but is never called. No TODO or comment explains why. Likely an oversight during development.

2. **Does threadBriefSuggestion in AssistantPayload get applied automatically?** The server returns it in the payload, but the frontend does not auto-apply it to `Conversation.threadBrief`. It appears to be informational only — the frontend would need explicit logic to accept or reject the suggestion. This logic was not found.

3. **Are dynamic tool steps approval-gated individually?** The comment in `isWriteTool()` says "Dynamic tools run their own step-level execution — they are never approval-gated at the top level." But tool-composer.ts does not contain any step-level approval logic. Dynamic tools that contain write steps appear to execute without approval.

4. **Does the horizon scanner check for existing conversations?** There is no `findConversationByEventId()` call in the scanner. It cannot check if a meeting was already prepped because conversation state is frontend-only.

5. **Is the 500-memory-entry cap per-user or global?** Per-user (each user has their own `.memory/{userHash}.json` file). Confirmed by scoping logic in memory-store.ts.
