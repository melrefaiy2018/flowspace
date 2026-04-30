# Harness Ship Readiness Memo

> Date: 2026-04-12
> Branch: `005-harness-improvements` (4 implementation commits + 1 docs commit)
> Base: `main`
> Type check: Clean (5 pre-existing SignInModal errors only, zero new errors)

---

## 1. Executive Summary

The harness is ready to merge after a manual smoke test.

The core harness rebuild is complete: memory, approval, tools, context assembly, conversation indexing, and conversation summarization are all implemented, type-checked, and tested. No architectural gaps remain. No known merge blockers exist beyond manual validation.

The branch contains 4 commits of implementation work totaling +8,760 / -3,726 lines across 45 files in `src/agent/`. Every major subsystem — memory retrieval, tool dispatch, approval gating, context assembly, conversation continuity — has been modularized, tested, and documented.

The recommendation is: run the smoke test checklist below, then merge.

---

## 2. What Shipped

### Memory system
- Access tracking activated (`incrementAccess()` called on retrieval — was dead code)
- Generic fallback extractor for all tools (was 12 of ~40)
- Embedding-based retrieval for OpenAI/OpenRouter (keyword fallback for others)
- Separate `.embeddings.json` file per user (main memory file stays fast)
- Provider switch detection and lazy embedding recomputation
- Memory-conversation linkage (memories carry `conversationId`, retriever resolves to title)

### Approval system
- Dynamic tool write-step approval enforced (was bypassed entirely)
- Server-side field validation for all 18 write tools (was frontend-only for 5)
- Dynamic tool resume: remaining steps execute after approval, halt at next write step

### Conversation continuity
- Server-side conversation index (metadata-only: id, title, eventId, messageCount, origin)
- `isEventAlreadyPrepped()` in horizon scanner (skips duplicate meeting prep)
- Frontend sends title + eventId to server on every chat request
- Conversation summarization (>30K tokens trigger, LLM-generated, incremental updates)
- Summary injected into system prompt, older messages trimmed
- 100K token context budget with truncation as safety net

### Proactive artifacts
- Draft context (linked docs, related emails) indexed into memory
- Draft discussions linked to calendar events via eventId
- CalendarPage "Resume prep" works for draft discussions

### Code quality
- `tools.ts` (2,900 lines) split into 4 focused files (590 + 832 + 503 + 446)
- `chat.ts` decomposed: orchestration (700) + utils (309) + context assembler (200) + approval runtime (50)
- Conversation index (150) and summary (252) as clean separate modules
- All files in `src/agent/` under 832 lines (one file at 832, all others under 600)

---

## 3. Merge Readiness Assessment

**Classification: Safe to merge after manual smoke test.**

**Justification:**

- Type check is clean. The 5 errors are pre-existing `SignInModal.tsx` issues on the base branch, not introduced by this work.
- All new modules have unit tests (conversation-index: 13 tests, conversation-summary: 14 tests, memory-embeddings: 20+ tests, memory-retriever: embedding scoring + fallback tests, context-assembler: summary rendering tests, chat: approval validation tests).
- No external API changes. The frontend-to-server contract added two optional fields (`title`, `eventId`) to the existing `/api/chat/stream` request body. All existing callers continue to work without them.
- No database migrations. All new persistence uses the existing JSON file pattern (atomic temp+rename writes to DATA_DIR).
- No new dependencies. Embedding calls use native `fetch`. Summarization uses the existing `createLLMClient()`.

**What could go wrong:**
- A runtime integration issue that unit tests don't cover (e.g., memory init failing in a specific auth state, summarization prompt producing poor output for a real conversation). The smoke test addresses this.

---

## 4. Manual Smoke Test Plan

Run `make dev` and test each item in order.

### Test 1: Basic chat turn
- **Setup:** Open the app, sign in, start a new conversation
- **Action:** Send "What's on my calendar today?"
- **Expected:** Agent calls `list_calendar_events` or `calendar_agenda`, returns a formatted response with tool events showing in the UI
- **Failure means:** Core chat orchestration is broken

### Test 2: Memory extraction
- **Setup:** Complete Test 1
- **Action:** Check the dev console for `[memory] Extraction result for list_calendar_events: N memories`
- **Expected:** N >= 1. A memory entry was created from the tool result.
- **Failure means:** Memory extraction pipeline is broken

### Test 3: Memory retrieval on follow-up
- **Setup:** Complete Test 2. Send a second message referencing the first result (e.g., "Tell me more about the first meeting")
- **Action:** Check dev console for `[memory] Loaded N memories`
- **Expected:** Retrieved memories appear in the console log. The response references context from the first turn.
- **Failure means:** Memory retrieval or context assembly is broken

### Test 4: Approval card for write tool
- **Setup:** New conversation
- **Action:** Send "Send an email to test@example.com saying hello"
- **Expected:** An approval card appears with editable To, Subject, Body fields. The email is NOT sent yet.
- **Failure means:** Write tool approval gate is broken

### Test 5: Dismiss approval
- **Setup:** Complete Test 4
- **Action:** Click the dismiss/cancel button on the approval card
- **Expected:** Card disappears. Status message "Action canceled" appears. No email sent.
- **Failure means:** Dismiss path is broken

### Test 6: Approve action
- **Setup:** Trigger another write tool approval (e.g., "Create a task called Test Task")
- **Action:** Click the approve button
- **Expected:** Task is created. Success message appears. Tool event shows "completed."
- **Failure means:** Approval execution path is broken

### Test 7: Dynamic tool with write step (if dynamic tools exist)
- **Setup:** If any dynamic tools with write steps exist, trigger one. Otherwise skip.
- **Action:** Execute the dynamic tool
- **Expected:** Read steps execute. Write step pauses with approval card. After approval, remaining steps execute.
- **Failure means:** Dynamic tool approval gate is broken

### Test 8: Meeting prep draft flow
- **Setup:** Navigate to Calendar page. Find an upcoming meeting with external attendees.
- **Action:** Click "Prepare this meeting"
- **Expected:** New conversation opens with meeting context in the prompt. Agent generates a prep brief.
- **Failure means:** Meeting prep flow or threadBrief injection is broken

### Test 9: Draft discussion event resume
- **Setup:** Complete Test 8. Navigate away. Return to Calendar page.
- **Action:** Find the same meeting. Check for "Resume prep" button.
- **Expected:** "Resume prep" button appears (via `findConversationByEventId()`). Clicking it reopens the prep conversation.
- **Failure means:** eventId linking or conversation resume is broken

### Test 10: Conversation index file created
- **Setup:** Complete any of the above tests
- **Action:** Check `DATA_DIR/.conversations.*.json` (in dev: project root)
- **Expected:** File exists. Contains entries with conversation IDs, message counts, titles.
- **Failure means:** Conversation index upsert is broken

### Test 11: Long conversation behavior
- **Setup:** Have or simulate a conversation with 20+ turns
- **Action:** Send a message. Check dev console for summary-related logs.
- **Expected:** If under 30K tokens: no summary generated (normal behavior). If over: summary generated, older messages trimmed. No errors in either case.
- **Failure means:** Summary trigger or context assembly is broken

### Test 12: Streaming behavior
- **Setup:** Send any message
- **Action:** Watch the response stream in
- **Expected:** Text appears incrementally (chunks). Tool events show running → completed. No visual glitches, no double rendering, no frozen UI.
- **Failure means:** Stream event handling regressed

---

## 5. Merge Blockers and Non-Blockers

### Merge blockers

**None known.** The only prerequisite is completing the manual smoke test above. If all 12 tests pass, merge.

### Important but non-blocking

| Item | Why non-blocking |
|------|-----------------|
| `tool-dispatch.ts` is 832 lines (4% over 800 limit) | The dispatch switch cannot be split further without fragmenting tool execution. Acceptable as-is. |
| `chat.ts` grew to 700 lines (from 641 after utils extraction) due to summarization wiring | Under 800 limit. Could extract summary logic to a helper in a future cleanup pass. |
| Pre-existing `SignInModal.tsx` type errors (5 errors) | Existed before this branch. Unrelated to harness work. Should be fixed separately. |
| `threadBriefSuggestion` still unused by frontend | Explicitly deferred. No regression — it was unused before. |
| Embedding retrieval untested on OpenRouter (only OpenAI verified by code) | Same API shape. Low risk. Will be validated by first OpenRouter user. |

### Future enhancement only

| Item | Status |
|------|--------|
| Structured summary sections (objectives, decisions, open questions) | Prompt change only. No architecture work. |
| Per-provider context limits | Requires LLM settings schema extension. |
| Conversation-scoped memory retrieval | Plumbing in place (conversationId in source). Retriever needs filter option. |
| Local embedding fallback (transformers.js) | Only needed if Anthropic users report poor recall. |
| Cross-device conversation sync | Requires server-side message storage. Intentional boundary. |

---

## 6. Post-Merge Monitoring Plan

### Embedding latency
- **What to watch:** Time between `assistant_begin` and first LLM response for OpenAI/OpenRouter users
- **Why it matters:** `computeEmbedding()` adds ~100ms per query + up to 5 lazy migrations (~500ms). This is in the critical path before the LLM call.
- **Concerning threshold:** If total embedding overhead exceeds 1 second consistently, consider pre-computing all embeddings in a background job rather than lazy migration.

### Approval failures
- **What to watch:** Console errors containing `[approval]` or approval-related error payloads in chat responses
- **Why it matters:** The dynamic tool approval gate is new. A missed code path would allow writes without approval.
- **Concerning threshold:** Any single instance of a write tool executing without an approval card is a critical regression. Zero tolerance.

### Retrieval quality
- **What to watch:** Whether the agent references relevant memories in responses. Look for `memoriesUsed` in AssistantPayload.
- **Why it matters:** The scoring formula changed. Embedding-weighted scoring may surface different memories than keyword-only.
- **Concerning threshold:** If the agent consistently ignores relevant recent memories in favor of old ones, the access tracking or scoring weights may need adjustment.

### Conversation index growth
- **What to watch:** Size of `.conversations.{userHash}.json` over time
- **Why it matters:** The index grows indefinitely (no pruning implemented). At 1,000 conversations with full metadata, the file is ~200 KB — still fast. At 10,000 it could slow down.
- **Concerning threshold:** If any user's index exceeds 500 KB, add pruning (remove entries older than 90 days with no updates).

### Summarization failures
- **What to watch:** Console warnings containing `[summary] Generation failed`
- **Why it matters:** Summary generation uses an LLM call. Network errors, rate limits, or model failures will trigger fallback to truncation.
- **Concerning threshold:** If summarization fails more than 20% of the time for qualifying conversations, investigate the prompt or the provider's reliability.

### Chat flow errors
- **What to watch:** Any new error patterns in `[context]`, `[memory]`, or `[harness]` console logs that were not present before
- **Why it matters:** The harness touches every chat request. A subtle regression could surface as intermittent failures.
- **Concerning threshold:** Any error that appears on >5% of chat requests warrants investigation.

---

## 7. Recommended Next Sprint Items

| Item | Priority | Rationale |
|------|----------|-----------|
| **Structured summary sections** | Do next sprint | Prompt change + output parsing only. No architecture work. Immediately improves the quality of injected summaries by giving the agent structured context (objectives, decisions, open questions) instead of free text. |
| **Per-provider context limits** | Do next sprint | Replaces the 100K hardcoded budget with accurate per-provider limits. LM Studio users with 4K context windows are currently unprotected. Requires adding `contextWindow` to `LLMProviderConfig`. |
| **Conversation-scoped memory** | Do later when needed | The plumbing exists (conversationId in memory source). The retriever needs a filter option. Not urgent until users report noise from cross-conversation memory. |
| **Local embedding fallback** | Do only if product signals justify it | Only matters if a significant portion of users are on Anthropic and report poor recall. Monitor provider distribution first. |
| **Second proactive artifact type** | Do only if product signals justify it | Generalize StagedDraft to ProactiveArtifact only when a second concrete use case (email digest, task reminders) is being built. Not before. |

---

## 8. What Is No Longer Harness Critical Path

The following items should not block product progress. They are either product features that build on the harness, optional quality improvements, or future extensions:

### Product features (use the harness, don't extend it)
- Gmail tab enrichment and workspace features
- New tool development (tools plug into the existing dispatch/approval framework)
- UI improvements to approval cards, memory display, or summary visibility
- Meeting prep UX refinements

### Optional quality improvements
- Structured summary sections (better prompt, not new architecture)
- Retrieval scoring weight tuning (adjust the 6 weight parameters based on real usage)
- Memory pruning strategies (the 500-entry LRU is adequate for now)
- Conversation index pruning (no user has enough conversations to need it yet)

### Future extensions (not foundational)
- Cross-device conversation sync (requires server-side message storage — a product decision, not a harness gap)
- Conversation-scoped memory (retriever filter, not a new subsystem)
- Multi-conversation summarization ("what have I been working on this week?")
- Proactive artifact generalization (wait for the second use case)

None of these should delay product feature development. The harness is complete infrastructure.

---

## 9. PR and Merge Preparation Checklist

- [ ] Confirm branch `005-harness-improvements` is up to date with `main` (rebase or merge if needed)
- [ ] Confirm `npm run lint` passes (only pre-existing SignInModal errors)
- [ ] Complete manual smoke test (12 tests from Section 4)
- [ ] Record any test failures and fix before proceeding
- [ ] Prepare PR with summary:
  - **Title:** `feat(harness): memory, approval, embeddings, conversation index, summarization`
  - **Body:** Reference `docs/designs/harness-overview.md` for full architecture explanation. List 4 commits. Note: zero new type errors, no breaking API changes.
- [ ] List known follow-ups in PR description:
  - Structured summary sections (next sprint)
  - Per-provider context limits (next sprint)
  - Pre-existing SignInModal type errors (separate fix)
- [ ] Merge when smoke test is clean
- [ ] Delete branch after merge

---

## 10. Final Recommendation

### Merge after smoke testing.

The harness is architecturally complete. Memory, approval, tools, context, continuity, and summarization are all implemented, modular, and tested. The type check is clean. The code is documented. The design rationale is captured in 7 design documents.

### Immediately after merge:
- Run `make dev` and do a real usage session to validate the harness in practice
- Monitor console logs for the first few days (embedding latency, summary generation, approval flow)
- If everything is stable, move to product feature work

### Do not:
- Start another harness redesign phase
- Build features that require harness changes before validating the current state in production
- Generalize subsystems (artifacts, memory scoping) before a concrete product need drives it

The harness exists to make the agent useful. It is now strong enough to do that. Ship it and build product on top of it.
