# Tasks: FlowSpace Harness Improvement

**Input**: Design documents from `docs/designs/harness-improvement-spec.md`
**Prerequisites**: harness-improvement-spec.md (implementation spec), agent-harness-analysis.md (exploration)

**Organization**: Tasks are grouped by user story (mapped to spec phases) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Story Mapping

| Story | Spec Phase | Title | Priority |
|-------|-----------|-------|----------|
| US1 | Phase 1 (4.1-4.2) | Memory quality fixes (access tracking + extraction coverage) | P1 |
| US2 | Phase 1 (4.5-4.6) | Approval safety (dynamic tool gap + server validation) | P1 |
| US3 | Phase 1 (4.3-4.4) | Proactive artifact integration (draft linking + memory indexing) | P1 |
| US4 | Phase 2 (5.1) | Split tools.ts monolith | P2 |
| US5 | Phase 2 (5.2-5.3) | Extract ContextAssembler + ApprovalRuntime | P2 |
| US6 | Phase 2 (5.4-5.5) | Structured threadBrief + batch memory writes | P2 |
| US7 | Phase 3 (6) | Embedding-based memory retrieval | P3 |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify current state and establish test infrastructure for harness changes

- [ ] T001 Verify `incrementAccess()` is dead code by grepping all imports in `src/agent/` — confirm it is defined in `src/agent/memory/memory-store.ts` but never called
- [ ] T002 [P] Verify dynamic tool approval gap by reading `src/agent/tool-composer.ts` step loop (lines 167-215) — confirm no `isWriteTool()` check exists before `executeTool()` at line 181
- [ ] T003 [P] Verify `handleDiscussDraft()` does not pass `eventId` by reading `src/App.tsx` (lines 481-500) — confirm `sendMessage()` call lacks `eventId` option
- [ ] T004 [P] Create test scaffold for memory unit tests at `src/agent/memory/__tests__/memory-retriever.test.ts` if not already present
- [ ] T005 [P] Create test scaffold for tool-composer tests at `src/agent/__tests__/tool-composer.test.ts` if not already present

**Checkpoint**: All verification items confirmed. Test scaffolds ready. Implementation can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No foundational blockers for this feature — all user stories modify existing files with existing patterns. Phase 1 setup is the only prerequisite.

**Note**: US1, US2, and US3 can proceed in parallel immediately after Phase 1 setup.

---

## Phase 3: User Story 1 — Memory Quality Fixes (Priority: P1)

**Goal**: Make memory ranking reflect actual usage patterns and ensure all tool executions produce memory entries.

**Independent Test**: Create 3 memories, retrieve with a matching query, verify selected memories have incremented `accessCount` and updated `lastAccessedAt`. Execute an unlisted tool (e.g., `open_email_triage`), verify a `fact` memory entry is created.

### Tests for US1

- [ ] T006 [P] [US1] Write unit test: retrieve memories and verify `incrementAccess()` is called for each selected memory in `src/agent/memory/__tests__/memory-retriever.test.ts`
- [ ] T007 [P] [US1] Write unit test: retrieve same memories twice, verify `accessCount` is 2 and `lastAccessedAt` is updated in `src/agent/memory/__tests__/memory-retriever.test.ts`
- [ ] T008 [P] [US1] Write unit test: call `extractFromToolResult` with unknown tool name, verify a `fact` category entry is returned in `src/agent/memory/__tests__/memory-extractor.test.ts`
- [ ] T009 [P] [US1] Write unit test: call `extractFromToolResult` with known tool (e.g., `search_drive`), verify specific extractor runs (not generic fallback) in `src/agent/memory/__tests__/memory-extractor.test.ts`
- [ ] T010 [P] [US1] Write unit test: verify `extractResourceIds()` helper pulls `fileId`, `spreadsheetId`, `docId`, `threadId`, `eventId` from args object in `src/agent/memory/__tests__/memory-extractor.test.ts`

### Implementation for US1

- [ ] T011 [US1] Activate memory access tracking: import `incrementAccess` from `memory-store` and call it for each selected memory after scoring and filtering in `src/agent/memory/memory-retriever.ts` — add call inside `retrieveMemories()` after the top-N selection (~5 lines)
- [ ] T012 [US1] Add `extractResourceIds(args)` helper in `src/agent/memory/memory-extractor.ts` — scan args for keys ending in `Id`/`_id` or named `id`, `fileId`, `spreadsheetId`, `docId`, `threadId`, `eventId`; return `string[]`
- [ ] T013 [US1] Add `summarizeArgs(args, maxLen)` helper in `src/agent/memory/memory-extractor.ts` — JSON.stringify args, truncate to `maxLen` chars, append `...` if truncated
- [ ] T014 [US1] Add generic fallback `default` case in `extractFromToolResult()` switch in `src/agent/memory/memory-extractor.ts` — return `[{ category: 'fact', content: "Used ${toolName}: ${summarizeArgs(args, 120)}", tags: [toolName, ...extractTagsFromText(JSON.stringify(args))], metadata: { toolName, timestamp }, resourceIds: extractResourceIds(args), source: { type: 'auto_extraction', toolName } }]`
- [ ] T015 [US1] Run tests for US1: `npx vitest run src/agent/memory/__tests__/memory-retriever.test.ts src/agent/memory/__tests__/memory-extractor.test.ts` — all must pass

**Checkpoint**: Memory access tracking is live. All tool executions produce memory entries. Ranking improves with usage over time.

---

## Phase 4: User Story 2 — Approval Safety (Priority: P1)

**Goal**: Close the dynamic tool write-approval gap and add server-side field validation. No write operation can execute without user approval.

**Independent Test**: Create a dynamic tool with `search_drive` + `send_email` steps. Execute it. Verify the first step runs immediately but the second step halts with an approval request. Submit approval with empty `to` field — verify server returns error.

### Tests for US2

- [ ] T016 [P] [US2] Write unit test: `executeDynamicTool` with a write step (`send_email`) returns `{ type: 'approval_required', approval }` instead of executing in `src/agent/__tests__/tool-composer.test.ts`
- [ ] T017 [P] [US2] Write unit test: `executeDynamicTool` with only read steps returns `{ type: 'completed', result }` — all steps execute without approval in `src/agent/__tests__/tool-composer.test.ts`
- [ ] T018 [P] [US2] Write unit test: `executeDynamicTool` with mixed read+write steps — read steps execute, halts at first write step, returns completed read results plus approval in `src/agent/__tests__/tool-composer.test.ts`
- [ ] T019 [P] [US2] Write unit test: `validateApprovalFields()` rejects `send_email` approval with empty `to` field, returns `{ valid: false, error: "..." }` in `src/agent/__tests__/chat.test.ts`
- [ ] T020 [P] [US2] Write unit test: `validateApprovalFields()` accepts `send_email` approval with all required fields populated in `src/agent/__tests__/chat.test.ts`
- [ ] T021 [P] [US2] Write unit test: `validateApprovalFields()` accepts approval for a tool not in the required fields map (no validation applied) in `src/agent/__tests__/chat.test.ts`

### Implementation for US2

- [ ] T022 [US2] Change `executeDynamicTool()` return type from `string` to `{ type: 'completed', result: string } | { type: 'approval_required', approval: ApprovalRequest, completedSteps: StepResult[] }` in `src/agent/tool-composer.ts`
- [ ] T023 [US2] Add `isWriteTool()` check before `executeTool(step.action, ...)` in the step loop of `executeDynamicTool()` in `src/agent/tool-composer.ts` — if write tool, build `ApprovalRequest` via `buildApprovalRequest()`, attach `_dynamicToolName`, `_stepIndex`, `_remainingSteps` to `toolArgs`, and return `{ type: 'approval_required', ... }`
- [ ] T024 [US2] Update all callers of `executeDynamicTool()` in `src/agent/chat.ts` to handle the new union return type — when `type === 'approval_required'`, emit approval event and return (same as static write tool gate)
- [ ] T025 [US2] Update `executeApprovedAction()` in `src/agent/chat.ts` to detect `_dynamicToolName` and `_stepIndex` in `toolArgs` — after executing the approved step, continue executing remaining steps from `_remainingSteps`, halting again if another write step is encountered
- [ ] T026 [US2] Add `validateApprovalFields(toolName, args)` function in `src/agent/chat.ts` — define required fields per tool: `send_email` → `['to', 'subject', 'body']`, `create_calendar_event` → `['title', 'start_time']`, `create_task` → `['title']`, `docs_write` → `['doc_id', 'content']`, `sheets_create` → `['title']`; validate by trimming and checking non-empty
- [ ] T027 [US2] Call `validateApprovalFields()` at the top of `executeApprovedAction()` in `src/agent/chat.ts` — if invalid, return error payload `{ content: "Cannot execute: missing required field '{fieldName}'", blocks: [status block], toolEvents: [error event] }` without executing tool
- [ ] T028 [US2] Run tests for US2: `npx vitest run src/agent/__tests__/tool-composer.test.ts src/agent/__tests__/chat.test.ts` — all must pass

**Checkpoint**: No write tool can execute without user approval (static or dynamic). Server validates required fields before execution. Approval safety is airtight.

---

## Phase 5: User Story 3 — Proactive Artifact Integration (Priority: P1)

**Goal**: Link draft discussions to conversations via `eventId` and index draft context (linked docs, related emails) into the memory system.

**Independent Test**: Click "Discuss" on a DraftQueue meeting prep card, then navigate to CalendarPage — "Resume prep" button appears for that event. Generate a draft with linked docs, start a new conversation asking about one of those docs — verify the agent recalls it from memory.

### Tests for US3

- [ ] T029 [P] [US3] Write unit test: `handleDiscussDraft` passes `eventId: draft.meetingId` to `sendMessage()` options in `src/__tests__/App.test.tsx`
- [ ] T030 [P] [US3] Write unit test: after horizon scanner generates a draft with 2 linked docs and 1 related email, verify 3 `mergeMemory()` calls are made in `src/agent/__tests__/horizon-scanner.test.ts`
- [ ] T031 [P] [US3] Write unit test: when the same doc is linked in two drafts, verify only 1 memory entry exists (merged via `resourceIds`) in `src/agent/__tests__/horizon-scanner.test.ts`

### Implementation for US3

- [ ] T032 [US3] Add `eventId: draft.meetingId` to the `sendMessage()` options in `handleDiscussDraft()` in `src/App.tsx` — this is a 1-line addition alongside existing `threadBrief` and `displayContent` options
- [ ] T033 [US3] Import `initMemoryStore`, `mergeMemory`, and `extractTagsFromText` from memory modules into `src/agent/horizon-scanner.ts`
- [ ] T034 [US3] After draft generation in `src/agent/horizon-scanner.ts`, iterate over `draft.linkedDocs` and call `mergeMemory()` for each — use category `'resource'`, include `meetingId` and `meetingTitle` in metadata, set `resourceIds: [doc.id]`
- [ ] T035 [US3] After draft generation in `src/agent/horizon-scanner.ts`, iterate over `draft.relatedEmails` and call `mergeMemory()` for each — use category `'fact'`, include `meetingId` in metadata, set `resourceIds: [email.threadId]`
- [ ] T036 [US3] Add guard: skip memory indexing if `userEmail` is not available to `initMemoryStore()` in `src/agent/horizon-scanner.ts` — log warning and continue draft generation without memory indexing
- [ ] T037 [US3] Run tests for US3: `npx vitest run src/__tests__/App.test.tsx src/agent/__tests__/horizon-scanner.test.ts` — all must pass

**Checkpoint**: Draft discussions link to calendar events. Draft context (docs, emails) is searchable in any conversation via memory.

---

## Phase 6: User Story 4 — Split tools.ts Monolith (Priority: P2)

**Goal**: Break the ~2900-line `src/agent/tools.ts` into three focused modules, each under 800 lines.

**Independent Test**: Run `npm run lint` (tsc --noEmit) and `npm test` — all pass with zero behavior change. No file in `src/agent/` exceeds 800 lines.

### Implementation for US4

- [ ] T038 [US4] Create `src/agent/tool-definitions.ts` — extract `TOOL_DEFINITIONS` array, `WRITE_TOOL_NAMES` set, and `isWriteTool()` function from `src/agent/tools.ts` (~600 lines)
- [ ] T039 [US4] Create `src/agent/tool-dispatch.ts` — extract `executeTool()`, `executeGws()`, and all helper/utility functions from `src/agent/tools.ts` (~700 lines)
- [ ] T040 [US4] Create `src/agent/tool-approval.ts` — extract `buildApprovalRequest()` and all approval message generator functions from `src/agent/tools.ts` (~500 lines)
- [ ] T041 [US4] Update imports in `src/agent/chat.ts`: `isWriteTool` from `./tool-definitions`, `executeTool` from `./tool-dispatch`, `buildApprovalRequest` from `./tool-approval`
- [ ] T042 [US4] Update imports in `src/agent/dynamic-tool-bridge.ts`: `TOOL_DEFINITIONS` from `./tool-definitions`
- [ ] T043 [US4] Update imports in `src/agent/tool-composer.ts`: `executeTool` from `./tool-dispatch`, `isWriteTool` from `./tool-definitions`
- [ ] T044 [US4] Grep for all remaining `from './tools'` and `from '../tools'` imports across the codebase — update any missed references
- [ ] T045 [US4] Delete `src/agent/tools.ts`
- [ ] T046 [US4] Run `npm run lint` and `npm test` — verify zero regressions, all tests pass

**Checkpoint**: tools.ts is gone. Three focused modules exist. All imports resolved. No behavior change.

---

## Phase 7: User Story 5 — Extract ContextAssembler + ApprovalRuntime (Priority: P2)

**Goal**: Move context assembly and approval logic into dedicated modules with explicit contracts.

**Independent Test**: Send a chat message with tool use — verify identical behavior to pre-refactor. Run approval flow end-to-end — verify unchanged. Run `npm run lint` — passes.

### Tests for US5

- [ ] T047 [P] [US5] Write unit test: `assembleContext()` produces identical system prompt to current `buildSystemPrompt()` for same inputs in `src/agent/__tests__/context-assembler.test.ts`
- [ ] T048 [P] [US5] Write unit test: `estimateTokens()` returns reasonable estimates (within 2x of actual for English text) in `src/agent/__tests__/context-assembler.test.ts`
- [ ] T049 [P] [US5] Write unit test: `truncateMessages()` removes oldest messages while preserving system prompt and latest user message in `src/agent/__tests__/context-assembler.test.ts`
- [ ] T050 [P] [US5] Write unit test: `shouldRequireApproval('send_email')` returns true, `shouldRequireApproval('search_drive')` returns false in `src/agent/__tests__/approval-runtime.test.ts`

### Implementation for US5

- [ ] T051 [US5] Create `src/agent/context-assembler.ts` — extract `buildSystemPrompt()` from `src/agent/chat.ts` (lines 71-153), add `assembleContext()` wrapper, `estimateTokens()` (length/4 heuristic), and `truncateMessages()` (drop oldest non-system messages when over budget) (~200 lines)
- [ ] T052 [US5] Update `src/agent/chat.ts`: remove `buildSystemPrompt()`, import `assembleContext` from `./context-assembler`, call it at the top of `handleChat()`
- [ ] T053 [US5] Create `src/agent/approval-runtime.ts` — define `shouldRequireApproval()`, `buildApproval()`, `validateApprovalFields()` (moved from Phase 4 inline location), and `executeApproval()` (moved from `executeApprovedAction()` in chat.ts) (~250 lines)
- [ ] T054 [US5] Update `src/agent/chat.ts`: remove inline approval gate (lines 586-606) and `executeApprovedAction()` (lines 712-813), replace with calls to `approval-runtime` functions
- [ ] T055 [US5] Update `server.ts`: change import of `executeApprovedAction` to `executeApproval` from `src/agent/approval-runtime`
- [ ] T056 [US5] Run `npm run lint` and `npm test` — verify zero regressions

**Checkpoint**: Context assembly and approval are in dedicated modules. chat.ts is simpler. All behavior unchanged.

---

## Phase 8: User Story 6 — Structured threadBrief + Batch Memory Writes (Priority: P2)

**Goal**: Evolve threadBrief from free-text string to typed object. Reduce memory file I/O to at most 1 write per chat turn.

**Independent Test**: Start a meeting prep conversation — verify structured threadBrief is persisted and rendered correctly in system prompt. Open an existing conversation with legacy string threadBrief — verify it still works. Execute a multi-tool chat turn — verify 1 disk write for memory instead of N.

### Tests for US6

- [ ] T057 [P] [US6] Write unit test: parse legacy string threadBrief → treated as `{ type: 'general', summary: '...' }` in `src/__tests__/shared/chat.test.ts`
- [ ] T058 [P] [US6] Write unit test: parse structured JSON threadBrief → all fields populated correctly in `src/__tests__/shared/chat.test.ts`
- [ ] T059 [P] [US6] Write unit test: batch mode — merge 3 memories, verify 0 disk writes; flush, verify 1 disk write in `src/agent/memory/__tests__/memory-store.test.ts`
- [ ] T060 [P] [US6] Write unit test: batch mode with error — verify finally flush persists accumulated memories in `src/agent/memory/__tests__/memory-store.test.ts`

### Implementation for US6

- [ ] T061 [US6] Add `StructuredThreadBrief` interface to `src/shared/chat.ts` — `{ type: 'meeting_prep' | 'email_thread' | 'task' | 'general', entityId?: string, summary: string, context?: Record<string, string> }`
- [ ] T062 [US6] Add `parseThreadBrief(raw: string | undefined)` helper to `src/shared/chat.ts` — if JSON with `type` field, parse as `StructuredThreadBrief`; otherwise return `{ type: 'general', summary: raw }`
- [ ] T063 [US6] Update `src/context/ChatContext.tsx` to use `parseThreadBrief()` when reading `Conversation.threadBrief` from localStorage, and `JSON.stringify()` when writing structured briefs
- [ ] T064 [US6] Update `src/agent/context-assembler.ts` to parse structured threadBrief and render richer system prompt section (type-specific formatting: meeting prep shows attendees/time, email thread shows participants, etc.)
- [ ] T065 [US6] Add `beginBatch()` and `flushBatch()` functions to `src/agent/memory/memory-store.ts` — module-level `batchMode` flag; when true, `writeFile()` is a no-op; `flushBatch()` calls `writeFile()` once and clears flag (~20 lines)
- [ ] T066 [US6] Update `src/agent/chat.ts`: call `beginBatch()` before tool loop, `flushBatch()` in a `finally` block after loop completes
- [ ] T067 [US6] Run `npm run lint` and `npm test` — verify zero regressions

**Checkpoint**: threadBrief carries structured metadata. Existing conversations unaffected. Memory I/O reduced to 1 write per turn.

---

## Phase 9: User Story 7 — Embedding-Based Memory Retrieval (Priority: P3)

**Goal**: Add semantic similarity scoring to memory retrieval using embeddings. The agent can recall memories even when the user's words don't exactly match stored tags. Embeddings are stored in a separate file per user to keep the main memory file fast. Only providers that support embeddings (OpenAI, OpenRouter) compute them; others fall back to keyword-only retrieval.

**Design decisions** (from `docs/designs/phase3-design-spike.md`):
- **Provider strategy**: Tiered — use active provider's embedding API when available, keyword fallback otherwise
- **Storage**: Separate `.memory/{userHash}.embeddings.json` file (not inline on MemoryEntry)
- **Context budget**: Wire `truncateMessages()` into chat.ts with 100K token safe default
- **threadBriefSuggestion**: Deferred — not wired up in Phase 3

**Independent Test**: Store a memory about "quarterly revenue report". Query "Q1 financial summary". Verify it ranks in top 5 with embeddings (OpenAI provider) but not with keyword-only scoring. Switch to Anthropic provider. Verify same query uses keyword fallback with no error.

### Tests for US7

- [ ] T068 [P] [US7] Write unit test: `cosineSimilarity([1,0], [0,1])` returns 0, `cosineSimilarity([1,0], [1,0])` returns 1 in `src/agent/memory/__tests__/memory-embeddings.test.ts`
- [ ] T069 [P] [US7] Write unit test: `computeEmbedding("test text")` returns vector of expected dimension when provider supports embeddings (mock OpenAI provider) in `src/agent/memory/__tests__/memory-embeddings.test.ts`
- [ ] T070 [P] [US7] Write unit test: `computeEmbedding()` returns null gracefully when provider does not support embeddings (mock Anthropic provider) in `src/agent/memory/__tests__/memory-embeddings.test.ts`
- [ ] T071 [P] [US7] Write unit test: `computeEmbedding()` returns null on API error (network failure, rate limit) without throwing in `src/agent/memory/__tests__/memory-embeddings.test.ts`
- [ ] T072 [P] [US7] Write unit test: `loadEmbeddings()` returns empty object when file does not exist, returns parsed entries when file exists in `src/agent/memory/__tests__/memory-embeddings.test.ts`
- [ ] T073 [P] [US7] Write unit test: `saveEmbedding()` writes to separate `.embeddings.json` file, not the main memory file in `src/agent/memory/__tests__/memory-embeddings.test.ts`
- [ ] T074 [P] [US7] Write unit test: `invalidateEmbeddings()` clears all embeddings when model changes in `src/agent/memory/__tests__/memory-embeddings.test.ts`
- [ ] T075 [P] [US7] Write unit test: memory with embedding in separate file scores higher for semantic match than memory without embedding in `src/agent/memory/__tests__/memory-retriever.test.ts`
- [ ] T076 [P] [US7] Write unit test: memory without embedding falls back to keyword-only scoring (no error, same behavior as before) in `src/agent/memory/__tests__/memory-retriever.test.ts`
- [ ] T077 [P] [US7] Write unit test: lazy migration — retrieve memory without embedding, verify embedding is computed via provider, saved to embedding file, and used for scoring in `src/agent/memory/__tests__/memory-retriever.test.ts`
- [ ] T078 [P] [US7] Write unit test: `truncateMessages()` is called before `client.complete()` with 100K token budget in `src/agent/__tests__/chat.test.ts`

### Implementation for US7

**Step 1: Embedding computation and storage module**

- [ ] T079 [US7] Create `src/agent/memory/memory-embeddings.ts` with the following exports:
  - `cosineSimilarity(a: number[], b: number[]): number` — pure math, dot product / (magnitude * magnitude)
  - `supportsEmbeddings(): boolean` — check active LLM provider config; return true for `openai` and `openrouter` providers, false for `anthropic`, `claude-code`, `codex`, `lmstudio`
  - `computeEmbedding(text: string): Promise<number[] | null>` — if `supportsEmbeddings()` is false, return null immediately; otherwise call provider's embedding endpoint (OpenAI `text-embedding-3-small` via fetch to `${baseURL}/embeddings`); handle errors gracefully returning null
  - `getEmbeddingModel(): string | null` — return the model string (e.g., `text-embedding-3-small`) for the active provider, or null if unsupported

- [ ] T080 [US7] Add embedding file I/O to `src/agent/memory/memory-embeddings.ts`:
  - File format: `{ version: 1, model: string, entries: Record<string, number[]> }` stored at `.memory/{userHash}.embeddings.json`
  - `initEmbeddingStore(userHash: string): void` — set the file path based on userHash (same pattern as memory-store.ts setMemoryFileIO)
  - `loadEmbeddings(): Record<string, number[]>` — read and parse embedding file; return empty `{}` if file does not exist or model differs from current `getEmbeddingModel()`
  - `saveEmbedding(memoryId: string, embedding: number[]): void` — update in-memory cache, mark as dirty
  - `flushEmbeddings(): void` — atomic write (temp+rename) of embedding file if dirty; write compact JSON (no pretty-print) to minimize file size
  - `invalidateEmbeddings(): void` — delete the embedding file (provider/model changed)

- [ ] T081 [US7] Add embedding batch support to `src/agent/memory/memory-embeddings.ts`:
  - `beginEmbeddingBatch(): void` — suppress writes
  - `flushEmbeddingBatch(): void` — single atomic write of accumulated changes
  - Called from chat.ts alongside existing memory batch calls

**Step 2: Integrate into retrieval**

- [ ] T082 [US7] Update `retrieveMemories()` in `src/agent/memory/memory-retriever.ts`:
  - Accept new optional parameter: `embeddings?: Record<string, number[]>`
  - At the start: if `supportsEmbeddings()` is true, compute query embedding once via `computeEmbedding(query)`
  - In `calculateRelevanceScore()`: if both query embedding and entry embedding exist, use dual-path scoring:
    - `embeddingScore = cosineSimilarity(queryEmbedding, entryEmbedding) * 0.50`
    - `tagScore = tagMatches * 0.10`
    - `keywordScore = (keywordMatches / queryKeywords.size) * 0.15`
    - `categoryScore = (5 - CATEGORY_PRIORITY[category]) * 0.05`
    - `recencyScore = max(0, 0.10 - daysSinceAccess * 0.003)`
    - `accessScore = min(accessCount * 0.010, 0.10)`
  - If no embedding for entry: use existing keyword-only scoring unchanged
  - If query embedding computation failed: use keyword-only scoring for all entries

- [ ] T083 [US7] Add lazy migration in `retrieveMemories()` in `src/agent/memory/memory-retriever.ts`:
  - After scoring, for each selected memory that lacks an embedding but `supportsEmbeddings()` is true: compute embedding on-the-fly via `computeEmbedding(entry.content + ' ' + entry.tags.join(' '))`, call `saveEmbedding(entry.id, embedding)` to persist
  - This gradually populates the embedding file without a batch migration job
  - Limit lazy computation to max 5 entries per retrieval to cap latency

**Step 3: Wire into chat harness**

- [ ] T084 [US7] Update `handleChat()` in `src/agent/chat.ts`:
  - After `initMemoryStore()`: call `initEmbeddingStore(userHash)` to set up embedding file path
  - Before `retrieveMemories()`: call `loadEmbeddings()` to get the embedding cache
  - Pass `embeddings` to `retrieveMemories(query, memories, { maxResults: 5 }, embeddings)`
  - After memory extraction in the tool loop: if `supportsEmbeddings()`, compute embedding for each new memory and call `saveEmbedding()`
  - Wrap embedding writes in `beginEmbeddingBatch()`/`flushEmbeddingBatch()` alongside existing memory batch

- [ ] T085 [US7] Wire `truncateMessages()` into `handleChat()` in `src/agent/chat.ts`:
  - Define `const MAX_CONTEXT_TOKENS = 100_000` in `src/agent/context-assembler.ts`
  - After building `chatMessages[]` (system prompt + user messages) and before `client.complete()`: call `chatMessages = truncateMessages(chatMessages, MAX_CONTEXT_TOKENS)`
  - Log a warning when truncation occurs: `console.warn('[context] Truncated: dropped N oldest messages to fit 100K token budget')`

- [ ] T086 [US7] Update `executeApprovedAction()` in `src/agent/chat.ts`:
  - After memory extraction from approved tool result: if `supportsEmbeddings()`, compute and save embedding for each new memory

**Step 4: Provider switch detection**

- [ ] T087 [US7] Add model validation to `loadEmbeddings()` in `src/agent/memory/memory-embeddings.ts`:
  - When loading the embedding file, compare `file.model` against `getEmbeddingModel()`
  - If they differ (user switched providers): return empty `{}` (all embeddings invalid, will be lazily recomputed)
  - Log: `console.log('[embeddings] Model changed from ${file.model} to ${currentModel}, invalidating cached embeddings')`

**Step 5: Verify**

- [ ] T088 [US7] Run `npm run lint` — verify zero new type errors
- [ ] T089 [US7] Run `npm test` — verify all tests pass including new embedding and retriever tests

**Checkpoint**: Memory retrieval uses semantic similarity when the active provider supports embeddings. Keyword fallback is preserved for all other providers. Embeddings are stored in a separate file per user. Main memory file performance is unchanged. Context truncation protects against overflow.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup

- [ ] T090 Run full test suite `npm test` — verify all phases pass together with no regressions
- [ ] T091 Run `npm run lint` (tsc --noEmit) — verify zero type errors
- [ ] T092 [P] Verify no file in `src/agent/` exceeds 800 lines: `find src/agent -name '*.ts' -exec wc -l {} + | sort -rn | head -20`
- [ ] T093 [P] Update `docs/designs/harness-improvement-spec.md` — mark Phase 3 as complete, update open questions with resolution status, reference phase3-design-spike.md decisions
- [ ] T094 [P] Verify approval safety end-to-end: create dynamic tool with `send_email` step via chat, execute, confirm approval card appears, approve, confirm email sends
- [ ] T095 [P] Verify embedding retrieval end-to-end: with OpenAI provider active, run a chat turn that creates a memory, then query with a semantically similar (but keyword-different) phrase, verify the memory is retrieved
- [ ] T096 [P] Verify keyword fallback: with Anthropic provider active, run a chat turn, verify memory retrieval works with no errors and no embedding computation attempted
- [ ] T097 Smoke test: run full chat turn with tool use, verify memory extraction, retrieval, access tracking, embedding computation, and context truncation all work together

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **US1, US2, US3 (Phases 3-5)**: All depend on Setup. Can proceed **in parallel** — they modify different files.
- **US4 (Phase 6)**: Depends on US2 completion (US2 modifies tool-composer.ts imports from tools.ts; US4 deletes tools.ts)
- **US5 (Phase 7)**: Depends on US4 completion (US5 extracts from files created by US4 split)
- **US6 (Phase 8)**: Depends on US5 completion (US6 modifies context-assembler.ts created in US5)
- **US7 (Phase 9)**: Depends on US1 + US6 completion (US7 extends memory-retriever.ts modified in US1, and uses batch writes from US6). Design decisions in `docs/designs/phase3-design-spike.md`.
- **Polish (Phase 10)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (Memory quality)**: Independent — modifies only `memory-retriever.ts` and `memory-extractor.ts`
- **US2 (Approval safety)**: Independent — modifies only `tool-composer.ts` and `chat.ts`
- **US3 (Proactive artifacts)**: Independent — modifies only `App.tsx` and `horizon-scanner.ts`
- **US4 (Split tools.ts)**: Blocked by US2 (import paths change)
- **US5 (Context + Approval extract)**: Blocked by US4 (depends on split files existing)
- **US6 (threadBrief + batch)**: Blocked by US5 (modifies context-assembler.ts)
- **US7 (Embeddings)**: Blocked by US1 + US6 (extends memory system)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Implementation tasks are in dependency order
- Run verification (`npm test`, `npm run lint`) after each story

### Parallel Opportunities

**Phase 3-5 (US1 + US2 + US3)** can all run in parallel:
```
Agent A: US1 (memory-retriever.ts, memory-extractor.ts)
Agent B: US2 (tool-composer.ts, chat.ts)
Agent C: US3 (App.tsx, horizon-scanner.ts)
```

Within each story, all test tasks marked [P] can run in parallel.

---

## Parallel Example: Phase 3-5 (All P1 stories)

```bash
# Launch all three P1 stories in parallel:
Agent A: US1 — T006-T015 (memory quality fixes)
Agent B: US2 — T016-T028 (approval safety)
Agent C: US3 — T029-T037 (proactive artifacts)

# Within US1, launch all tests in parallel:
T006: memory-retriever access tracking test
T007: memory-retriever double access test
T008: memory-extractor generic fallback test
T009: memory-extractor specific extractor test
T010: extractResourceIds helper test
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 Only)

1. Complete Phase 1: Setup (verification)
2. Complete US1 + US2 + US3 in parallel
3. **STOP and VALIDATE**: Run all tests, verify approval safety, verify memory tracking
4. Ship Phase 1 improvements — immediate quality boost

### Incremental Delivery

1. US1 + US2 + US3 → Memory works better, approval is safe, drafts connect → **Ship**
2. US4 → tools.ts split → Internal cleanup → **Ship**
3. US5 → Context + Approval modules → Cleaner architecture → **Ship**
4. US6 → Structured threadBrief + batch writes → Better continuity → **Ship**
5. US7 → Embedding retrieval → Transformative recall quality → **Ship**

### Parallel Team Strategy

With multiple agents/developers:

1. Complete Setup together
2. Launch US1, US2, US3 in parallel (different files, no conflicts)
3. After all P1 stories: US4 (sequential — file deletion)
4. After US4: US5 + US6 can partially overlap (different new files)
5. After US6: US7 (extends memory system)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing
- Commit after each completed story
- Stop at any checkpoint to validate independently
- All Phase 1 (P1) stories can ship together as the MVP harness improvement
- Phase 2 (P2) is internal cleanup — no user-visible change except threadBrief
- Phase 3 (P3) is the transformative quality upgrade (embeddings) — design decisions locked in `phase3-design-spike.md`
- US7 has 22 tasks (11 tests + 9 impl + 2 verify) — the largest story, reflecting embedding complexity
- Key architectural decisions: separate `.embeddings.json` file, tiered provider strategy, 100K context budget
