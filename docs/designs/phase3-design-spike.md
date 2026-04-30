# Phase 3 Design Spike — Decision Memo

> Date: 2026-04-12
> Status: Ready for review
> Prerequisite: harness-improvement-spec.md Phase 1+2 shipped in commit a961f37 + review fixes

---

## Decision 1: Embedding Provider Strategy

### Current state

FlowSpace supports 6 LLM providers: OpenAI, Anthropic, OpenRouter, LM Studio, Claude Code, and Codex. Only OpenAI and OpenRouter have native embedding endpoints. Anthropic, Claude Code, and Codex do not. LM Studio depends on the loaded model (most local models lack embedding support). The `apiKey` from the active provider config is reusable for embedding calls on OpenAI-compatible providers.

No embedding code exists in the codebase. The `embedding?: number[]` field on `MemoryEntry` is defined but never populated.

### Options considered

**A. Always use OpenAI for embeddings (separate from chat provider)**
- Requires a separate OpenAI API key configuration for users on Anthropic/LM Studio
- Guarantees consistent embedding quality across all users
- Adds complexity: two provider configs, two API keys
- Creates an OpenAI dependency even for users who chose not to use OpenAI

**B. Use embeddings only when the active provider supports them**
- OpenAI and OpenRouter users get embeddings. Others get keyword-only retrieval.
- No extra configuration needed
- ~50% of users (Anthropic) get no quality improvement
- Switching providers changes retrieval quality, which is confusing

**C. Tiered strategy: use provider embeddings when available, keyword fallback otherwise**
- Same as B but with explicit fallback contract
- No separate API key needed
- Portable — works with any provider
- Embedding quality varies by provider (acceptable — all are good enough)
- Users on Anthropic/Claude Code get the current keyword retrieval (no regression)

### Recommended decision

**Option C: Tiered strategy with keyword fallback.**

### Why

Portability is a core FlowSpace principle. Requiring a separate OpenAI key for embedding violates the "bring your own provider" model. Users who chose Anthropic or LM Studio made that choice deliberately — forcing an OpenAI dependency for memory quality undermines their decision.

The tiered approach gives the best experience to users whose providers support embeddings (OpenAI, OpenRouter) while preserving the current keyword retrieval for everyone else. There is no regression — Anthropic users get exactly what they have today. When Anthropic adds an embedding API (or when we add a local embedding option like `transformers.js`), those users automatically upgrade.

### Implementation consequence

- `src/agent/memory/memory-embeddings.ts` must check the active provider before attempting embedding calls
- Embedding computation returns `null` when unsupported (not an error)
- Retriever uses dual-path scoring: embedding-weighted when available, keyword-only otherwise
- `MemoryEntry.embedding` is populated only when the provider supports it
- No new settings UI, no separate API key configuration
- Future: a `transformers.js` local embedding option could be added as a provider-independent fallback (out of scope for Phase 3)

---

## Decision 2: Memory File Size and Performance

### Current state

Memory files are JSON, pretty-printed (`null, 2`), synchronous writes via atomic temp+rename. Current largest user file: 22 entries, 21 KB. Max cap: 500 entries.

| Metric | Without embeddings | With 1536-dim embeddings (same file) |
|--------|-------------------|--------------------------------------|
| Entry size (pretty-printed) | ~960 bytes | ~24,400 bytes |
| File at 500 entries | ~354 KB | ~11.6 MB |
| JSON.parse time | ~3.5 ms | ~116 ms |
| JSON.stringify time | ~7 ms | ~232 ms |
| Synchronous write cycle | ~15 ms | ~258 ms |

The write cycle at 500 entries with inline embeddings blocks the Node.js event loop for ~258 ms. This is unacceptable — it would visibly stall every chat response that triggers memory extraction.

### Options considered

**A. Keep embeddings in the same file**
- Simplest code. One file per user.
- 258 ms synchronous event loop block at scale. Unacceptable.

**B. Separate embedding file (`.memory/{userHash}.embeddings.json`)**
- Main memory file stays fast (~354 KB, <15 ms writes)
- Embeddings loaded on-demand at retrieval time (~92 ms parse, once per chat turn)
- Embeddings written separately, can be batched or async
- Two files per user instead of one

**C. In-memory only (no embedding persistence)**
- Zero disk overhead
- Embeddings recomputed every server restart (~500 API calls, ~50 seconds)
- Wastes API quota, adds latency on cold start

**D. SQLite or LevelDB**
- Efficient for large datasets. Overkill at 500 entries.
- Adds a native dependency. Breaks JSON debuggability.

### Recommended decision

**Option B: Separate embedding file.**

### Why

The main memory file must stay fast. Every `createMemory()` and `mergeMemory()` call triggers a synchronous write. At 500 entries with inline embeddings, that's a 258 ms event loop block on every tool execution. Separating embeddings means the hot-path memory operations stay at <15 ms while embeddings are loaded once per retrieval cycle and written in batches.

The separate file also makes embeddings a cleanly optional layer. If a user switches providers and their embeddings become invalid, we can delete the embedding file without touching the memory store. The main memory file remains the source of truth.

### Implementation consequence

- New file: `.memory/{userHash}.embeddings.json` with format `{ version: 1, model: string, entries: { [memoryId: string]: number[] } }`
- `model` field tracks which embedding model produced the vectors. If the user's provider changes and the model differs, all embeddings are invalidated (set to `{}`) and recomputed lazily.
- `memory-store.ts` does NOT write embeddings. A new `memory-embeddings.ts` module owns the embedding file.
- `memory-retriever.ts` loads embeddings on-demand at retrieval time via `loadEmbeddings()`.
- Embedding writes are batched: accumulate during a chat turn, flush once at the end (same pattern as `beginBatch()`/`flushBatch()` for the main store).
- The `embedding` field on `MemoryEntry` in `memory-types.ts` should be removed (or ignored) since embeddings now live in a separate file keyed by memory ID. This avoids the inline storage problem entirely.

---

## Decision 3: threadBriefSuggestion Wiring

### Current state

**Server side:** `generateThreadBriefSuggestion()` in `chat.ts` (lines 59-72) produces a plain string like `"This thread created/modified Job Applications spreadsheet."` It derives this from the most recent resource-category extracted memory. Returned in `AssistantPayload.threadBriefSuggestion`.

**Frontend side:** The `assistant_complete` handler in `ChatContext.tsx` (lines 404-425) reads `payload.blocks`, `payload.toolEvents`, `payload.approval`, `payload.suggestions`, and `payload.content`. It does NOT read `payload.threadBriefSuggestion`. The field is computed, serialized, transmitted, and silently dropped.

**`updateThreadBrief()`** exists at `ChatContext.tsx:676-683`. It is only called from manual UI edit (user types in thread details panel). Never called from stream events.

### Options considered

**A. Auto-apply: automatically set threadBrief from suggestion**
- Invisible mutation. User doesn't know their conversation context changed.
- Could overwrite a manually-set threadBrief with a weaker auto-generated one.
- Violates the "no hidden mutation of thread continuity" principle.

**B. Ask for user confirmation (modal/dialog)**
- Interrupts conversation flow. Annoying for a low-stakes update.
- Over-engineers a minor feature.

**C. Surface as a suggestion action (inline chip)**
- Non-intrusive. Appears alongside other suggestions at the bottom of the assistant message.
- User clicks to apply, or ignores. No hidden mutation.
- Consistent with existing `suggestions[]` pattern (already rendered as clickable chips).
- Low implementation cost: add to suggestions array or render as a separate "Update context" chip.

**D. Defer entirely**
- No work. No value. The field continues to be computed and dropped.

### Recommended decision

**Option D: Defer. Do not wire up threadBriefSuggestion in Phase 3.**

### Why

The current `generateThreadBriefSuggestion()` is too weak to be useful. It only looks at the most recent resource-category memory and produces a single sentence like "This thread created/modified X." This is not meaningfully better than the existing `threadBrief` (which already contains meeting metadata for prep conversations) and adds no value for general conversations.

Wiring it up now would deliver a mediocre experience: a suggestion chip that says "Update context: This thread created/modified Job Applications spreadsheet" — which the user would likely ignore or find confusing. The suggestion system should wait until the generation logic is stronger (e.g., after embedding retrieval enables richer context summarization).

Phase 3's focus is embedding retrieval quality. threadBriefSuggestion is a distraction with low payoff.

### Implementation consequence

- No code changes needed.
- The field continues to be computed and included in the payload (harmless).
- Future work: when `generateThreadBriefSuggestion()` is upgraded to produce `StructuredThreadBrief` objects with richer context (attendees, topics discussed, resources referenced), revisit Option C (suggestion chip).

---

## Decision 4: Context Assembly Contract Gap

### Current state

`assembleContext()` in `context-assembler.ts` returns a **string** (the system prompt). The spec called for a `ContextAssemblyOutput` with `{ systemPrompt, chatMessages, tokenEstimate, truncated }`.

`estimateTokens()` exists and works (length/4 heuristic). `truncateMessages()` exists and works (drops oldest non-system messages). But `truncateMessages()` is **never called in production** — it is exported but no caller exists in `chat.ts` or anywhere else. Context is assembled and sent to the LLM without any budget check.

`CompletionOptions` in `llm-types.ts` has no `max_tokens` or context limit field. The Anthropic provider hardcodes `max_tokens: 4096` for output. Input context is unbounded.

### Options considered

**A. Full upgrade: assembleContext returns ContextAssemblyOutput, integrates truncation**
- `assembleContext()` accepts messages + tool definitions + maxTokens
- Returns `{ systemPrompt, chatMessages, tokenEstimate, truncated }`
- `chat.ts` uses the returned chatMessages (which may be truncated)
- Requires adding per-provider context window limits to LLM settings

**B. Minimal upgrade: wire truncateMessages into chat.ts, keep assembleContext as-is**
- Call `truncateMessages()` in `handleChat()` before `client.complete()`
- Add a hardcoded context budget (e.g., 100K tokens as safe default)
- `assembleContext()` stays unchanged
- Less architectural but immediately protective

**C. Defer entirely**
- Current users haven't hit context overflow in practice
- Embedding retrieval doesn't significantly increase prompt size (memories are already capped at 800 tokens)
- Risk: long conversations could overflow without warning

### Recommended decision

**Option B: Minimal upgrade — wire truncateMessages into chat.ts with a safe default budget.**

### Why

The full upgrade (Option A) is the right long-term architecture, but it requires per-provider context window configuration, changes to the LLM settings schema, and reworking how `handleChat()` assembles its message array. That's a meaningful scope increase for Phase 3.

Option B gives us protection with minimal disruption. The function already exists and is tested. Wiring it in takes ~10 lines in `chat.ts`. A hardcoded 100K token budget is safe for all current providers (Claude 3 = 200K, GPT-4o = 128K, LM Studio varies but typically 4K-32K). For LM Studio users with small context windows, 100K is still too high — but they're already at risk today without any protection. This is strictly better than the current state.

Phase 3 adds embedding retrieval latency (~100ms for query embedding). This doesn't increase prompt tokens (memories are still capped at 800 tokens in the prompt), but it does mean the system is doing more work per turn. Having truncation active prevents the edge case where a long conversation + system prompt + memories exceeds the context window right as we're adding retrieval overhead.

### Implementation consequence

- In `chat.ts` `handleChat()`, after building `chatMessages[]`, call `truncateMessages(chatMessages, MAX_CONTEXT_TOKENS)` before passing to `client.complete()`
- Define `const MAX_CONTEXT_TOKENS = 100_000` in `context-assembler.ts` (or chat.ts)
- Log a warning when truncation occurs: `console.warn('[context] Truncated conversation: dropped N oldest messages to fit budget')`
- `assembleContext()` signature unchanged
- Future: upgrade to per-provider context limits when LLM settings are extended

---

## Phase 3 Readiness Assessment

### Can Phase 3 proceed immediately?

**Yes.** All four decisions are resolved. No blocking unknowns remain.

### Spec updates needed before implementation

The existing Phase 3 task list (T068-T082 in `harness-improvement-tasks.md`) needs these adjustments:

1. **T074-T075 (memory-embeddings.ts):** Update to use separate embedding file instead of inline `MemoryEntry.embedding`. The module owns its own file I/O (`{userHash}.embeddings.json`), not the main memory store.

2. **T076 (embeddingModel in metadata):** Change approach. Instead of per-entry `embeddingModel` in metadata, store `model` once in the embedding file header. Invalidate all embeddings on model change.

3. **T077-T078 (compute embedding in createMemory/mergeMemory):** Change approach. Embedding computation should NOT happen inside memory-store.ts. It should happen in `chat.ts` after memory extraction, calling `memory-embeddings.ts` directly. This keeps the main store fast and embedding-unaware.

4. **T079 (dual-path scoring):** Update to load embeddings from separate file via `loadEmbeddings()` before scoring. Add `embeddings` parameter to `retrieveMemories()`.

5. **Add new task:** Wire `truncateMessages()` into `chat.ts` with 100K token budget (Decision 4).

6. **Add new task:** Provider capability check — `memory-embeddings.ts` must detect whether the active provider supports embeddings before attempting API calls.

### Should the Phase 3 task list be adjusted?

**Yes.** The adjustments above change the storage architecture (separate file vs. inline) and the computation location (chat.ts vs. memory-store.ts). The task list should be regenerated with these decisions baked in. The total task count will be similar (~15 tasks) but the file responsibilities shift.

---

## Summary of Decisions

| # | Topic | Decision | Key reason |
|---|-------|----------|-----------|
| 1 | Embedding provider | Tiered: use when available, keyword fallback otherwise | Preserves portability, no forced OpenAI dependency |
| 2 | Memory file size | Separate `.embeddings.json` file per user | Main memory file stays fast (<15 ms writes), embeddings loaded on-demand |
| 3 | threadBriefSuggestion | Defer — do not wire up in Phase 3 | Current generation logic too weak; low payoff, high distraction risk |
| 4 | Context assembly | Wire `truncateMessages()` into chat.ts with 100K budget | Minimal protective measure; full upgrade deferred to future phase |
