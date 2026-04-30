# FlowSpace Harness Improvement Spec

> Date: 2026-04-12
> Branch: 004-gmail-tab-v1
> Status: Implementation-ready
> Prerequisite: [agent-harness-analysis.md](./agent-harness-analysis.md)

---

## 1. Executive Summary

### What is broken

The FlowSpace agent harness has a working memory system that does not actually learn from usage. `incrementAccess()` is dead code, so memory ranking ignores real access patterns. Retrieval is keyword-only, missing semantic matches. Proactive meeting prep gathers rich context but does not index it into memory and does not link discussions to conversations via `eventId`. The server is stateless about conversations, limiting continuity. Dynamic tool steps bypass write approval entirely, creating a trust gap. `tools.ts` is a 2900-line monolith.

### What is being fixed first

Phase 1 fixes the five highest-impact bugs: activate memory access tracking, widen extraction coverage, link draft discussions to conversations, index draft context into memory, add server-side approval field validation, and close the dynamic tool approval gap.

### Why this improves agent responses

Memory ranking becomes data-driven instead of creation-time-frozen. More tool results enter memory, so the agent has richer recall. Proactive context persists across sessions. Approval safety is restored for dynamic tools.

### Why this follows "your harness, your memory"

Every fix targets the harness layer — the code between the user and the model. Memory, tools, approval, and session continuity are harness responsibilities. The model does not change. The provider does not change. Only the harness improves.

---

## 2. Scope and Goals

### In scope

- Fix memory access tracking (dead code activation)
- Widen memory extraction to cover all tools
- Link draft discussions to conversations via `eventId`
- Index proactive draft context into memory
- Close dynamic tool write-approval gap
- Add server-side approval field validation
- Split `tools.ts` into focused modules
- Extract `ContextAssembler` with token budget tracking
- Extract `ApprovalRuntime` as explicit module
- Batch memory writes
- Add embedding-based memory retrieval
- Evolve `threadBrief` toward a structured contract

### Out of scope

- Server-side conversation storage (only a lightweight index is considered)
- UI redesign of approval cards
- New tool development
- LLM provider changes
- Tauri/desktop-specific changes
- Conversation summarization (deferred to after embedding retrieval proves value)

### Success criteria

| Criterion | Measurable test |
|-----------|-----------------|
| Memory access tracking works | After retrieving a memory, its `accessCount` increments and `lastAccessedAt` updates. Verified by unit test. |
| Memory extraction covers all tools | Execute a tool not in the current 12-tool switch. Verify a memory entry is created. |
| Draft discussions link to events | Click "Discuss" on a draft, then navigate to CalendarPage. "Resume prep" button appears for that event. |
| Draft context enters memory | Generate a draft with linked docs. Start a new conversation about one of those docs. Verify the memory is retrieved. |
| Dynamic tool write steps require approval | Create a dynamic tool with a `send_email` step. Execute it. Verify the step halts for approval. |
| Approval field validation works server-side | Submit an approval with an empty required field. Verify server returns error without executing. |
| Embedding retrieval improves recall | Store a memory about "quarterly revenue report". Query "Q1 financial summary". Verify it ranks in top 5. |
| tools.ts split complete | No file exceeds 800 lines. All existing tests pass. |

### Non-goals

- Achieving 100% memory precision (some noise is acceptable)
- Building a full vector database
- Making the frontend a thin client
- Abstracting away provider-specific behavior

---

## 3. Recommended Implementation Strategy

### Order: Option A, then B, then embeddings from C

**Phase 1 (Option A):** Fix the five highest-impact bugs. Each is under 50 lines of change. Each is independently testable. Total: 1-2 days.

**Phase 2 (Option B):** Split the monolith and extract modules. This is prerequisite cleanup that makes Phase 3 safer. Total: 2-3 days.

**Phase 3 (Embeddings from Option C):** Add embedding-based retrieval. This is the single highest-leverage quality improvement identified in the exploration. Keyword matching is the primary bottleneck. Total: 2-3 days.

### Why this order

Phase 1 first because it fixes bugs that actively degrade quality today — dead access tracking, missing memory entries, broken draft linking, and a real approval safety gap. These are cheap fixes with immediate impact.

Phase 2 second because the tools.ts monolith and inline context assembly make Phase 3 harder to implement and test. Clean module boundaries reduce the risk of the embedding integration.

Embeddings third because they require a working memory system (Phase 1) and a clean context assembler (Phase 2) to integrate properly. Embedding computation also introduces a new external dependency (embedding model) that benefits from the cleaner architecture.

---

## 4. Phase 1: Immediate Quality Fixes

### 4.1 Fix memory access tracking

**Problem:** `incrementAccess()` is defined in `memory-store.ts:243-250` but never called. The retriever's scoring formula uses `accessCount` (weight 0.015 per access, capped at 0.1) and `lastAccessedAt` (recency decay 0.005/day from 0.15 max) but these fields are frozen at creation time.

**Files to change:**
- `src/agent/memory/memory-retriever.ts` — add `incrementAccess()` calls after selecting memories for prompt

**Functions involved:**
- `retrieveMemories()` in memory-retriever.ts — after filtering and sorting results, call `incrementAccess(entry.id)` for each selected memory
- `incrementAccess()` in memory-store.ts — already implemented, just needs to be called

**Expected behavior after change:**
- When memories are selected for prompt injection, their `accessCount` increments and `lastAccessedAt` updates
- Frequently accessed memories score higher on subsequent retrievals
- Unused memories decay in ranking over time

**Edge cases:**
- Memory selected but chat request fails: access is already tracked. Acceptable — the memory was relevant to the query.
- Same memory selected multiple times in one session: access count reflects actual usage frequency. This is correct behavior.

**Tests required:**
- Unit test: create 3 memories, retrieve with a query that matches 2 of them, verify those 2 have `accessCount: 1` and updated `lastAccessedAt`
- Unit test: retrieve the same memories again, verify `accessCount: 2`
- Integration test: run a chat turn, verify accessed memories have updated tracking

**Acceptance criteria:** After a retrieval cycle, selected memories show incremented `accessCount` and current `lastAccessedAt`. Non-selected memories remain unchanged.

---

### 4.2 Widen memory extraction coverage

**Problem:** Only 12 tools have explicit extractors in `memory-extractor.ts:296-335`. The remaining ~28 static tools, all dynamic tools, and the meta-tool silently skip memory extraction. New tools added to the system will also skip memory.

**Files to change:**
- `src/agent/memory/memory-extractor.ts` — add a generic fallback extractor

**Functions involved:**
- `extractFromToolResult({ toolName, args, result })` — add a `default` case in the switch statement

**Generic extractor design:**
```
default:
  return [{
    category: 'fact',
    content: `Used ${toolName}: ${summarizeArgs(args, 120)}`,
    tags: [toolName, ...extractTagsFromText(JSON.stringify(args))],
    metadata: { toolName, timestamp: new Date().toISOString() },
    resourceIds: extractResourceIds(args),  // pull any *Id fields from args
    source: { type: 'auto_extraction', toolName },
  }]
```

**Helper: `extractResourceIds(args)`** — scan args object for keys ending in `Id`, `_id`, or named `id`, `fileId`, `spreadsheetId`, `docId`, `threadId`, `eventId`. Return as `string[]` for dedup.

**Helper: `summarizeArgs(args, maxLen)`** — JSON.stringify args, truncate to `maxLen` chars, append `...` if truncated.

**Expected behavior after change:**
- Every tool execution that succeeds creates at least a basic memory entry
- Specific extractors (existing 12) still run for their tools (higher quality entries)
- Generic extractor runs for everything else
- Dynamic tools now produce memory entries

**Edge cases:**
- Tool with no meaningful args (e.g., `list_tasks` with no filter): generic entry is low value but harmless. LRU eviction will clean it up if unused.
- Tool returning huge result: we only extract from args, not result, in the generic case. Result parsing stays tool-specific.

**Tests required:**
- Unit test: call `extractFromToolResult` with a tool name not in the switch. Verify a `fact` category entry is returned.
- Unit test: verify existing specific extractors still run for their tools (not overridden by generic).
- Unit test: args with `fileId` field → verify `resourceIds` includes it.

**Acceptance criteria:** Any tool execution (static, dynamic, or meta) that succeeds produces at least one memory entry.

---

### 4.3 Link draft discussions to conversation continuity

**Problem:** `handleDiscussDraft()` in App.tsx (lines 481-500) creates a new conversation with `threadBrief` but does NOT pass `eventId`. This means CalendarPage's `findConversationByEventId()` cannot find draft discussions.

**Files to change:**
- The file containing `handleDiscussDraft()` (App.tsx, lines 481-500)

**Functions involved:**
- `handleDiscussDraft()` — add `eventId: draft.meetingId` to the `sendMessage()` options
- `sendMessage()` in ChatContext.tsx — already accepts `eventId` in options (line 511)

**Change:**
```
// Current (line 496-500):
sendMessage(prompt, {
  forceNewChat: true,
  displayContent: ...,
  threadBrief: ...,
});

// After:
sendMessage(prompt, {
  forceNewChat: true,
  displayContent: ...,
  threadBrief: ...,
  eventId: draft.meetingId,
});
```

**Expected behavior after change:**
- Draft discussion conversations have `eventId` set to the Google Calendar event ID
- CalendarPage "Resume prep" button works for events that were discussed via DraftQueue
- `findConversationByEventId()` returns draft discussion conversations

**Edge cases:**
- Multiple drafts for same meeting (shouldn't happen due to dedup by `meetingId`, but if it does): both discussions link to the same event. `findConversationByEventId()` returns the most recent, which is correct.
- User preps a meeting from CalendarPage AND from DraftQueue: two conversations share the same `eventId`. Resume picks the most recent.

**Tests required:**
- Unit test: mock `sendMessage`, call `handleDiscussDraft` with a draft, verify `eventId` is passed
- Integration test: create a draft discussion, verify `findConversationByEventId(draft.meetingId)` returns it

**Acceptance criteria:** After clicking "Discuss" on a draft, navigating to CalendarPage shows "Resume prep" for that meeting's event.

---

### 4.4 Index proactive draft context into memory

**Problem:** Horizon scanner gathers linked docs and related emails per meeting but this context is only embedded in the draft's text content. It never enters the memory system. When a user starts a new conversation about one of those docs, the agent cannot recall it.

**Files to change:**
- `src/agent/horizon-scanner.ts` — after generating a draft, call `mergeMemory()` for each `linkedDoc` and `relatedEmail`

**Functions involved:**
- The function that produces `StagedDraft` results — add memory indexing after draft generation
- `mergeMemory()` from memory-store.ts — already handles dedup by `resourceIds`
- `initMemoryStore()` from memory-store.ts — must be called first with user email

**Memory entries to create per draft:**

For each `linkedDoc`:
```
{
  category: 'resource',
  content: `${doc.title} — linked to meeting "${draft.meetingTitle}" on ${draft.meetingTime}`,
  tags: [...extractTagsFromText(doc.title), 'meeting-prep', ...extractTagsFromText(draft.meetingTitle)],
  metadata: { fileId: doc.id, url: doc.url, meetingId: draft.meetingId, meetingTitle: draft.meetingTitle },
  resourceIds: [doc.id],
  source: { type: 'auto_extraction', toolName: 'horizon_scanner' },
}
```

For each `relatedEmail`:
```
{
  category: 'fact',
  content: `Email "${email.subject}" from ${email.from} — related to meeting "${draft.meetingTitle}"`,
  tags: [...extractTagsFromText(email.subject), 'meeting-prep', email.from],
  metadata: { threadId: email.threadId, meetingId: draft.meetingId },
  resourceIds: [email.threadId],
  source: { type: 'auto_extraction', toolName: 'horizon_scanner' },
}
```

**Expected behavior after change:**
- After horizon scan completes, linked docs and related emails are in the memory store
- `mergeMemory()` deduplicates by `resourceIds` — if the same doc appears in multiple meetings, the entry is updated, not duplicated
- Future conversations can retrieve these memories by keyword match (and later by embedding similarity)

**Edge cases:**
- Horizon scanner runs without user email context: memory init requires user email. Verify that the scanner has access to user email or skip memory indexing if unavailable.
- Draft with no linked docs or emails: no memory entries created. Acceptable.
- Same doc linked to multiple meetings: `mergeMemory()` updates the existing entry, merging tags and metadata. The `meetingTitle` in metadata will reflect the last meeting. Acceptable.

**Tests required:**
- Unit test: generate a draft with 2 linked docs and 1 related email. Verify 3 memory entries created.
- Unit test: generate two drafts linking the same doc. Verify only 1 memory entry exists (merged).
- Integration test: generate a draft, then start a new conversation querying for a linked doc. Verify the memory is retrieved.

**Acceptance criteria:** After a horizon scan, linked docs and related emails are findable via memory retrieval in any conversation.

---

### 4.5 Close dynamic tool write-approval gap

**Problem:** Dynamic tool steps execute via `executeTool()` in `tool-composer.ts:181` without checking `isWriteTool()`. A user-created dynamic tool containing `send_email` or `trash_email_threads` steps will execute those write operations without approval. This is a trust violation.

**Files to change:**
- `src/agent/tool-composer.ts` — add `isWriteTool()` check before each step execution

**Functions involved:**
- `executeDynamicTool()` in tool-composer.ts (lines 157-238) — the step loop
- `isWriteTool()` from tools.ts — already exists
- `buildApprovalRequest()` from tools.ts — already exists

**Design decision:** Dynamic tool steps that are write operations must halt execution and return an approval request, just like static tools in `handleChat()`. The remaining steps are deferred until approval is granted.

**Implementation approach:**

In the step loop (tool-composer.ts line 167-215), before `executeTool(step.action, resolvedArgs, signal)`:
```
if (isWriteTool(step.action)) {
  const approval = buildApprovalRequest(step.action, resolvedArgs);
  approval.toolArgs = { ...resolvedArgs, _dynamicToolName: name, _stepIndex: i, _remainingSteps: steps.slice(i + 1) };
  return { type: 'approval_required', approval, completedSteps: results };
}
```

The return type of `executeDynamicTool()` must change from `string` to `{ type: 'completed', result: string } | { type: 'approval_required', approval: ApprovalRequest, completedSteps: StepResult[] }`.

In `chat.ts`, when a dynamic tool returns `approval_required`, handle it the same as a static write tool: emit the approval event and return.

**Post-approval resume for dynamic tools:** After approval, `executeApprovedAction()` must detect the `_dynamicToolName` and `_stepIndex` in `toolArgs`, execute the approved step, then continue executing remaining steps. If another write step is encountered, halt again.

**Expected behavior after change:**
- Dynamic tools with write steps pause at each write step for approval
- Read steps within dynamic tools execute immediately (no change)
- The user sees the same approval card they would see for a direct write tool call
- After approval, remaining steps continue

**Edge cases:**
- Dynamic tool with multiple write steps: each one halts sequentially. User approves each.
- Dynamic tool with only read steps: no change in behavior.
- Approval dismissed for a mid-workflow step: remaining steps do not execute. Partial results from completed read steps are still available.
- Dynamic tool step references a previous write step's result: the write step's result is available after approval, so template interpolation works.

**Tests required:**
- Unit test: create dynamic tool with `search_drive` + `send_email` steps. Execute. Verify first step runs, second step returns approval.
- Unit test: create dynamic tool with only read steps. Verify all execute without approval.
- Unit test: approve the write step, verify remaining steps execute.
- Integration test: end-to-end dynamic tool with write step, verify approval card appears.

**Acceptance criteria:** No write tool can execute without user approval, whether called directly or as a dynamic tool step.

---

### 4.6 Add server-side approval field validation

**Problem:** `executeApprovedAction()` in chat.ts (lines 712-745) reconstructs tool args from edited fields but does not validate them. Empty required fields or malformed values pass through to `executeTool()` and fail deep in gws CLI execution.

**Files to change:**
- `src/agent/chat.ts` — add validation in `executeApprovedAction()` before calling `executeTool()`

**Functions involved:**
- `executeApprovedAction()` — add validation step after arg reconstruction
- New: `validateApprovalFields(toolName, args)` — per-tool required field validation (mirrors frontend's `requiredFields` logic in ChatThread.tsx:589-626)

**Validation rules (per tool):**
| Tool | Required fields |
|------|----------------|
| `send_email` | `to`, `subject`, `body` |
| `create_calendar_event` | `title`, `start_time` |
| `create_task` | `title` |
| `docs_write` | `doc_id`, `content` |
| `sheets_create` | `title` |
| All others | No required fields (tool-specific validation in gws) |

**Expected behavior after change:**
- If a required field is empty or missing, `executeApprovedAction()` returns an error payload: `{ content: "Cannot execute: missing required field '{fieldName}'", blocks: [status block], toolEvents: [error event] }`
- Tool is NOT executed
- User sees the error in the chat

**Edge cases:**
- Field with only whitespace: treat as empty (trim before validation)
- Dynamic tool approval: no field validation (fields are not editable for dynamic tools, args are preserved in `toolArgs`)

**Tests required:**
- Unit test: submit approval for `send_email` with empty `to` field. Verify error returned, tool not executed.
- Unit test: submit approval for `send_email` with all fields present. Verify tool executes.
- Unit test: submit approval for a tool not in the required fields map. Verify tool executes (no validation applied).

**Acceptance criteria:** Server rejects approvals with missing required fields before executing any tool.

---

## 5. Phase 2: Harness Modularization

### 5.1 Split tools.ts

**Purpose:** Reduce the 2900-line monolith into focused modules, each under 800 lines.

**Files to create:**
| New file | Content | Est. lines |
|----------|---------|-----------|
| `src/agent/tool-definitions.ts` | `TOOL_DEFINITIONS` array, `WRITE_TOOL_NAMES` set, `isWriteTool()` | ~600 |
| `src/agent/tool-dispatch.ts` | `executeTool()`, `executeGws()`, helper functions | ~700 |
| `src/agent/tool-approval.ts` | `buildApprovalRequest()`, approval message generators | ~500 |

**Files to modify:**
| File | Change |
|------|--------|
| `src/agent/tools.ts` | Delete — replaced entirely by three new files |
| `src/agent/chat.ts` | Update imports: `isWriteTool` from tool-definitions, `executeTool` from tool-dispatch, `buildApprovalRequest` from tool-approval |
| `src/agent/dynamic-tool-bridge.ts` | Update import: `TOOL_DEFINITIONS` from tool-definitions |
| `src/agent/tool-composer.ts` | Update import: `executeTool` from tool-dispatch, `isWriteTool` from tool-definitions (after Phase 1 fix) |
| `src/agent/memory/memory-extractor.ts` | No change (does not import from tools.ts) |

**Migration approach:**
1. Create three new files with content copied from tools.ts
2. Update all imports (grep for `from './tools'` and `from '../tools'`)
3. Delete tools.ts
4. Run `npm run lint` (tsc --noEmit) to verify no broken imports
5. Run `npm test` to verify no behavior change

**Compatibility concerns:** None. This is a pure refactor. No exported names change. No API shapes change.

**Tests required:**
- Run full existing test suite — must pass unchanged
- Verify `npm run lint` passes
- Smoke test: send a chat message with tool use, verify tools execute correctly

**Acceptance criteria:** tools.ts is deleted. Three new files exist. All tests pass. No file exceeds 800 lines.

---

### 5.2 Extract ContextAssembler

**Purpose:** Move context assembly into a dedicated module with token budget tracking and explicit inputs.

**Files to create:**
| New file | Content | Est. lines |
|----------|---------|-----------|
| `src/agent/context-assembler.ts` | `assembleContext()`, `buildSystemPrompt()`, `estimateTokens()`, `truncateMessages()` | ~200 |

**Files to modify:**
| File | Change |
|------|--------|
| `src/agent/chat.ts` | Remove `buildSystemPrompt()` (lines 71-153). Replace with `import { assembleContext } from './context-assembler'`. Call `assembleContext()` at the top of `handleChat()`. |

**Interface:**
```typescript
interface ContextAssemblyInput {
  persona?: Persona;
  threadBrief?: string;
  retrievedMemories: RetrievedMemory[];
  userTz: string;
  messages: ChatMessageInput[];
  toolDefinitions: ToolFunctionDef[];
  maxTokens?: number;  // provider context limit, default 128000
}

interface ContextAssemblyOutput {
  systemPrompt: string;
  chatMessages: ChatMessage[];
  tokenEstimate: number;
  truncated: boolean;  // true if messages were dropped to fit budget
}

function assembleContext(input: ContextAssemblyInput): ContextAssemblyOutput;
```

**Token estimation:** Use `Math.ceil(text.length / 4)` as a conservative estimate. This is the same heuristic already used in `memory-retriever.ts`.

**Truncation strategy:**
1. Estimate total tokens: system prompt + all messages + tool definitions overhead (~2000 tokens)
2. If over budget: remove oldest non-system messages first (keep most recent 80% of budget)
3. Never truncate the system prompt or the most recent user message

**Migration approach:**
1. Extract `buildSystemPrompt()` to new file with no behavior change
2. Add `estimateTokens()` and `truncateMessages()`
3. Wrap in `assembleContext()` that calls all three
4. Update chat.ts to call `assembleContext()` instead of inlining

**Compatibility concerns:** None. Output is the same system prompt string plus messages array. Token estimation and truncation are new features that activate only when budget is exceeded.

**Tests required:**
- Unit test: verify `assembleContext()` produces identical system prompt to current `buildSystemPrompt()` for same inputs
- Unit test: verify `estimateTokens()` returns reasonable estimates (within 2x of actual for English text)
- Unit test: verify `truncateMessages()` removes oldest messages while keeping system prompt and latest user message
- Unit test: verify truncation triggers when total exceeds `maxTokens`

**Acceptance criteria:** Context assembly is in its own file. Token budget tracking is active. No change in output for inputs that fit within budget.

---

### 5.3 Extract ApprovalRuntime

**Purpose:** Unify the gate (in handleChat) and resume (executeApprovedAction) logic into a single module with an explicit contract.

**Files to create:**
| New file | Content | Est. lines |
|----------|---------|-----------|
| `src/agent/approval-runtime.ts` | `shouldRequireApproval()`, `buildApproval()`, `executeApproval()`, `validateApprovalFields()` | ~250 |

**Files to modify:**
| File | Change |
|------|--------|
| `src/agent/chat.ts` | Remove inline approval gate (lines 586-606) and `executeApprovedAction()` (lines 712-813). Replace with calls to approval-runtime functions. |
| `src/agent/tool-approval.ts` | `buildApprovalRequest()` moves here from tool-approval.ts, OR tool-approval.ts is merged into approval-runtime.ts |

**Interface:**
```typescript
function shouldRequireApproval(toolName: string): boolean;
  // Wraps isWriteTool() — single source of truth for approval classification

function buildApproval(toolName: string, args: Record<string, any>, context?: { runId?: string; sourceMessageId?: string }): ApprovalRequest;
  // Wraps buildApprovalRequest() with context attachment

function validateApprovalFields(approval: ApprovalRequest): { valid: boolean; error?: string };
  // Server-side validation (from Phase 1 fix 4.6)

function executeApproval(approval: ApprovalRequest, options?: HandleChatOptions): Promise<AssistantPayload>;
  // Moved from chat.ts executeApprovedAction()
```

**Migration approach:**
1. Create approval-runtime.ts with functions extracted from chat.ts and tool-approval.ts
2. Update chat.ts to import and call approval-runtime functions
3. Keep tool-approval.ts for the `buildApprovalRequest()` switch statement (approval payload construction per tool) — approval-runtime.ts wraps it

**Compatibility concerns:** `executeApprovedAction()` is called from server.ts endpoint. The server import must be updated.

**Tests required:**
- Unit test: `shouldRequireApproval('send_email')` returns true
- Unit test: `shouldRequireApproval('search_drive')` returns false
- Unit test: `validateApprovalFields()` with empty required field returns `{ valid: false, error: '...' }`
- Integration test: end-to-end approval flow unchanged after extraction

**Acceptance criteria:** Approval logic is in one module. chat.ts no longer contains approval gate or resume logic inline.

---

### 5.4 Evolve threadBrief toward structured contract

**Purpose:** Make threadBrief a typed object instead of a free-text string, enabling richer context for non-meeting conversations.

**Files to create:** None (type added to shared/chat.ts)

**Files to modify:**
| File | Change |
|------|--------|
| `src/shared/chat.ts` | Add `StructuredThreadBrief` type |
| `src/context/ChatContext.tsx` | Update `Conversation.threadBrief` type. Add parsing/serialization. |
| `src/agent/context-assembler.ts` | Parse structured brief in `buildSystemPrompt()` |

**Type:**
```typescript
interface StructuredThreadBrief {
  type: 'meeting_prep' | 'email_thread' | 'task' | 'general';
  entityId?: string;        // calendar event ID, email thread ID, task ID
  summary: string;          // human-readable context (what current threadBrief contains)
  context?: Record<string, string>;  // structured key-value pairs (attendees, time, etc.)
}

// Backward compatibility: threadBrief field is `string | StructuredThreadBrief`
// If string: treat as { type: 'general', summary: string }
```

**Migration approach:**
- `threadBrief` field in Conversation remains `string` in localStorage for backward compatibility
- When reading: if it parses as JSON with a `type` field, treat as `StructuredThreadBrief`. Otherwise, treat as `{ type: 'general', summary: threadBrief }`.
- When writing: serialize `StructuredThreadBrief` as JSON string
- Context assembler renders structured brief into a more informative system prompt section

**Compatibility concerns:** Existing conversations with string `threadBrief` continue to work. New conversations get structured briefs. No data migration needed.

**Tests required:**
- Unit test: parse legacy string threadBrief. Verify treated as `{ type: 'general', summary: '...' }`.
- Unit test: parse structured JSON threadBrief. Verify all fields populated.
- Unit test: context assembler renders structured brief correctly in system prompt.

**Acceptance criteria:** `threadBrief` can carry structured metadata. Existing conversations unaffected.

---

### 5.5 Batch memory writes

**Purpose:** Reduce file I/O during tool loops. Currently each `mergeMemory()` call writes to disk.

**Files to modify:**
| File | Change |
|------|--------|
| `src/agent/memory/memory-store.ts` | Add `beginBatch()` / `flushBatch()` functions. When batching, `mergeMemory()` writes to in-memory cache only. `flushBatch()` writes once to disk. |
| `src/agent/chat.ts` | Call `beginBatch()` before tool loop, `flushBatch()` after loop completes or on error. |

**Interface:**
```typescript
function beginBatch(): void;   // Sets batch mode flag
function flushBatch(): void;   // Writes accumulated changes to disk, clears batch flag
```

**Implementation:** Add a module-level `batchMode: boolean` flag. When `batchMode` is true, `writeFile()` becomes a no-op. `flushBatch()` calls `writeFile()` once and sets `batchMode = false`.

**Edge cases:**
- Chat request aborted mid-loop: `flushBatch()` must be called in a finally block in chat.ts to avoid losing accumulated memories.
- Nested batch calls: not supported. `beginBatch()` when already batching is a no-op with a warning log.

**Tests required:**
- Unit test: batch mode, merge 3 memories, verify 0 disk writes. Flush, verify 1 disk write.
- Unit test: batch mode, error thrown, finally flushes. Verify memories persisted.

**Acceptance criteria:** A chat turn with multiple tool executions produces at most 1 disk write for memory, not N.

---

## 6. Phase 3: Memory Retrieval Upgrade

### Why keyword retrieval is insufficient

The current retriever scores memories by keyword overlap between the user's query and memory tags/content. This fails when:
- The user paraphrases: "quarterly revenue" vs. tags ["Q1", "financial", "summary"]
- The user uses synonyms: "spreadsheet" vs. "Google Sheet"
- The user asks about a concept: "the doc we shared with marketing" vs. tags ["campaign-plan", "2026", "slides"]

The scoring formula is sound (multi-signal with tag, keyword, category, recency, access components), but the primary input signals (tag and keyword match) are too brittle. Embeddings provide semantic similarity that covers paraphrasing, synonyms, and conceptual proximity.

### Proposed embedding strategy

**Embedding model:** Use the active LLM provider's embedding endpoint if available (OpenAI `text-embedding-3-small`, Anthropic does not offer embeddings). Fallback: if the active provider does not support embeddings, use a local lightweight approach (TF-IDF over the memory corpus). This preserves provider flexibility and avoids lock-in.

**When embeddings are computed:**
1. **On extraction:** When a new memory entry is created or merged, compute its embedding from `content + tags.join(' ')`. Store in `MemoryEntry.embedding` field (already exists, currently unused).
2. **On first retrieval (lazy migration):** When retrieving memories, if an entry has no embedding, compute it on-the-fly and store it. This migrates existing entries without a batch job.

**Fallback behavior for entries without embeddings:**
- If embedding computation fails (no provider, API error, rate limit): use keyword scoring only (current behavior). Mark the entry with `embedding: null` and retry on next access.
- If fewer than 50% of candidate memories have embeddings: use keyword scoring as primary, embedding as bonus signal. This prevents degraded behavior during migration.

### Storage changes

No schema change. `MemoryEntry.embedding` field already exists as `number[]`. Currently unused. Will be populated with embedding vectors (dimension depends on provider: 1536 for OpenAI `text-embedding-3-small`).

File size impact: ~6KB per memory entry with 1536-dim embedding (JSON array of floats). For 500 entries: ~3MB per user. Acceptable for file-based storage.

### Scoring algorithm (updated)

```
IF embedding available for entry AND query embedding computed:
  embeddingScore = cosineSimilarity(queryEmbedding, entry.embedding) * 0.50

  // Secondary signals (reduced weight since embedding is primary)
  tagScore = tagMatches * 0.10
  keywordScore = (keywordMatches / queryKeywords.size) * 0.15
  categoryScore = (5 - CATEGORY_PRIORITY[category]) * 0.05
  recencyScore = max(0, 0.10 - daysSinceAccess * 0.003)
  accessScore = min(accessCount * 0.010, 0.10)

  finalScore = embeddingScore + tagScore + keywordScore + categoryScore + recencyScore + accessScore

ELSE (no embedding):
  // Current keyword-only scoring (unchanged)
  tagScore = tagMatches * 0.25
  keywordScore = (keywordMatches / queryKeywords.size) * 0.35
  categoryScore = (5 - CATEGORY_PRIORITY[category]) * 0.05
  recencyScore = max(0, 0.15 - daysSinceAccess * 0.005)
  accessScore = min(accessCount * 0.015, 0.10)

  finalScore = tagScore + keywordScore + categoryScore + recencyScore + accessScore

IF stale: finalScore *= 0.5
```

### Rollout plan

1. Add embedding computation function in `src/agent/memory/memory-embeddings.ts`
2. Integrate into `mergeMemory()` (compute on extraction)
3. Integrate into `retrieveMemories()` (compute query embedding, use in scoring)
4. Add lazy migration: compute missing embeddings during retrieval
5. Monitor: log when embedding-scored results differ from keyword-only results

### Files to create/modify

| File | Action |
|------|--------|
| `src/agent/memory/memory-embeddings.ts` | Create. Contains `computeEmbedding(text)`, `cosineSimilarity(a, b)`, embedding provider abstraction. |
| `src/agent/memory/memory-store.ts` | Modify. Call `computeEmbedding()` in `createMemory()` and `mergeMemory()`. |
| `src/agent/memory/memory-retriever.ts` | Modify. Compute query embedding. Update scoring formula. Add dual-path scoring (with/without embeddings). |
| `src/agent/memory/memory-types.ts` | No change. `embedding` field already exists. |

### Testing plan

- Unit test: `computeEmbedding("quarterly revenue report")` returns a vector of expected dimension
- Unit test: `cosineSimilarity([1,0], [0,1])` returns 0, `cosineSimilarity([1,0], [1,0])` returns 1
- Unit test: create memory "quarterly revenue report", query "Q1 financial summary", verify it ranks higher with embeddings than without
- Unit test: memory without embedding falls back to keyword scoring (verify no error)
- Unit test: embedding API failure does not crash retrieval (graceful fallback)
- Integration test: full chat turn with embedding-enhanced retrieval, verify memories are relevant

### Cost and latency considerations

- **Cost:** text-embedding-3-small costs $0.02/1M tokens. A memory entry is ~50 tokens. 500 entries = 25K tokens = $0.0005 for full corpus embedding. Negligible.
- **Latency:** Single embedding call: ~100ms. Per-retrieval query embedding: ~100ms added to chat turn. Acceptable.
- **Batch migration:** 500 entries at ~100ms each = ~50 seconds for full lazy migration. Spread across retrieval calls, this is transparent.

### Risk mitigation

- **Provider lock-in:** Embedding dimension varies by provider. If user switches providers, existing embeddings become incompatible. Mitigation: store `embeddingModel` alongside embedding in metadata. If model changes, invalidate (set to null) and recompute lazily.
- **File size growth:** Monitor `.memory/{userHash}.json` file size. If it exceeds 10MB, consider binary storage or external vector store. Not needed at current scale.
- **API failures:** All embedding calls are best-effort. Failure falls back to keyword scoring. No degradation of current behavior.

---

## 7. Harness Contracts to Formalize

### 7.1 ContextAssembler

| | |
|---|---|
| **Responsibility** | Build the complete context window before each LLM invocation |
| **Inputs** | persona, threadBrief, retrievedMemories, userTz, messages, toolDefinitions, maxTokens |
| **Outputs** | systemPrompt string, chatMessages array, tokenEstimate number, truncated boolean |
| **Invariants** | System prompt always first. Memory always included if available. Never exceeds maxTokens. Latest user message never truncated. |
| **Failure behavior** | Memory retrieval failure: proceed without memories. Token overflow: truncate oldest messages. |
| **Owner file** | `src/agent/context-assembler.ts` |

### 7.2 ToolRuntime

| | |
|---|---|
| **Responsibility** | Register, dispatch, and normalize tool execution |
| **Inputs** | toolName, args, signal |
| **Outputs** | result string (success or "Error:" prefixed) |
| **Invariants** | All results are strings. Errors never throw. Tool definitions immutable after init. |
| **Failure behavior** | Timeout: "Error: Tool execution timed out". CLI crash: "Error: {stderr}". Invalid args: "Error: Invalid arguments". |
| **Owner files** | `src/agent/tool-definitions.ts`, `src/agent/tool-dispatch.ts` |

### 7.3 ApprovalRuntime

| | |
|---|---|
| **Responsibility** | Gate write operations, build proposals, pause/resume, validate fields |
| **Inputs** | Gate: toolName + args. Resume: ApprovalRequest with edited fields. |
| **Outputs** | Gate: ApprovalRequest. Resume: AssistantPayload with result. |
| **Invariants** | Every write tool goes through approval. Fields validated before execution. Post-approval is exactly one tool call. Dynamic tool write steps also gated. |
| **Failure behavior** | Validation failure: error payload, no execution. Tool failure after approval: error in payload, no retry. |
| **Owner file** | `src/agent/approval-runtime.ts` |

### 7.4 MemoryRuntime

| | |
|---|---|
| **Responsibility** | Extract, store, retrieve, and manage per-user memory |
| **Inputs** | Extract: toolName + args + result. Retrieve: query + options. |
| **Outputs** | Extract: MemoryEntry[]. Retrieve: RetrievedMemory[] + promptText. |
| **Invariants** | Per-user isolation. Dedup by resourceIds. Max 500 entries. Atomic writes. Access tracking on retrieval. |
| **Failure behavior** | File read error: empty store. File write error: log, don't crash. No matches: empty array. |
| **Owner files** | `src/agent/memory/memory-store.ts`, `memory-extractor.ts`, `memory-retriever.ts`, `memory-embeddings.ts` |

### 7.5 SessionRuntime

| | |
|---|---|
| **Responsibility** | Manage conversation identity, continuity, and cross-session resume |
| **Inputs** | userEmail, eventId, threadBrief, conversationId |
| **Outputs** | Conversation objects, resume lookup, threadBrief passthrough |
| **Invariants** | Per-user scoped. eventId enables resume. threadBrief persists for conversation lifetime. Conversations survive refresh. |
| **Failure behavior** | localStorage full: new conversations work, old may fail silently. Corrupt data: fallback to empty. |
| **Owner file** | `src/context/ChatContext.tsx` (frontend), future: lightweight server index |

### 7.6 ProactiveArtifactRuntime

| | |
|---|---|
| **Responsibility** | Generate, store, surface, and hand off proactive artifacts to chat |
| **Inputs** | Calendar events, email/Drive context, LLM generation |
| **Outputs** | StagedDraft[], UI cards, chat handoff with memory indexing |
| **Invariants** | Dedup by meetingId. Auto-purge past meetings. Context indexed into memory. Discussions linked via eventId. |
| **Failure behavior** | LLM error: draft gets status 'error'. No meetings: empty queue. |
| **Owner files** | `src/agent/horizon-scanner.ts`, `src/agent/draft-store.ts` |

### 7.7 PersistenceStore

| | |
|---|---|
| **Responsibility** | Consistent read/write for all JSON file persistence |
| **Inputs** | Data objects, file paths |
| **Outputs** | JSON files on disk |
| **Invariants** | Atomic writes (temp + rename). Per-user scoping where needed. Schema versioning. |
| **Failure behavior** | Write error: log, return false. Read error: return default/empty. |
| **Owner** | Each subsystem implements its own I/O following this contract. No shared utility needed at current scale. |

### 7.8 StreamEvent

| | |
|---|---|
| **Responsibility** | Real-time communication from server to frontend |
| **Inputs** | Event objects from chat execution |
| **Outputs** | NDJSON lines |
| **Invariants** | One JSON per line. Stream always ends with complete/error/aborted. Tool events have stable IDs. |
| **Failure behavior** | Write error on stream: abort stream, client sees `assistant_aborted`. |
| **Owner file** | `src/shared/chat.ts` (types), server.ts (emission) |

---

## 8. Session Continuity Design Decision

### What should remain client-side

- **Full message history:** Messages are large and privacy-sensitive. Keeping them in localStorage avoids server storage costs, latency, and data governance concerns.
- **UI state:** Panel open/close, active view, input buffer, navigation signals.
- **Conversation groups:** Organizational metadata that only the UI uses.

### What should move or be indexed server-side

- **Lightweight conversation index:** The server should maintain a minimal index for cross-conversation reasoning:
  ```
  { id, title, eventId, threadBrief (summary only), lastMessageAt, messageCount }
  ```
  Stored in `DATA_DIR/conversations.{userHash}.json`.
  Updated when the frontend sends `conversationId` and `threadBrief` in chat requests.
  The server never stores message content.

- **Memory-conversation linkage:** When memories are extracted during a conversation, the memory's `source` should include `conversationId`. This enables "you discussed this in a previous conversation" reasoning.

### Whether a server-side conversation index should be added

**Yes, but not in Phase 1 or 2.** The index is a Phase 3+ addition. It requires:
- A new persistence file
- An update path (server writes index on every chat request)
- A query API (server reads index for proactive reasoning)

The benefit is clear (horizon scanner can check "already prepped?", memory can reference conversation context), but the implementation cost is moderate. Defer until after embedding retrieval is proven.

### How threadBrief should evolve

As specified in Phase 2 (section 5.4): evolve from free-text string to `StructuredThreadBrief` with type, entityId, summary, and structured context. Backward compatible via JSON detection.

### How proactive artifacts should attach to conversations

1. **Via eventId:** DraftQueue "Discuss" passes `eventId: draft.meetingId` to `sendMessage()` (Phase 1, section 4.3)
2. **Via threadBrief:** Draft metadata becomes a `StructuredThreadBrief` of type `meeting_prep` (Phase 2)
3. **Via memory:** Draft context (linked docs, related emails) is indexed into memory (Phase 1, section 4.4)

### How event-linked resume should work

1. User clicks "Prepare meeting" on CalendarPage or "Discuss" on DraftQueue
2. Frontend calls `findConversationByEventId(eventId)`
3. If found: resume that conversation (open in panel)
4. If not found: create new conversation with `eventId`, `threadBrief`, and prompt
5. Both CalendarPage and DraftQueue use the same `eventId` (Google Calendar event ID), so they share resume capability

---

## 9. Proactive Artifact Integration Plan

### How meeting prep drafts should be represented

Keep the `StagedDraft` type as-is for now. It is specific enough for meeting prep and does not need to be generalized until a second artifact type is needed. Premature generalization would add complexity without a concrete use case.

### How drafts should link to memory

**Phase 1 (section 4.4):** On draft generation, call `mergeMemory()` for each:
- `linkedDoc` → category `resource`, resourceIds `[doc.id]`
- `relatedEmail` → category `fact`, resourceIds `[email.threadId]`

This is additive. Draft context becomes searchable in any conversation.

### How drafts should link to session continuity

**Phase 1 (section 4.3):** Pass `eventId: draft.meetingId` when creating a draft discussion conversation.

**Phase 2:** Use `StructuredThreadBrief` with `type: 'meeting_prep'` and `entityId: draft.meetingId`.

### How drafts should enter chat as structured context

Currently: draft content is dumped as text in the first user message. This is functional but lossy.

**Improvement (Phase 2):** When "Discuss" is clicked:
1. Set `threadBrief` as `StructuredThreadBrief` with meeting metadata
2. The context assembler renders this as a structured system prompt section
3. Linked memories are already indexed (Phase 1) and will be retrieved by the memory system
4. The first user message can be shorter ("Prepare for this meeting") because context is in the system prompt and memory

### Whether to move toward a generalized ProactiveArtifact model

**Not yet.** The current codebase has exactly one proactive artifact type (meeting prep). Generalizing to a `ProactiveArtifact` model requires at least a second concrete use case (e.g., email digest, task deadline reminder, weekly report). When that use case arrives, extract the common pattern:
```typescript
interface ProactiveArtifact {
  id: string;
  type: string;              // 'meeting_prep' | 'email_digest' | ...
  entityId: string;          // Calendar event ID, email thread ID, etc.
  content: string;           // LLM-generated summary
  linkedMemoryIds: string[]; // Memory entries created from this artifact's context
  status: 'pending' | 'approved' | 'dismissed' | 'error';
  createdAt: string;
}
```

Until then, `StagedDraft` is the correct abstraction level.

---

## 10. Approval Safety Review

### Current write approval model

The current model: `isWriteTool()` checks a hardcoded set of 18 tool names (`WRITE_TOOL_NAMES`). If a tool call matches, `handleChat()` halts the tool loop, builds an `ApprovalRequest` with editable fields, and returns it to the frontend. The user reviews, optionally edits fields, and approves or dismisses. On approval, `executeApprovedAction()` reconstructs tool args and executes the single tool.

**This model is sound for static tools.** Every static write tool goes through the gate. The user sees what will be executed and can edit it.

### What should be validated server-side

1. **Required fields non-empty** (Phase 1, section 4.6): `to`, `subject`, `body` for send_email; `title` for create_task; etc.
2. **Field type consistency:** email addresses should contain `@`, dates should be parseable. Not implemented yet — defer to future work.
3. **toolArgs integrity for dynamic tools:** verify that `toolArgs` has not been tampered with (compare against original tool definition). Not implemented yet — low risk since dynamic tool approval is server-managed.

### Trust gaps identified

| Gap | Severity | Status |
|-----|----------|--------|
| Dynamic tool write steps bypass approval | **Critical** | Fix in Phase 1 (section 4.5) |
| Server does not validate required fields on approval | Medium | Fix in Phase 1 (section 4.6) |
| `threadBriefSuggestion` is never applied (minor: no security impact) | Low | Informational |

### Dynamic tool approval gap: verification and fix

**Verified:** `executeDynamicTool()` in `tool-composer.ts:157-238` calls `executeTool(step.action, resolvedArgs, signal)` at line 181 without checking `isWriteTool()`. A dynamic tool with `send_email` as a step will send the email without user approval.

**Fix:** See Phase 1 section 4.5. Add `isWriteTool()` check before each step execution. Return approval request if write step encountered. Resume remaining steps after approval.

### Acceptance tests for approval safety

| Test | Expected result |
|------|-----------------|
| Call static write tool (send_email) directly | Approval card shown, tool does not execute until approved |
| Call static read tool (search_drive) directly | Executes immediately, no approval |
| Create dynamic tool with send_email step, execute it | Approval card shown for the send_email step |
| Create dynamic tool with only read steps, execute it | All steps execute, no approval |
| Submit approval with empty `to` field for send_email | Server returns error, email not sent |
| Submit approval with all fields valid | Tool executes, result streamed |
| Dismiss approval | No tool execution, conversation continues |

---

## 11. File-by-File Implementation Plan

| File path | Action | Purpose | Phase | Complexity | Notes |
|-----------|--------|---------|-------|------------|-------|
| `src/agent/memory/memory-retriever.ts` | Modify | Add incrementAccess() calls after selecting memories | 1 | Low | ~5 lines |
| `src/agent/memory/memory-extractor.ts` | Modify | Add generic fallback extractor + extractResourceIds helper | 1 | Low | ~30 lines |
| App.tsx (handleDiscussDraft) | Modify | Pass eventId: draft.meetingId to sendMessage() | 1 | Low | 1 line |
| `src/agent/horizon-scanner.ts` | Modify | Call mergeMemory() for linked docs and related emails after draft generation | 1 | Medium | ~40 lines |
| `src/agent/tool-composer.ts` | Modify | Add isWriteTool() check in step loop, return approval if write step | 1 | Medium | ~25 lines, return type change |
| `src/agent/chat.ts` | Modify | Handle dynamic tool approval_required return. Add field validation in executeApprovedAction() | 1 | Medium | ~30 lines |
| `src/agent/tool-definitions.ts` | Create | TOOL_DEFINITIONS, WRITE_TOOL_NAMES, isWriteTool() extracted from tools.ts | 2 | Medium | ~600 lines (copy) |
| `src/agent/tool-dispatch.ts` | Create | executeTool(), executeGws() extracted from tools.ts | 2 | Medium | ~700 lines (copy) |
| `src/agent/tool-approval.ts` | Create | buildApprovalRequest() extracted from tools.ts | 2 | Medium | ~500 lines (copy) |
| `src/agent/tools.ts` | Delete | Replaced by three files above | 2 | Low | Import updates |
| `src/agent/context-assembler.ts` | Create | assembleContext(), buildSystemPrompt(), estimateTokens(), truncateMessages() | 2 | Medium | ~200 lines |
| `src/agent/approval-runtime.ts` | Create | shouldRequireApproval(), buildApproval(), executeApproval(), validateApprovalFields() | 2 | Medium | ~250 lines |
| `src/shared/chat.ts` | Modify | Add StructuredThreadBrief type | 2 | Low | ~15 lines |
| `src/context/ChatContext.tsx` | Modify | Parse/serialize StructuredThreadBrief, backward compat | 2 | Low | ~20 lines |
| `src/agent/memory/memory-store.ts` | Modify | Add beginBatch()/flushBatch() | 2 | Low | ~20 lines |
| `src/agent/memory/memory-embeddings.ts` | Create | computeEmbedding(), cosineSimilarity(), provider abstraction | 3 | High | ~150 lines |
| `src/agent/memory/memory-store.ts` | Modify | Call computeEmbedding() in createMemory()/mergeMemory() | 3 | Medium | ~15 lines |
| `src/agent/memory/memory-retriever.ts` | Modify | Compute query embedding, dual-path scoring | 3 | High | ~60 lines |

---

## 12. Implementation Slices

### Slice 1: Fix memory access tracking

| | |
|---|---|
| **Goal** | Make memory ranking reflect actual usage |
| **Files** | `src/agent/memory/memory-retriever.ts` |
| **User-visible effect** | Frequently useful memories rank higher over time. Unused memories decay. Not immediately visible — improves over multiple sessions. |
| **Tests** | Unit: retrieve memories, verify accessCount increments. Unit: verify scoring uses updated values. |
| **Rollback risk** | Near zero. Remove 5 lines to revert. |

### Slice 2: Widen memory extraction

| | |
|---|---|
| **Goal** | Every tool execution produces a memory entry |
| **Files** | `src/agent/memory/memory-extractor.ts` |
| **User-visible effect** | Agent recalls more tool interactions. "Remember when I searched for X" starts working for tools that previously had no memory. |
| **Tests** | Unit: unknown tool produces fact entry. Unit: known tools still use specific extractors. |
| **Rollback risk** | Near zero. Remove default case to revert. |

### Slice 3: Close dynamic tool approval gap

| | |
|---|---|
| **Goal** | No write operation executes without user approval |
| **Files** | `src/agent/tool-composer.ts`, `src/agent/chat.ts` |
| **User-visible effect** | Dynamic tools with write steps now show approval cards. Users who created such tools will notice the new approval step. |
| **Tests** | Unit: dynamic tool with write step returns approval. Integration: approval card appears. |
| **Rollback risk** | Low. Revert tool-composer.ts changes. Users would lose the safety check. |

### Slice 4: Link drafts to conversations + index context

| | |
|---|---|
| **Goal** | Proactive artifacts connect to session continuity and memory |
| **Files** | App.tsx (handleDiscussDraft), `src/agent/horizon-scanner.ts` |
| **User-visible effect** | "Resume prep" works from CalendarPage for draft discussions. Agent recalls docs/emails from meeting briefs in future conversations. |
| **Tests** | Unit: handleDiscussDraft passes eventId. Unit: horizon scanner creates memory entries. Integration: CalendarPage resume works. |
| **Rollback risk** | Low. Revert 2 files. |

### Slice 5: Server-side approval validation

| | |
|---|---|
| **Goal** | Server rejects malformed approvals before executing |
| **Files** | `src/agent/chat.ts` |
| **User-visible effect** | If frontend validation is bypassed, server catches it. Not normally visible (frontend already validates). Defense in depth. |
| **Tests** | Unit: empty required field returns error. Unit: valid fields execute normally. |
| **Rollback risk** | Near zero. Remove validation block. |

### Slice 6: Split tools.ts

| | |
|---|---|
| **Goal** | Break 2900-line monolith into 3 focused files |
| **Files** | Create: tool-definitions.ts, tool-dispatch.ts, tool-approval.ts. Delete: tools.ts. Modify: chat.ts, dynamic-tool-bridge.ts, tool-composer.ts (imports). |
| **User-visible effect** | None. Pure refactor. |
| **Tests** | All existing tests pass unchanged. |
| **Rollback risk** | Low. Git revert restores tools.ts. |

### Slice 7: Extract ContextAssembler

| | |
|---|---|
| **Goal** | Context assembly in dedicated module with token budgeting |
| **Files** | Create: context-assembler.ts. Modify: chat.ts. |
| **User-visible effect** | Long conversations no longer risk context overflow. Otherwise invisible. |
| **Tests** | Unit: same output for normal inputs. Unit: truncation triggers for oversized inputs. |
| **Rollback risk** | Low. Move function back to chat.ts. |

### Slice 8: Extract ApprovalRuntime + batch memory writes

| | |
|---|---|
| **Goal** | Approval logic in one module. Memory I/O efficient. |
| **Files** | Create: approval-runtime.ts. Modify: chat.ts, memory-store.ts. |
| **User-visible effect** | None visible. Internal cleanup. |
| **Tests** | Unit: approval functions work. Unit: batch mode reduces writes. Integration: full approval flow unchanged. |
| **Rollback risk** | Low. Revert to inline logic. |

### Slice 9: Structured threadBrief

| | |
|---|---|
| **Goal** | threadBrief carries typed metadata |
| **Files** | Modify: shared/chat.ts, ChatContext.tsx, context-assembler.ts. |
| **User-visible effect** | New meeting prep conversations have richer context. Existing conversations unaffected. |
| **Tests** | Unit: legacy string parsing. Unit: structured JSON parsing. Unit: context assembler renders correctly. |
| **Rollback risk** | Low. Backward compatible. |

### Slice 10: Embedding-based retrieval

| | |
|---|---|
| **Goal** | Semantic memory retrieval |
| **Files** | Create: memory-embeddings.ts. Modify: memory-store.ts, memory-retriever.ts. |
| **User-visible effect** | Agent recalls relevant memories even when user's words don't exactly match. Significantly better recall for paraphrased queries. |
| **Tests** | Unit: embedding computation. Unit: cosine similarity. Unit: semantic match outranks keyword-only. Integration: full chat with embedding retrieval. |
| **Rollback risk** | Medium. Revert retriever to keyword-only. Embeddings in storage are harmless (ignored if not used). |

---

## 13. Testing Strategy

### Unit tests

| Target | Test file | What to verify |
|--------|-----------|----------------|
| Memory access tracking | `__tests__/agent/memory/memory-retriever.test.ts` | incrementAccess called on selection, accessCount increments, lastAccessedAt updates |
| Generic memory extraction | `__tests__/agent/memory/memory-extractor.test.ts` | Unknown tool produces entry, known tools unchanged, resourceId extraction |
| Approval field validation | `__tests__/agent/approval-runtime.test.ts` | Empty required field rejected, valid fields pass, unknown tool passes |
| Dynamic tool approval gate | `__tests__/agent/tool-composer.test.ts` | Write step returns approval, read-only tool executes, mixed steps halt at first write |
| Context assembler | `__tests__/agent/context-assembler.test.ts` | Same output as inline, token estimation, truncation |
| Embedding computation | `__tests__/agent/memory/memory-embeddings.test.ts` | Vector dimension, cosine similarity math, graceful failure |
| Embedding retrieval | `__tests__/agent/memory/memory-retriever.test.ts` | Semantic match ranks higher, fallback to keyword |
| Batch memory writes | `__tests__/agent/memory/memory-store.test.ts` | Batch mode suppresses writes, flush writes once |
| Structured threadBrief | `__tests__/shared/chat.test.ts` | Legacy string parsing, JSON parsing, serialization |

### Integration tests

| Test | What to verify |
|------|----------------|
| Full chat turn with memory | Memories retrieved, used in prompt, access tracked, new memories extracted |
| Approval flow end-to-end | Write tool halts, approval card data correct, resume executes, result streamed |
| Dynamic tool with write step | Halts at write step, approval card shown, resume continues remaining steps |
| Draft discuss → resume | DraftQueue discuss creates linked conversation, CalendarPage resume finds it |
| Draft context in memory | Horizon scan indexes docs/emails, new conversation retrieves them |

### Regression tests

| Test | What to verify |
|------|----------------|
| Existing tool execution | All static tools execute correctly after tools.ts split |
| Existing approval flow | Static write tools still show approval cards |
| Existing memory extraction | 12 specific extractors still produce correct entries |
| Existing keyword retrieval | Keyword scoring unchanged for entries without embeddings |
| localStorage migration | Existing conversations load correctly with new threadBrief parsing |

### Approval safety tests

| Test | What to verify |
|------|----------------|
| Static write tool gate | send_email shows approval card |
| Dynamic write step gate | Dynamic tool with send_email step shows approval card |
| Field validation (server) | Empty required field returns error |
| Dismiss behavior | Dismissed approval does not execute tool |
| No bypass path | Cannot execute a write tool without going through shouldRequireApproval() |

### Memory retrieval quality tests

| Test | What to verify |
|------|----------------|
| Exact match | "quarterly revenue report" finds memory tagged ["quarterly", "revenue", "report"] |
| Semantic match (with embeddings) | "Q1 financial summary" finds memory about "quarterly revenue report" |
| Paraphrase match | "the spreadsheet we made for job tracking" finds "Job Applications Google Sheet" |
| Access-weighted ranking | Frequently accessed memory ranks above rarely accessed one with similar keyword match |
| Stale penalty | Stale memory ranks below fresh memory with same relevance |

---

## 14. Open Questions and Required Verification

### Must verify before implementation

| Item | Status | Action |
|------|--------|--------|
| Dynamic tools bypass write approval | **Verified: YES, they do.** tool-composer.ts:181 calls executeTool without isWriteTool check. | Fix in Slice 3. |
| `threadBriefSuggestion` is never applied by frontend | **Verified: YES, it is ignored.** ChatContext.tsx assistant_complete handler does not read it. | Informational. Not blocking. Could be wired up in Phase 2 as part of structured threadBrief work. |
| `incrementAccess()` is truly dead code | **Verified: YES.** Function exists at memory-store.ts:243-250 but is never imported or called anywhere. | Fix in Slice 1. |
| handleDiscussDraft does NOT pass eventId | **Verified: YES.** App.tsx lines 496-500 pass threadBrief and displayContent but not eventId. | Fix in Slice 4. |

### Requires verification during implementation

| Item | What to check | When |
|------|---------------|------|
| Horizon scanner has access to user email | Memory indexing requires `initMemoryStore(userEmail)`. Verify scanner context includes user email. | Before implementing Slice 4 memory indexing. |
| `executeDynamicTool()` return type change is safe | Changing return from `string` to union type. Verify all callers handle new shape. | During Slice 3 implementation. |
| Embedding provider availability | Check if active LLM provider supports embedding endpoint. Define fallback for Anthropic (no embeddings API). | Before implementing Slice 10. |
| Memory file size with embeddings | Estimate file size for 500 entries with 1536-dim embeddings (~3MB). Verify JSON parse/stringify performance. | During Slice 10 implementation. |
| `buildApprovalRequest()` handles all 18 write tools | Verify switch statement covers all WRITE_TOOL_NAMES entries, not just a subset. | During Slice 6 (tools.ts split). |

### Deferred decisions

| Item | Decision needed | When |
|------|-----------------|------|
| Server-side conversation index | Whether to add, schema, update mechanism | After Phase 3 proves embedding value |
| Generalized ProactiveArtifact model | Whether to generalize StagedDraft | When a second artifact type is needed |
| Conversation summarization | Whether to summarize old messages server-side | After conversation index is added |
| TF-IDF fallback for embeddings | Whether to implement local TF-IDF when no embedding provider available | During Slice 10 if Anthropic users are common |

---

## 15. Final Recommendation

### Start with: Slice 1 (fix memory access tracking)

This is the smallest, highest-leverage fix. Five lines of code. Immediate impact on memory ranking quality. Near-zero rollback risk. Can be verified with a unit test in minutes.

### Then: Slice 3 (close dynamic tool approval gap)

This is the most important safety fix. Dynamic tools can currently execute write operations without approval. This must be fixed before any new dynamic tools are created or promoted to users. Medium complexity (~25 lines + return type change) but critical for trust.

### Then: Slice 2 + Slice 4 (widen extraction + link drafts)

These two can be done in parallel. Slice 2 ensures every tool produces memory. Slice 4 connects proactive artifacts to both memory and session continuity. Together they significantly increase the breadth of what the agent can recall.

### Why this sequence

1. **Slice 1** fixes the scoring system that everything else depends on. Without access tracking, even perfect memories rank incorrectly.
2. **Slice 3** closes a real safety gap. Approval is a trust contract with the user. It must be airtight before adding new features.
3. **Slices 2+4** increase memory coverage. More memories + correct ranking = better retrieval = better responses.

This sequence maximizes improvement in agent response quality with minimal disruption. Each slice is independently deployable and testable. No slice depends on a later slice. The structural cleanup (Phase 2) and embedding upgrade (Phase 3) build on this foundation.
