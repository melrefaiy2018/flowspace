# Implementation Plan: Gmail Tab v1 — Action-First Work Surface

**Branch**: `004-gmail-tab-v1` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-gmail-tab-v1/spec.md`

## Summary

Transform the FlowSpace Gmail tab from a mailbox clone into a work-execution surface by wiring existing FlowSpace intelligence into the Gmail page. Four user stories: (1) action-first row enrichment, (2) action-bucketed default view replacing the three-tab header, (3) inline quick actions with bucket-specific verbs, (4) thread reader decision header with summary and recommended action. Five `/speckit.clarify` decisions locked in: WCAG 2.1 AA keyboard access, list-level enrichment sends metadata only (no bodies), "specific" recommendations must name a concrete entity, Quick wins tie-breaker prefers Reference/FYI, observability via four counters + one latency histogram.

Technical approach is **strict reuse**: extend the existing `/api/ai-triage` endpoint (server.ts:3516) with richer output fields, build a new `/api/thread-brief/:id` endpoint using the same `createLLMClient()` factory and prompt patterns as `/api/briefing`, persist enrichment to `.gmail-enrichment.json` in `DATA_DIR` using the same `getScopedDataPath()` pattern as `.followup-state.json`. Frontend reuses `ApprovalCard` from `ChatThread.tsx:578-701` verbatim (it is already standalone and importable), reuses `InlineReplyCompose.tsx` verbatim for inline draft rendering, and lifts collapsible-bucket UI from `InboxTriage.tsx`. `src/lib/triage.ts` gets a new enrichment-driven path alongside the existing heuristic fallback. No new LLM clients, no new approval UIs, no new composer components.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+ (backend) and React 19 (frontend)
**Primary Dependencies**: Express.js, googleapis + google-auth-library, Vite 6, Tailwind CSS v4, Framer Motion (motion), Lucide React. LLM calls go through `createLLMClient()` (src/agent/llm-client.ts:20-40), which supports Anthropic, Claude Code, Codex, and OpenAI-compatible providers — no new LLM dependency added.
**Storage**: JSON files in `DATA_DIR` (`~/Library/Application Support/FlowSpace/` in prod, project root in dev). New file `.gmail-enrichment.{accountKey}.json` follows the same scoping pattern as `.followup-state.{accountKey}.json` via `getScopedDataPath()` (server.ts:463-469). In-memory `Map<string, ThreadBrief>` cache for thread briefs (session-scoped, cleared on server restart).
**Testing**: Vitest + `@testing-library/react`. Existing test files live in `__tests__/` adjacent to source (`src/components/gmail/__tests__/ThreadList.test.tsx`, `src/pages/__tests__/SkillsPage.test.tsx`, etc.). Coverage target per CLAUDE.md: 80% via `@vitest/coverage-v8`.
**Target Platform**: Desktop web (Tauri v2 WebView on macOS in production, Chrome/Firefox/Safari in dev browser). Mobile receives a tap-to-reveal fallback for quick actions but is not a primary target for v1.
**Project Type**: Fullstack single-project Express+React. Server file `server.ts` at repo root; frontend under `src/`. No monorepo split.
**Performance Goals**: Plain thread row interactive within **1 second** of Gmail tab open (SC-001). Enriched fields appear progressively within **5 seconds** for a 25-thread page. Pick-times response within **3 seconds** for up to 50 calendar events in the next 7 days (SC-009). Fallback-to-three-tab detection within **500 ms** of upstream failure (SC-007).
**Constraints**:
- Enrichment MUST NOT block initial list paint (FR-002)
- List-level enrichment MUST NOT send message bodies to the LLM (FR-006a)
- Full bodies may be sent only when the user explicitly opens a thread (FR-006b)
- No new approval UI — reuse `ApprovalCard` (FR-015)
- No new inline composer — reuse `InlineReplyCompose.tsx` (FR-016)
- No new bulk action pipeline — reuse `useGmailPage.ts performBulkAction()` (FR-018)
- Graceful degradation: when enrichment/brief services fail, fall back to current three-tab experience with banner (FR-025)
- WCAG 2.1 AA for the bucketed list and quick actions (FR-013a)
**Scale/Scope**: Per-user single-mailbox scope. Enrichment batch size capped at 25 threads (matches existing `PAGE_SIZE` in `useGmailPage.ts:10`). Cache key space is `threadId:lastMessageId`; rolling 24h TTL bounds disk growth. Single connected Google account per enrichment pass — cross-account aggregation is out of scope per spec.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Constitution file**: None exists at `.specify/memory/constitution.md` or elsewhere in the project — only the speckit template (`.specify/templates/constitution-template.md`) is present. The project has not adopted a formal constitution.

**Interpretation**: In the absence of a project constitution, this plan is evaluated against the **hard reuse constraints** the user set in the spec (FR-015, FR-016, FR-018, FR-025), the **coding rules** in `/Users/mohamed/.claude/rules/common/` (immutability, error handling, test coverage, small files, security), and the **CLAUDE.md project instructions** (reuse gws CLI where possible, `@/` path alias, Vitest testing).

**Gate evaluation:**

| Gate | Status | Evidence |
|---|---|---|
| **Reuse over rebuild** | ✅ Pass | No new LLM client (reuses `createLLMClient()`). No new approval UI (reuses `ApprovalCard`). No new inline composer (reuses `InlineReplyCompose.tsx`). No new bulk action pipeline (reuses `performBulkAction`). Enrichment extends existing `/api/ai-triage` rather than creating a parallel endpoint. |
| **Small files / high cohesion** | ✅ Pass | New files stay under 400 lines each. Plan groups new components by feature (`src/components/gmail/`) not by type. `SkillCard.tsx` (529 lines) is the only precedent for crossing 400 — the new `EnrichedThreadRow.tsx`, `BucketSection.tsx`, `ThreadDecisionHeader.tsx`, `PickTimesInlineCalendar.tsx` each stay ≤ 250 lines by design. |
| **Immutability** | ✅ Pass | Enrichment data is frozen per batch; cache entries are replaced on write, not mutated. React state updates use functional setters and new object literals. |
| **Error handling** | ✅ Pass | FR-005 (per-thread enrichment failure → plain row), FR-023 (brief failure → minimal decision header), FR-025 (service failure → three-tab fallback) all explicitly handled in spec. No silent swallowing. |
| **Security / privacy** | ✅ Pass | FR-006a and FR-006b (clarified Q2) enforce that message bodies never leave the device during list enrichment; full bodies transmit only when the user explicitly opens a thread. No new secrets, no new external endpoints. |
| **Accessibility** | ✅ Pass | FR-013a (clarified Q1) locks in WCAG 2.1 AA: focusable rows, keyboard-reachable quick actions, screen-reader announcements for row recommendations, visible focus indicators. |
| **Test coverage** | ✅ Pass | Plan explicitly calls for unit tests per new component plus integration tests for enrichment cache, bucket reassignment, and fallback behavior. Targets 80% per project rule. |
| **Observability** | ✅ Pass | FR-027 (clarified Q5) defines 4 counters + 1 latency histogram emitted as structured JSON log lines — matches the minimum-viable pattern since no metrics infrastructure exists in server.ts today. |
| **Complexity tracking** | ✅ No violations | No deviations from simplicity principles required. The only net-new file on the backend is the thread-brief endpoint; the only net-new frontend files are presentational components that compose existing primitives. |

**Result**: Constitution Check **passes**. No violations need justification in the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/004-gmail-tab-v1/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — 9 decisions with rationale
├── data-model.md        # Phase 1 output — ThreadEnrichment, Bucket, ThreadBrief, QuickAction, FreeSlot, EnrichmentCache
├── quickstart.md        # Phase 1 output — end-to-end manual verification flow
├── contracts/
│   ├── ai-triage-enriched.md   # Extended POST /api/ai-triage contract
│   └── thread-brief.md          # New GET /api/thread-brief/:id contract
├── spec.md              # from /speckit.specify + /speckit.clarify
├── checklists/
│   └── requirements.md  # Quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command — NOT created by /speckit.plan)
```

### Source Code (repository root)

This is a fullstack single-project layout. The new Gmail tab work touches backend (`server.ts`), shared types (`src/shared/`, `src/services/api.ts`), agent tools (`src/agent/tools.ts`), frontend components (`src/components/gmail/`), pages (`src/pages/GmailPage.tsx`), hooks (`src/hooks/useGmailPage.ts`), and lib utilities (`src/lib/triage.ts`).

```text
server.ts                                          # MODIFIED — extend /api/ai-triage, add /api/thread-brief/:id, add observability log lines, add cache invalidation on write actions
src/
├── agent/
│   ├── tools.ts                                   # MODIFIED — extract gmail_triage prompt into shared module; add free-slot helper
│   ├── llm-client.ts                              # UNCHANGED — reused
│   └── prompts/
│       └── gmail-enrichment.ts                    # NEW — single source of truth for list-level enrichment prompt + thread-brief prompt (extracted from the current ai-triage logic)
├── lib/
│   ├── ai-triage.ts                               # MODIFIED — return richer shape (recommendedAction, whyItMatters, effortMinutes, priority, bucket)
│   ├── triage.ts                                  # MODIFIED — add enrichment-driven bucket assignment path; keep heuristic as fallback
│   ├── data-dir.ts                                # UNCHANGED — reused
│   └── enrichment-cache.ts                        # NEW — atomic-write cache for .gmail-enrichment.{accountKey}.json (tmp-file + rename pattern, 24h TTL, invalidation on write)
├── services/
│   └── api.ts                                     # MODIFIED — add getThreadEnrichments(threadIds), getThreadBrief(threadId); extend DraftReplyResponse usage for row-inline drafts; extend ThreadEnrichment type
├── hooks/
│   ├── useGmailPage.ts                            # MODIFIED — parallel-fetch enrichment after thread list loads; expose rowDraft state for per-row InlineReplyCompose
│   └── useThreadBrief.ts                          # NEW — hook wrapping /api/thread-brief/:id fetch with per-session memo cache
├── components/
│   ├── gmail/
│   │   ├── ThreadList.tsx                         # MODIFIED — render EnrichedThreadRow instead of plain row; pass enrichment map + rowDraft state
│   │   ├── EnrichedThreadRow.tsx                  # NEW — priority bar, recommended action chip, why line, effort estimate, focus-revealed quick actions, WCAG 2.1 AA accessible name
│   │   ├── BucketedThreadList.tsx                 # NEW — groups enriched rows into 4 buckets (Needs reply / Waiting / Quick wins / Reference), handles collapse state, raw-inbox toggle
│   │   ├── BucketSection.tsx                      # NEW — collapsible bucket header + count + description; patterned on InboxTriage.tsx Section component
│   │   ├── QuickActionMenu.tsx                    # NEW — per-row hover/focus action row with bucket-specific verbs; routes write actions through imported ApprovalCard
│   │   ├── SmartViewUnavailableBanner.tsx         # NEW — small banner shown when enrichment service is unavailable and the page has fallen back to the three-tab view
│   │   ├── ThreadReader.tsx                       # MODIFIED — mount ThreadDecisionHeader above the message scroll region; body continues to render immediately
│   │   ├── ThreadDecisionHeader.tsx               # NEW — summary + recommended action + context chips + first-class action buttons; skeleton while brief loads; minimal fallback on failure
│   │   ├── PickTimesInlineCalendar.tsx            # NEW — inline mini-calendar showing free slots from primary calendar, 7-day horizon; handles empty-slot case
│   │   ├── InlineReplyCompose.tsx                 # UNCHANGED — reused verbatim (lifted into ThreadList row context via new hook state)
│   │   ├── GmailTriageView.tsx                    # DEPRECATED — kept for fallback mode only; no longer rendered by default
│   │   └── SavedThreadList.tsx                    # UNCHANGED in behavior — relocated behind a header dropdown in GmailPage
│   ├── ChatThread.tsx                             # UNCHANGED — ApprovalCard exported for reuse from Gmail tab
│   └── InboxTriage.tsx                            # UNCHANGED — continues to serve the dashboard briefing; Gmail tab does not render it
├── pages/
│   └── GmailPage.tsx                              # MODIFIED — replace three-tab header with BucketedThreadList + "Show raw inbox" toggle + Saved header dropdown; keep search, label filter, bulk action bar unchanged
├── shared/
│   └── chat.ts                                    # UNCHANGED — ApprovalRequest type reused
└── __tests__/                                     # new tests colocated beside each new file (Vitest convention)
    ├── components/gmail/__tests__/EnrichedThreadRow.test.tsx
    ├── components/gmail/__tests__/BucketedThreadList.test.tsx
    ├── components/gmail/__tests__/QuickActionMenu.test.tsx
    ├── components/gmail/__tests__/ThreadDecisionHeader.test.tsx
    ├── components/gmail/__tests__/PickTimesInlineCalendar.test.tsx
    ├── hooks/__tests__/useThreadBrief.test.ts
    ├── lib/__tests__/enrichment-cache.test.ts
    └── lib/__tests__/triage.test.ts               # updated to cover new bucket assignment path
```

**Structure Decision**: Fullstack single-project layout. No new top-level directories. All new backend logic lives in `src/lib/` (enrichment-cache, ai-triage modifications) and `server.ts` (endpoint wiring). All new frontend components live in `src/components/gmail/` to keep the Gmail surface self-contained. Tests colocate under `__tests__/` per existing convention. The agent prompt extraction into `src/agent/prompts/gmail-enrichment.ts` introduces one new subdirectory — justified because the same prompt must be reachable from both the `/api/ai-triage` endpoint and the existing `gmail_triage` agent tool without duplication.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally empty.

---

*Plan generated by `/speckit.plan` on 2026-04-11. Phase 0 research at `research.md`, Phase 1 artifacts at `data-model.md`, `contracts/`, `quickstart.md`. Phase 2 task breakdown deferred to `/speckit.tasks`.*
