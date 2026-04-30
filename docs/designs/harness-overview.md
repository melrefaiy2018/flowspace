# The FlowSpace Agent Harness

> What it is, how it works, and why it makes the agent better.

---

## What is the harness?

The harness is everything between the user and the language model. It is not the model itself. It is the system that decides what the model sees, what tools it can use, what it remembers, when it must stop and ask permission, and how its work persists across sessions.

The model generates text. The harness makes that text useful.

In FlowSpace, the harness is the code in `src/agent/` that orchestrates every chat turn: assembling context, calling the LLM, executing tools, gating write operations for approval, extracting memories from results, and streaming events back to the frontend.

The principle behind this work: **memory is not a plugin. It lives inside the harness.** If the harness is weak, the agent forgets, ranks poorly, and loses context. If the harness is strong, the agent remembers what matters, maintains continuity, and gets better over time — regardless of which model is behind it.

---

## How the harness was before

The original harness worked but had significant gaps:

**Memory was broken in practice.** The memory system stored facts extracted from tool results, but the ranking algorithm used access frequency and recency signals that were never actually updated. `incrementAccess()` existed but was never called — a dead function. Every memory had `accessCount: 0` forever. The retrieval algorithm thought it was learning from usage patterns, but it was ranking based on creation time alone.

**Retrieval was keyword-only.** If you asked about "Q1 financial summary," the system could not find a memory tagged "quarterly revenue report" because no keywords overlapped. Semantic similarity did not exist.

**Most tools were invisible to memory.** Only 12 of ~40 tools had extraction logic. The other 28 — plus all dynamic tools — silently produced no memory entries. The agent's recall was limited to a narrow slice of its own work.

**Dynamic tools bypassed approval.** A user-created workflow containing `send_email` as a step would execute that email without any approval card. The write-safety contract was silently violated for the entire dynamic tool system.

**The server knew nothing about conversations.** Conversation identity, history, and continuity lived entirely in the browser's localStorage. The server processed each request as if it had never seen the user before. Proactive features like meeting prep could not check whether a meeting had already been discussed.

**Proactive artifacts were isolated.** The horizon scanner gathered rich context — linked documents, related emails, attendee information — but none of it entered the memory system. When a user clicked "Discuss" on a meeting prep draft, the gathered context was dumped as text in the first message and lost after the conversation grew. The discussion was also not linked to the calendar event, so "Resume prep" from the calendar page did not work.

**The codebase was hard to evolve.** `tools.ts` was a 2900-line monolith containing tool definitions, dispatch logic, approval builders, and result formatters. `chat.ts` contained context assembly, tool orchestration, approval gating, memory extraction, and label generation all interleaved. Adding a new tool or changing approval logic required navigating thousands of lines of coupled code.

---

## What the harness is now

The harness has been rebuilt across multiple phases — memory quality, approval safety, module extraction, embedding retrieval, conversation indexing, and conversation summarization — without changing the external API or user-facing behavior (except where behavior was broken).

### Memory that actually learns

`incrementAccess()` is now called after every retrieval cycle. When memories are selected for prompt injection, their access count increments and their last-accessed timestamp updates. The scoring algorithm now reflects real usage:

- Memories the agent uses frequently rank higher over time
- Memories that are never accessed decay in ranking
- The system genuinely learns which memories are useful, not just which were created recently

### Memory that covers everything

Every tool execution now produces at least a basic memory entry. The 12 tool-specific extractors still run for their tools (producing high-quality entries with proper resource IDs, metadata, and tags). For the remaining tools — including all dynamic tools and future tools — a generic fallback extractor creates a `fact` category entry with the tool name, a summary of the arguments, and any resource IDs found in the args.

The memory system no longer has blind spots. If the agent does something, it can remember it.

### Memory that understands meaning

Memory retrieval now supports embedding-based semantic similarity, with explicit behavior per provider.

**When embeddings are computed:** On every memory creation and merge, if the active provider supports embeddings, the memory's content and tags are sent to `text-embedding-3-small` to produce a 1536-dimensional vector. The embedding is stored in a separate file. On every retrieval, the user's query is also embedded once, and all memories with embeddings are scored by cosine similarity.

**When embeddings are skipped:** If the active provider does not support embeddings, `computeEmbedding()` returns null immediately. No API call is made. No embedding is stored. The retriever uses keyword-only scoring — the same algorithm that existed before this work.

**Provider policy:**

| Provider | Embeddings | Retrieval mode |
|----------|-----------|---------------|
| OpenAI | Computed via `text-embedding-3-small` | Embedding + keyword hybrid |
| OpenRouter | Computed via proxied OpenAI endpoint | Embedding + keyword hybrid |
| Anthropic | Not available (no embedding API) | Keyword-only |
| Claude Code | Not available (CLI, no API) | Keyword-only |
| LM Studio | Not available (most local models lack embedding support) | Keyword-only |
| Codex | Not available | Keyword-only |

**What happens when the user switches providers:** The embedding file stores which model produced the vectors (e.g., `text-embedding-3-small`). When embeddings are loaded, the stored model is compared against the current provider's model. If they differ — because the user switched from OpenAI to OpenRouter with a different model, or from OpenAI to Anthropic and back — all cached embeddings are invalidated. They are not deleted from disk; they are ignored and lazily recomputed as memories are accessed in future retrievals (up to 5 per retrieval call to cap latency).

**How much does provider choice affect memory quality?** Users on OpenAI or OpenRouter get the best retrieval quality: semantic similarity handles paraphrasing, synonyms, and conceptual proximity. "Q1 financial summary" finds "quarterly revenue report." Users on Anthropic or LM Studio get the same keyword-based retrieval that existed before this work — plus the access tracking and extraction improvements, which are provider-independent. The gap is real but bounded: keyword retrieval works well when the user's words overlap with stored tags, and the access tracking improvements help surface the right memories even without embeddings.

**Scoring formula (embedding path):**
```
embeddingScore   = cosineSimilarity(query, entry) * 0.50
tagScore         = matchingTags * 0.10
keywordScore     = (matchingKeywords / queryKeywords) * 0.15
categoryScore    = (5 - categoryPriority) * 0.05
recencyScore     = max(0, 0.10 - daysSinceAccess * 0.003)
accessScore      = min(accessCount * 0.010, 0.10)
```

**Scoring formula (keyword-only path, unchanged):**
```
tagScore         = matchingTags * 0.25
keywordScore     = (matchingKeywords / queryKeywords) * 0.35
categoryScore    = (5 - categoryPriority) * 0.05
recencyScore     = max(0, 0.15 - daysSinceAccess * 0.005)
accessScore      = min(accessCount * 0.015, 0.10)
```

Embeddings are stored in a separate file per user (`.memory/{userHash}.embeddings.json`) to keep the main memory file fast. The main memory file stays under 400 KB with sub-15ms writes. The embedding file uses compact JSON (no pretty-print) and is loaded on-demand at retrieval time — not on every memory write.

### Approval that is airtight

Every write operation — whether called directly by the model or as a step inside a user-created dynamic tool — now goes through approval. The harness inspects each tool call, checks `isWriteTool()`, and halts execution to present an approval card to the user. This applies to all 18 write tools: email sending, calendar event creation, task creation, document editing, spreadsheet operations, email archiving, label application, and more.

**Dynamic tool approval contract:** A dynamic tool is a user-authored multi-step workflow. Steps execute sequentially. When any step is a write operation, the harness guarantees:

1. All preceding read steps execute immediately.
2. The write step halts execution and returns an `ApprovalRequest` to the frontend.
3. The user reviews, optionally edits fields, and approves or dismisses.
4. On approval, the write step executes. Remaining steps resume.
5. If a subsequent step is also a write operation, execution halts again at that step. The user approves each write action individually.
6. If the user dismisses, all remaining steps are dropped. Completed read step results remain available.

This is a runtime guarantee, not a guideline. There is no code path through which a write tool can execute without the user seeing an approval card — whether the tool is called directly by the model, or as step 3 of a 5-step user-authored workflow.

The server also validates required fields before executing any approved action. If the frontend validation is bypassed (or if a field is edited to be empty), the server catches it and returns an error without executing the tool. All 18 write tools have explicit required field rules.

### Proactive artifacts that connect to everything

When the horizon scanner generates a meeting prep draft, it now indexes every linked document and related email into the memory system. These entries have proper resource IDs for deduplication, meeting metadata for context, and tags for retrieval. If you ask the agent about a document that appeared in a meeting brief three days ago, it can find it.

Draft discussions are now linked to calendar events via `eventId`. When you click "Discuss" on a draft in the DraftQueue, the resulting conversation is linked to the Google Calendar event. CalendarPage's "Resume prep" button finds these conversations. The meeting prep flow is continuous: scan → draft → discuss → resume — all connected through the harness.

### A server that knows conversations exist

The server now maintains a lightweight conversation index per user (`DATA_DIR/.conversations.{userHash}.json`). Every chat request updates this index with metadata: conversation ID, title, eventId, threadBrief, message count, creation time, and origin. The server never stores message content — only metadata.

This index enables three things that were previously impossible:

1. **"Already prepped?" checks.** The horizon scanner now calls `isEventAlreadyPrepped()` before generating a meeting prep draft. If a conversation linked to that calendar event already exists with at least one message, the draft is skipped. No more duplicate prep briefs.

2. **Memory-conversation linkage.** When memories are extracted from tool results, the `conversationId` is now included in the memory's source metadata. When the retriever formats memories for the system prompt, it resolves the conversation ID to a title via the index. The agent sees: `[RESOURCE] Q1 Revenue Tracker (from conversation: Meeting Prep — Q1 Review)` — giving it cross-conversation awareness.

3. **Foundation for summarization.** The index tracks `messageCount`, which tells the harness when a conversation is long enough to benefit from compression. This is the trigger signal for the summarization system described below.

The index is a derived projection, not a primary store. The frontend remains authoritative for conversation content and identity. If the index file is deleted, it rebuilds incrementally as new chat requests arrive. Title and eventId follow a first-value-wins policy — once set, they are never overwritten by subsequent requests.

### Conversations that summarize themselves

Long conversations no longer lose their older context to brute truncation. When a conversation's message history exceeds 30,000 tokens, the harness generates an LLM-powered summary that captures the conversation's objectives, decisions, key resources, open questions, and current state. This summary replaces the older messages in the context window, compressing thousands of tokens into a concise paragraph.

**How it works:**

1. Before context assembly, the harness estimates total conversation tokens.
2. If the conversation exceeds 30K tokens and either no summary exists or 10+ new messages have arrived since the last summary, the harness generates or updates the summary.
3. First generation uses the full message history. Subsequent updates are incremental: the LLM receives the previous summary plus only the new messages, producing an updated summary.
4. The summary is injected into the system prompt between memories and guidelines, wrapped in labeled markers.
5. Messages older than the summary's cutoff point are trimmed from the context — the summary replaces them.
6. `truncateMessages()` remains as a safety net for edge cases where summary + recent messages still exceed the 100K budget.

**What the summary captures that memory and threadBrief do not:**

| Layer | What it captures |
|-------|-----------------|
| threadBrief | Initial context (meeting metadata, event info). Static after creation. |
| Memory | Discrete facts: spreadsheet IDs, emails sent, events created. |
| Summary | Evolving trajectory: what the user is trying to accomplish, what was decided, what's still open, where the work stands. |

The three layers complement each other in the system prompt: threadBrief seeds the context, memories provide specific facts, and the summary provides the narrative arc.

Summaries are stored in a separate per-user file (`DATA_DIR/.conversation-summaries.{userHash}.json`). Each conversation has at most one active summary, versioned and timestamped. The summary text is capped at 2,000 characters. No individual messages are stored — only the distilled summary.

If summary generation fails (LLM error, timeout), the harness falls back to truncation. Summary failure never blocks the chat response.

### Context that fits

The harness enforces a 100,000-token context budget. Before sending messages to the LLM, `truncateMessages()` estimates the total token count and drops the oldest messages (preserving the system prompt and the most recent user message) if the context would exceed the budget. For long conversations, summarization reduces reliance on this fallback by compressing older context semantically rather than discarding it.

### Code that can evolve

The monolithic `tools.ts` (2900 lines) has been split into four focused modules:

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `tool-definitions.ts` | 590 | Tool metadata, write tool classification |
| `tool-dispatch.ts` | 832 | Tool execution via gws CLI |
| `tool-approval.ts` | 503 | Approval request builders |
| `tool-result-renderer.ts` | 446 | Block rendering from tool results |

`chat.ts` has been decomposed:

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `chat.ts` | 710 | Orchestration: tool loop, memory init, embedding wiring, summary trigger |
| `chat-utils.ts` | 309 | Pure functions: labels, messages, text chunking, persona rules |
| `context-assembler.ts` | 200 | System prompt construction, token estimation, message truncation, summary rendering |
| `approval-runtime.ts` | 50 | Approval classification, field validation |
| `conversation-index.ts` | 150 | Server-side conversation metadata index, event lookup |
| `conversation-summary.ts` | 252 | Summary store, LLM-based generation, incremental updates |

The memory system is similarly modular:

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `memory-store.ts` | 280 | Per-user CRUD, batch writes, LRU eviction |
| `memory-extractor.ts` | 375 | Auto-extraction from tool results (specific + generic) |
| `memory-retriever.ts` | 249 | Scoring, ranking, dual-path retrieval, lazy migration |
| `memory-embeddings.ts` | 287 | Embedding computation, separate file I/O, provider detection |

The continuity system is cleanly separated:

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `conversation-index.ts` | 150 | Per-user metadata index, event lookup, title lookup |
| `conversation-summary.ts` | 252 | Summary store, trigger logic, LLM generation, incremental updates |

Adding a new tool, changing approval logic, modifying retrieval scoring, or extending conversation continuity now means editing one focused file, not navigating a multi-thousand-line monolith.

---

## How this improves agent performance

### Better answers through better recall

The agent's response quality is directly tied to what it remembers. Before these changes, memory retrieval was a coin flip — it worked when the user's exact words happened to match stored tags, and failed silently otherwise. Now:

- Access tracking means frequently useful memories surface first
- Generic extraction means the agent remembers all of its own work, not just 30% of it
- Embedding retrieval means the agent understands what you mean, not just what you literally said

The practical effect: when a user says "find that spreadsheet we were working on last week," the agent can actually find it — even if the memory was stored as "Q1 Revenue Tracker created via sheets_create" and the user never used those exact words.

### Better continuity across sessions

Before: meeting prep context was dumped as text and lost. Draft discussions were not linked to events. The server had no memory of past conversations. Long conversations lost older context to brute truncation.

**What improved across the full harness rebuild:**

- Draft context (linked documents, related emails) is indexed into persistent server-side memory
- Draft discussions link to calendar events via `eventId`, enabling "Resume prep" from the calendar page
- The memory system carries facts forward across sessions — the agent builds up knowledge over time
- The server now maintains a conversation index — it knows which conversations exist, their event links, and their activity level
- The horizon scanner checks "already prepped?" before generating duplicate meeting briefs
- Memories carry `conversationId` in their source, and the retriever resolves this to a conversation title in the prompt — giving the agent cross-conversation awareness
- Long conversations generate LLM-powered summaries that compress older context instead of discarding it
- The summary captures trajectory (objectives, decisions, open questions) that memory and threadBrief do not

**What is still limited:** Full message history lives in the browser's `localStorage`. If the user switches browsers or devices, conversation messages are lost (server-side memories, the conversation index, and summaries survive, but the raw chat history does not). Cross-device message sync would require server-side message storage, which is an intentional boundary — the server stores metadata and distilled context, never individual messages.

### Safer write operations

Before: dynamic tools could send emails, delete threads, and create events without the user ever seeing an approval card. This was a silent trust violation.

Now: every write operation halts for approval, whether it comes from a direct tool call or a step inside a user-created workflow. The server validates fields independently of the frontend. The approval contract is explicit and enforced at the harness level.

### More headroom for long conversations

Before: no context budget. Long conversations could silently overflow the model's context window, producing degraded or truncated responses.

Now: a two-layer defense. First, conversation summarization compresses older context into a ~500-word summary when the conversation exceeds 30K tokens — preserving decisions, objectives, and state without consuming thousands of tokens of raw history. Second, a 100K token budget with automatic truncation serves as a safety net for edge cases. The agent can handle conversations of any length without losing the thread of what it was doing.

### Faster evolution

The modular architecture means new capabilities — new tool types, richer approval patterns, conversation summarization, additional proactive artifact types — can be added by modifying focused, well-bounded files rather than navigating a monolith. Each module has clear inputs, outputs, and contracts. Tests target specific modules. The harness can grow without becoming fragile.

---

## Architecture at a glance

```
User message
    |
    v
[ Conversation Index ]        conversation-index.ts
    |  upsert: id, title, eventId, threadBrief, messageCount
    |  server now knows this conversation exists
    |
    v
[ Memory Retrieval ]          memory-retriever.ts + memory-embeddings.ts
    |  keyword scoring + embedding similarity (when available)
    |  access tracking on selected memories
    |  conversation title resolved for each memory's source
    |
    v
[ Summary Check ]             conversation-summary.ts
    |  IF conversation > 30K tokens AND summary stale:
    |    generate/update summary via LLM call
    |    trim older messages (summary replaces them)
    |  ELSE IF summary exists: load and trim older messages
    |
    v
[ Context Assembly ]          context-assembler.ts
    |  system prompt + persona + threadBrief
    |  + retrieved memories (with conversation titles)
    |  + conversation summary (for long conversations)
    |
    v
[ Token Budget Check ]        context-assembler.ts
    |  truncate oldest messages if over 100K tokens (safety net)
    |
    v
[ LLM Call ]                  llm-client.ts + providers/
    |  multi-provider: OpenAI, Anthropic, OpenRouter, LM Studio, etc.
    |
    v
[ Tool Loop (max 5 rounds) ]  chat.ts
    |
    |--[ Read tool? ]-------> Execute immediately
    |     |                   Extract memories (with conversationId in source)
    |     |                   Compute embedding if provider supports it
    |     v
    |   Push result to messages, re-call LLM
    |
    |--[ Write tool? ]------> Halt for approval
    |     |                   Build ApprovalRequest with editable fields
    |     |                   Stream approval_required event to frontend
    |     v
    |   Wait for user → executeApprovedAction()
    |     |               Validate fields server-side
    |     |               Execute single tool
    |     |               Resume remaining steps (dynamic tools)
    |     |               Extract memories (with conversationId)
    |     v
    |   Return result to user
    |
    v
[ Final Response ]
    |  Parse suggestions, apply persona rules
    |  Stream chunks + assistant_complete event
    |  Include: blocks, tool events, suggestions, memories used
    |
    v
[ Persistence ]               memory-store.ts + memory-embeddings.ts
    |                          + conversation-index.ts + conversation-summary.ts
    |  Batch flush: one disk write for memories, one for embeddings
    |  Conversation index updated per request
    |  Summary updated when trigger fires
    |  Atomic writes (temp + rename)
    |  Per-user scoping via userHash
    |
    v
[ Session Continuity ]        ChatContext.tsx (frontend)
    |  Conversation stored in localStorage (messages, full history)
    |  eventId links to calendar events
    |  threadBrief carries persistent context
    |  title + eventId sent to server on each request
    |  findConversationByEventId() enables resume
```

---

## Shipped, deferred, and future-dependent

### Shipped now

These capabilities are implemented, tested, and active in the current harness:

**Memory system:**
- Memory access tracking (ranking reflects real usage)
- Generic memory extraction for all tools (no blind spots)
- Embedding-based retrieval for OpenAI and OpenRouter users
- Keyword fallback retrieval for all other providers
- Separate embedding file storage with lazy migration
- Provider switch detection and embedding invalidation
- Memory-conversation linkage (memories carry conversationId, retriever resolves to title)

**Approval system:**
- Dynamic tool write-step approval enforcement
- Server-side approval field validation for all 18 write tools

**Proactive artifacts:**
- Draft context indexed into memory (linked docs, related emails)
- Draft discussions linked to calendar events via eventId
- "Already prepped?" check in horizon scanner via conversation index

**Conversation continuity:**
- Server-side conversation index (metadata-only: id, title, eventId, threadBrief, messageCount, origin)
- Conversation summarization for long conversations (>30K tokens, LLM-generated, incremental updates)
- Summary injected into system prompt, replacing older truncated messages
- 100K token context budget with automatic truncation (safety net behind summarization)

**Architecture:**
- Modular harness: tool split (4 files), context assembler, approval runtime, chat utils
- Conversation index and summary as separate stores (not bloating the memory file)

### Intentionally deferred

These were evaluated and explicitly deferred because the cost or complexity does not justify the benefit today:

- **threadBriefSuggestion wiring**: The server computes it but the frontend ignores it. The generation logic produces a single weak sentence. Deferred until the generation can produce structured, actionable suggestions worth surfacing to the user. With conversation summarization now in place, the summary itself is a much richer source of evolving context than the threadBriefSuggestion ever was.

- **Structured summary sections**: The summary type supports `SummarySections` (objective, decisions, resources, open questions, current state), but Slice 1 generates plain text only. Structured extraction can be added by changing the summarization prompt and parsing the output — no storage or integration changes needed.

- **Local embedding fallback**: Users on Anthropic or LM Studio get keyword-only retrieval. A local embedding option (e.g., `transformers.js`) could provide semantic retrieval without an external API. Deferred to keep the dependency footprint small and avoid shipping an untested local model.

- **Per-provider context limits**: The 100K budget is a safe default for all providers. More precise limits (200K for Claude, 128K for GPT-4o) would improve token efficiency. Deferred because it requires extending the LLM settings schema and adding per-provider metadata.

### Depends on future architectural decisions

- **Cross-device conversation sync**: Full message history lives in localStorage. Server-side message storage or a sync protocol would enable cross-device access. The conversation index and summaries already survive across devices — only raw messages are device-local. This is an intentional privacy boundary, not an oversight.

- **Conversation-scoped memory**: All memories are currently global per-user. Scoping memory retrieval to a specific conversation (using the `conversationId` already in memory source metadata) would enable "show me only what we discussed in this conversation." Requires changes to the retriever's query interface.

- **Generalized ProactiveArtifact model**: Only meeting prep exists as a proactive artifact type. A general model (`{ type, entityId, content, linkedMemoryIds, status }`) would support email digests, task deadline reminders, and weekly reports. Deferred until a second concrete use case arrives — premature generalization would add abstraction without a consumer.
