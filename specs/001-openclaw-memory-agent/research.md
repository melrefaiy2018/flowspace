# Research: OpenClaw Memory Agent

## R1: Tool System Import Pattern

**Decision**: Runtime guard with `ALLOWED_SCANNER_TOOLS` Set.
**Rationale**: `tools.ts` exports a single `TOOL_DEFINITIONS` array (all ~40 tools) and `executeTool()` switch statement. Cannot import a subset at module level. Runtime guard is 4 lines, matches existing `isWriteTool()` pattern at tools.ts:409.
**Alternatives considered**: Refactoring tool system for modular import — rejected (touches 2,258-line file, too invasive for Phase 1).

## R2: Scheduling Approach

**Decision**: Manual "Scan next 48h" button in Phase 1. Cron deferred to Phase 1.5.
**Rationale**: Cross-model consensus (Codex + Claude): for a product with zero users, validate brief quality before building scheduler infrastructure. Manual scan removes: node-cron dependency, CLI subcommand, lock files, stale lock cleanup, timezone handling, catch-up scan logic, server-up-or-down branching. 40% complexity reduction.
**Alternatives considered**:
- node-cron in-process — deferred to Phase 1.5 after user validation
- System crontab + CLI command — deferred to Phase 1.5
- OpenClaw scheduling — deferred to Phase 2

## R3: Approve Action Semantics

**Decision**: Approve opens chat with brief pre-loaded as `threadBrief`.
**Rationale**: The brief is context, not an action. The natural follow-up is "now help me with this" which is a chat. Uses existing `ChatContext.triggerAction()` and `threadBrief` mechanism. No new execution path needed.
**Alternatives considered**:
- Create Google Doc with brief — concrete output but not everyone wants a doc per meeting
- Just mark as approved — underwhelming, no user value from the action

## R4: Shared JSON File Store

**Decision**: Extract `SharedJsonFileStore` from `memory-store.ts` before building draft store.
**Rationale**: TODOS.md item P3 says "extract shared JsonFileStore utility — wait until a third store is needed." The draft queue IS the third store (after memory-store and dynamic-tool-registry). Atomic write pattern (temp file + rename) exists at memory-store.ts lines 119-122.
**Alternatives considered**: Copy pattern inline — rejected (third copy of same code, DRY violation).

## R5: Concurrent Scan Prevention

**Decision**: Dedup by meetingId on ingest. No lock file.
**Rationale**: Phase 1 scanner runs in-process via POST endpoint. Single-threaded Express request handler. No concurrent scans possible without cron/CLI.
**Alternatives considered**: Lock file + dedup — was the plan for the cron architecture, now unnecessary.

## R6: Auth for Scanner

**Decision**: Scanner reuses server's `getAuthClient()` directly (in-process).
**Rationale**: No standalone execution. No CLI. No separate auth bootstrapping needed. Token refresh handled by existing server auth module.
**Alternatives considered**: Import auth module separately — was needed for standalone CLI scanner, now unnecessary since scanner runs in-process.

## R7: Importance Feedback Reuse (Phase 2 note)

**Decision**: Phase 2 ImportanceSignal wraps `importance-feedback.ts` instead of building parallel scoring system.
**Rationale**: `importance-feedback.ts` (565 lines) already has `scorePreferenceTarget()`, `PreferenceFeatures`, `extractPreferenceFeatures()`. Two parallel systems learning "what matters to the user" would diverge over time.
**Alternatives considered**: Separate ImportanceSignal store — simpler initially but creates technical debt.

## R8: Scan Result Disambiguation

**Decision**: Scanner output includes metadata: `{ scannedAt, meetingsFound, meetingsPrepped, errors: [] }`.
**Rationale**: Empty draft array is ambiguous — "no meetings" vs "all failed." Metadata lets UI show correct state. Users should never wonder "is something broken or just nothing to do?"
**Alternatives considered**:
- Separate error log file — less clean, two files to read
- Accept ambiguity — bad UX for a product trying to earn trust

## Competitive Context

- **Lindy AI** ($49/mo), **Fyxer** ($28/mo), **Bond** (enterprise) — closed-source AI EAs
- **Reclaim** ($10/mo), **Motion** ($29/mo) — single-purpose calendar/scheduling
- **OpenClaw** (200K stars) — open-source agent framework (infrastructure, not competition)
- **Google Workspace Studio** (free, bundled, March 2026) — Google's own no-code agents
- **FlowSpace's wedge**: only product combining open-source + self-hosted + BYO LLM + full Workspace dashboard + proactive agent
