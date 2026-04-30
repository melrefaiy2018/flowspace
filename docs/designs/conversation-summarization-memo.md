# Conversation Summarization Memo

> Date: 2026-04-12
> Status: Implementation-ready
> Prerequisites: Conversation index (conversation-index.ts), Phase 3 embedding retrieval, context-assembler with truncation

---

## 1. Executive Summary

### Why summarization is next

The harness now has a conversation index that tracks conversation existence, metadata, and event linkage. It has memory that captures extracted facts and resources. It has a 100K token context budget with truncation as a safety net. But truncation is lossy — it drops older messages without understanding what was important in them. A user who discussed a complex multi-step plan 30 messages ago loses that context entirely when truncation kicks in. The agent cannot recall decisions that were made, only facts that were extracted into memory.

### What this solves

Conversation summarization replaces brute truncation with semantic compression. Instead of dropping older messages, the harness generates a summary that captures the key intent, decisions, and state of the conversation. This summary is injected into the system prompt, preserving continuity even when raw message history is truncated.

### What it improves immediately

- Long conversations retain their trajectory and decisions, not just extracted facts
- The agent can reference earlier context ("as we discussed, the plan was to...") instead of appearing forgetful
- The 100K budget is used more efficiently: summary (~200-500 tokens) replaces N messages (~5,000-20,000 tokens)

### What it does not solve yet

- Cross-device conversation continuity (messages still in localStorage)
- Automatic conversation archival or cleanup
- Multi-conversation summarization ("what have I been working on this week?")
- Real-time streaming summarization during a turn

---

## 2. Current Gap

### Context assembly relies on raw message history

The frontend sends ALL conversation messages to the server on every chat request (`toChatInput()` in ChatContext.tsx sends the full `existingConv.messages` array). The server assembles a context window of: system prompt (~1,500-1,700 tokens) + all messages + tool results. When this exceeds 100K tokens, `truncateMessages()` drops the oldest middle messages, preserving only the first message and the most recent user message.

### Truncation is a lossy fallback

`truncateMessages()` (context-assembler.ts:142-184) operates on token count alone. It does not know which older messages contain important decisions, plans, or context. A message where the user said "let's go with Option B for the migration" is treated identically to a message where the user said "thanks." Both are equally eligible for truncation based on position.

### Memory captures facts, not trajectory

The memory system extracts resources (spreadsheet IDs, doc titles), facts (emails sent, events created), and workflow patterns. It does not capture:
- The evolving goal of a conversation ("we're planning a team offsite")
- Decisions made during discussion ("we decided to use the downtown venue")
- Unresolved questions ("still need to check the budget with finance")
- The user's working preferences revealed through conversation ("I prefer bullet points for meeting notes")

### The conversation index tracks existence, not understanding

The index stores `messageCount`, `title`, `eventId`, `threadBrief`, and `origin`. It knows a conversation exists and how active it is. It does not know what the conversation is about beyond the initial `threadBrief` (which is set once on creation and rarely updated).

### threadBrief is static

`threadBrief` is set when a conversation is created (typically for meeting prep) and is updated only through `upsertConversation()` — which preserves the value from the most recent chat request. It does not evolve to reflect what the conversation has become. A meeting prep conversation that pivoted to discussing a follow-up project still has its original "Meeting Prep: Q1 Review" brief.

---

## 3. Proposed Design

### What a conversation summary is

A conversation summary is a server-generated distillation of a conversation's content, capturing the objectives, decisions, key context, and current state. It is not a transcript. It is not a replacement for memory entries. It is a compressed representation of the conversation's trajectory that can substitute for older messages in the context window.

### Where it lives

Summaries are stored in a separate per-user file: `DATA_DIR/.conversation-summaries.{userHash}.json`. They do not live inside the conversation index (which should remain lightweight metadata) or inside the memory store (which tracks facts and resources, not conversational flow).

### How it differs from memory

| Aspect | Memory | Summary |
|--------|--------|---------|
| Scope | Individual facts and resources | Entire conversation trajectory |
| Source | Auto-extracted from tool results | LLM-generated from message history |
| Granularity | Per-tool-call entries | Per-conversation document |
| Lifespan | Persists indefinitely (LRU eviction at 500) | Updated per conversation, versioned |
| Use in prompt | Injected as discrete facts | Injected as a context block replacing older messages |

### How it differs from threadBrief

| Aspect | threadBrief | Summary |
|--------|------------|---------|
| Set by | Frontend on conversation creation | Server after message threshold |
| Updated | Rarely (static after creation) | After every qualifying turn |
| Content | Initial context (meeting metadata, event info) | Evolving conversation state |
| Size | Short (~100-500 chars) | Longer (~500-2,000 chars) |
| Purpose | Seed context for the LLM | Replace truncated older messages |

### Per-conversation, versioned over time

Each conversation has at most one active summary. When the summary is regenerated, the version number increments and `updatedAt` is set to the current time. Old versions are not retained — the latest summary is the only one stored. Version tracking exists for debugging and cache invalidation, not for history.

### Incremental updates, not regeneration from scratch

After the first summary is generated (from the full message history available at that point), subsequent updates are incremental: the LLM receives the previous summary plus new messages since the last summary, and produces an updated summary. This avoids re-processing the entire conversation on every turn.

The incremental prompt:
```
Here is the current summary of this conversation:
{previousSummary}

The following new messages have been exchanged since the summary was last updated:
{newMessages}

Update the summary to incorporate the new messages. Preserve all important decisions, 
objectives, and context from the existing summary. Add any new decisions, context, 
or state changes from the new messages. Keep the summary concise (under 500 words).
```

---

## 4. Source of Truth Decision

### Ownership boundaries

| Data | Owner | Purpose |
|------|-------|---------|
| Full message history | Frontend (localStorage) | Authoritative record of what was said |
| Recent messages (last N) | Sent to server per request | Direct LLM context |
| Conversation summary | Server (summary store) | Compressed replacement for older messages |
| threadBrief | Frontend (localStorage), copied to server | Initial conversation context seed |
| Memory entries | Server (memory store) | Extracted facts and resources |
| Conversation index | Server (index store) | Metadata and event linkage |

### Raw messages remain the source of truth for recent turns

The summary never replaces the most recent messages. It replaces older messages that would otherwise be truncated. The LLM always sees: system prompt + summary (if exists) + recent messages + current user message.

### The summary is authoritative for older conversational intent

Once older messages are summarized and those messages would be truncated anyway, the summary is the only representation of that content available to the LLM. This is acceptable because: (a) the summary is generated by the same class of LLM that would have read those messages, (b) memory entries provide a separate factual checkpoint, and (c) the full messages still exist in the frontend for the user to review.

### Avoiding conflict between threadBrief, memory, and summary

- **threadBrief** is the seed context. It describes what the conversation was created for. It is included in the system prompt always.
- **Summary** is the evolved context. It describes what the conversation has become. It is included in the system prompt only when the conversation is long enough to need it.
- **Memory** entries are discrete facts. They are retrieved by relevance to the current query, not by conversation.

There is no conflict because they serve different purposes and occupy different positions in the prompt:
1. System prompt header (agent identity, time, guidelines)
2. threadBrief (initial context — always present if set)
3. Memory (relevant facts — up to 5 entries, 800 token budget)
4. Summary (older conversation context — present only for long conversations)
5. Recent messages (last N messages that fit in budget)
6. Current user message

---

## 5. Trigger Strategy

### Options evaluated

| Strategy | Pros | Cons |
|----------|------|------|
| Message count threshold (e.g., >20) | Simple, predictable | Doesn't account for message length variation |
| Token estimate threshold (e.g., >50K tokens in history) | Directly aligned with the problem | Requires token counting per request |
| Manual only | No latency impact | Users won't use it |
| Background after each turn | Always fresh | Wasteful for short conversations |
| Lazy: generate only when truncation would occur | Perfectly targeted | First summarization delays the response |

### Recommended strategy: Token estimate threshold with lazy generation

**Trigger condition:** Before truncation, estimate total conversation tokens. If the conversation history (excluding system prompt) exceeds **30,000 tokens** and no summary exists or the summary is stale (more than 10 new messages since last summary), generate or update the summary.

**Why 30K tokens:** The 100K budget minus ~2K system prompt minus ~800 memory tokens leaves ~97K for messages. Triggering at 30K means the summary is generated well before truncation would activate, giving the system time to compress without urgency. At an average of ~150 tokens per message pair (user + assistant), 30K tokens is roughly 200 message pairs or 100 chat turns — a genuinely long conversation.

**When the summary is updated:** On the first qualifying turn after the threshold is crossed, and then every 10 subsequent turns (tracked via `messageCountAtLastSummary` in the summary record). Updates are not on every turn — the incremental cost is bounded.

**Synchronous or deferred:** Synchronous on the first generation (blocks the response by ~1-3 seconds for the summarization LLM call). Subsequent incremental updates are also synchronous but faster (~0.5-1 second, smaller input). The latency is acceptable because it only occurs for long conversations that are already slow due to large context.

**What happens if summary generation fails:** The harness falls back to truncation (current behavior). Summary failure is logged but does not block the chat response. The next qualifying turn will retry.

---

## 6. Summary Schema

```typescript
interface ConversationSummary {
  conversationId: string;
  version: number;                    // Incremented on each update
  updatedAt: number;                  // Timestamp of last generation
  messageCountAtLastSummary: number;  // messageCount when summary was generated
  summaryText: string;                // Plain text summary (under 500 words)
  sections?: SummarySections;         // Optional structured fields (Phase 2)
}

interface SummarySections {
  objective?: string;                 // What the user is trying to accomplish
  decisions?: string[];               // Key decisions made during the conversation
  resources?: string[];               // Important docs, sheets, emails referenced
  openQuestions?: string[];           // Unresolved items
  currentState?: string;             // Where the work stands right now
}

interface ConversationSummaryStore {
  version: 1;
  summaries: Record<string, ConversationSummary>;  // Keyed by conversationId
}
```

### First implementation: plain summaryText only

The `sections` field exists in the type but is not populated in the first slice. The LLM generates a plain text summary. Structured extraction (objectives, decisions, open questions) is a follow-up improvement that can be added by changing the summarization prompt, not the storage or integration code.

**Why text first:** Structured extraction requires a more complex prompt and output parsing, which adds failure modes. Plain text summarization is reliable, easy to verify, and immediately useful for context continuity. The structured fields can be added later by extending the prompt and parsing the output.

---

## 7. Integration with Context Assembly

### Where the summary enters the prompt

In `context-assembler.ts`, `buildSystemPrompt()` will accept an optional `conversationSummary?: string` parameter. When present, it is rendered as a labeled section after threadBrief and memory, before the guidelines:

```
--- Conversation summary (last updated: {timestamp}) ---
{summaryText}
--- End of conversation summary ---
```

### When summary replaces older messages

The integration happens in `chat.ts` `handleChat()`, between context assembly and truncation:

```
1. Build chatMessages = [system prompt, ...all messages]
2. IF summary exists for this conversation:
   a. Estimate tokens of all messages
   b. IF tokens > 30K:
      - Inject summary into system prompt (via assembleContext)
      - Remove messages older than the summary's messageCountAtLastSummary
      - Keep only recent messages (since last summary) + current turn
3. Apply truncateMessages() as a safety net (unchanged)
4. Call client.complete()
```

### Summary interaction with other context layers

| Layer | Interaction with summary |
|-------|------------------------|
| threadBrief | Both included. threadBrief is the seed; summary is the evolution. No conflict. |
| Retrieved memories | Both included. Memories provide specific facts; summary provides trajectory. They complement each other. |
| Truncation | Summary reduces reliance on truncation. Truncation remains as a safety net for edge cases where summary + recent messages still exceed budget. |
| Persona | No interaction. Persona is applied to the final response, not the summary. |

### Precedence in the system prompt

```
1. Agent identity + time + timezone
2. threadBrief (if present)
3. Retrieved memories (up to 5, 800 token budget)
4. Conversation summary (if present, for long conversations only)
5. Guidelines and tool instructions
6. Persona prompt
```

The summary is positioned between memories and guidelines because it provides broader context than discrete memory facts but is less structural than the agent's behavioral guidelines.

---

## 8. Persistence Design

### File path

```
DATA_DIR/.conversation-summaries.{userHash}.json
```

Separate from the conversation index (`.conversations.{userHash}.json`) to keep the index lightweight and fast. The index is read on every chat request; the summary store is read only when the conversation is long enough to need it.

### Per-user scoping

Same `userHash` (SHA256 first 16 hex chars of email) used by memory-store.ts, memory-embeddings.ts, and conversation-index.ts.

### File format

```json
{
  "version": 1,
  "summaries": {
    "conv-abc-123": {
      "conversationId": "conv-abc-123",
      "version": 3,
      "updatedAt": 1776026018000,
      "messageCountAtLastSummary": 45,
      "summaryText": "The user is planning a team offsite for Q2. They decided on the downtown venue after comparing three options. Budget approval is pending from finance. Key documents: Venue Comparison spreadsheet, Offsite Agenda draft. Open question: catering vendor selection."
    }
  }
}
```

### Atomic write

Same pattern as all other harness stores: write to temp file, rename. Pretty-printed JSON (file is small — even 100 conversations with summaries is ~200 KB).

### Schema versioning

`version: 1` in the store root. On load, if version is missing or unexpected, return empty store. Summaries are generated, not authoritative — losing them causes a one-time regeneration, not data loss.

---

## 9. File-by-File Plan

| File | Action | Purpose | Complexity | Notes |
|------|--------|---------|------------|-------|
| `src/agent/conversation-summary.ts` | Create | Summary store: load, save, get, upsert. Summary generation: prompt construction, LLM call, incremental update. | Medium | ~200 lines. Core module. |
| `src/shared/chat.ts` | Modify | Export `ConversationSummary` and `ConversationSummaryStore` types | Low | ~5 lines |
| `src/agent/context-assembler.ts` | Modify | Add `conversationSummary?: string` to `AssembleContextOptions` and `buildSystemPrompt()`. Render summary section in prompt. | Low | ~15 lines |
| `src/agent/chat.ts` | Modify | In `handleChat()`: load summary, check trigger, generate/update if needed, inject into assembleContext, trim old messages when summary covers them. | Medium | ~40 lines |
| `server.ts` | No change | Summary generation happens inside `handleChat()`, not in the endpoint handler. | — | — |
| `src/agent/__tests__/conversation-summary.test.ts` | Create | Unit tests for store CRUD, trigger logic, prompt construction, incremental update. | Medium | ~200 lines |
| `src/agent/__tests__/context-assembler.test.ts` | Modify | Add test for summary rendering in system prompt. | Low | ~15 lines |

---

## 10. Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 1 | Summary created when conversation exceeds 30K tokens | Send messages totaling >30K tokens. Verify `.conversation-summaries.{userHash}.json` contains a summary for that conversation. |
| 2 | Summary persisted per conversation | Create two long conversations. Verify each has its own summary entry in the store. |
| 3 | Summary reused on later requests | Send a message in a long conversation with an existing summary. Verify the summary is included in the system prompt without regeneration (check `messageCountAtLastSummary` vs current count — within 10, no update). |
| 4 | Summary updated after 10 new messages | Send 10 messages after a summary was generated. Verify the summary `version` increments and `summaryText` reflects the new messages. |
| 5 | Context assembly uses summary | In a long conversation with a summary, verify the system prompt includes the summary section. Verify older messages (before the summary point) are not sent to the LLM. |
| 6 | Token usage reduced | Compare context token estimates for a 50-turn conversation with and without summarization. Verify the summarized version uses significantly fewer tokens. |
| 7 | Summary failure does not break chat | Mock the LLM to fail during summary generation. Verify the chat response still works (falls back to truncation). |
| 8 | No message history in summary file | Read the summary file. Verify it contains only `summaryText` and metadata, not individual messages. |
| 9 | Legacy conversations work | Send a message in a short conversation (under 30K tokens). Verify no summary is generated and behavior is identical to pre-summarization. |
| 10 | Incremental update uses previous summary | After updating a summary, verify the generation prompt includes the previous summaryText (not the full message history). |
| 11 | Summary renders correctly in prompt | Verify the system prompt includes the summary between memories and guidelines, wrapped in labeled markers. |

---

## 11. Risks and Constraints

| Risk | Severity | Mitigation |
|------|----------|------------|
| Storing conversation content on server | Medium | Summary is a distillation, not a transcript. Under 500 words. No individual messages stored. User's full history remains in localStorage only. |
| Summary drift from actual conversation | Medium | Incremental updates every 10 messages keep the summary current. If drift is detected (summary contradicts recent messages), the user can trigger a full regeneration. |
| Duplication with memory | Low | Memory captures extracted facts (spreadsheet IDs, email subjects). Summary captures trajectory (goals, decisions, open questions). They serve different retrieval patterns and prompt positions. |
| Duplication with threadBrief | Low | threadBrief is the seed context (static). Summary is the evolved context (dynamic). Both are included in the prompt. threadBrief is typically 1-2 sentences; summary is 1-2 paragraphs. The overlap is minimal. |
| Summary quality too weak | Medium | The summarization prompt is explicit about what to capture (decisions, objectives, open questions, current state). If quality is insufficient, the prompt can be improved without changing the architecture. The fallback (truncation) ensures no regression. |
| Extra latency from synchronous generation | Medium | First generation adds ~1-3 seconds. Incremental updates add ~0.5-1 second. This only affects long conversations (>30K tokens / ~100 turns). For these conversations, the latency is a small fraction of the total LLM call time. |
| LLM cost for summary generation | Low | One extra LLM call every 10 turns for long conversations. The input is the previous summary (~500 tokens) plus ~10 new messages (~1,500 tokens). Output is ~500 tokens. Total: ~2,500 tokens per update. At $0.01/1K tokens, this is $0.025 per update. |

### How the design avoids these risks

1. **No transcript storage.** The summary is capped at 500 words. The store schema has no `messages` field.
2. **Incremental updates.** The LLM sees the previous summary + new messages, not the full history. This limits drift to the most recent 10-turn window.
3. **Fallback to truncation.** If summarization fails, the system behaves exactly as it did before this feature. No regression.
4. **Trigger threshold.** Summarization only activates for genuinely long conversations (>30K tokens). Short conversations are unaffected.

---

## 12. Future Compatibility

### Better long-horizon continuity

Summaries enable the agent to maintain coherent context across 200+ turn conversations. Without summarization, the 100K budget truncates older context. With summarization, a 500-word summary replaces 20,000+ tokens of older messages, extending effective conversation length by an order of magnitude.

### Conversation-scoped memory

Summaries provide a natural bridge to conversation-scoped memory. A future improvement could extract structured facts from the summary (decisions, resources, open questions) and store them as conversation-scoped memory entries — queryable by other conversations but tagged with their source conversation.

### Stronger proactive flows

The horizon scanner already checks `isEventAlreadyPrepped()`. With summaries, it could also check "what was the outcome of the last prep conversation?" by reading the summary. This enables richer proactive suggestions: "You prepped for the Q1 review last week. The open question was budget approval — would you like me to follow up?"

### Improved threadBrief evolution

Summaries could auto-update threadBrief with a distilled version of the summary's objective and current state. This would make threadBrief dynamic without requiring manual user input. Deferred because it changes the threadBrief ownership model (currently frontend-set, would become server-updated).

### Cross-device continuity

Summaries are server-side. If the product ever supports cross-device access (via server-side message storage or sync), summaries provide a ready-made context bridge: a new device can load the summary to understand what happened in a conversation without downloading the full message history.

---

## 13. Final Recommendation

### First implementation slice: Summary generation and context injection

**Goal:** Create the summary store, implement the trigger (>30K tokens, every 10 messages), generate plain text summaries via LLM call, inject summaries into the system prompt, trim old messages when summary covers them.

**Files:** `src/agent/conversation-summary.ts` (create), `src/shared/chat.ts` (modify), `src/agent/context-assembler.ts` (modify), `src/agent/chat.ts` (modify), `src/agent/__tests__/conversation-summary.test.ts` (create), `src/agent/__tests__/context-assembler.test.ts` (modify).

**Scope:** Acceptance criteria 1-11 all pass. Long conversations retain their trajectory through summarization. Short conversations are unaffected.

### Second slice: Structured summary sections

**Goal:** Extend the summarization prompt to produce structured output (objective, decisions, resources, open questions, current state). Parse the LLM output into `SummarySections`. Use structured fields for richer context assembly (e.g., "Open questions" rendered as a bullet list in the prompt).

**Files:** `src/agent/conversation-summary.ts` (modify prompt and parsing), `src/agent/context-assembler.ts` (modify rendering).

### Why this sequence

The first slice delivers the core value: long conversations stop losing context. Plain text summarization is reliable, easy to verify, and immediately useful. The structured extraction in the second slice is a quality improvement that builds on the working summarization pipeline — it changes the prompt and output parsing, not the trigger, storage, or integration logic.

Both slices are independently valuable. The first slice can ship and prove value before the second slice is started. If summary quality with plain text is sufficient, the second slice can be deprioritized in favor of other harness improvements.
