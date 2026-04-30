# Phase 0 — Research

**Feature**: Workflow Synthesizer
**Branch**: `007-workflow-synthesizer`

The spec contains no `NEEDS CLARIFICATION` markers. This document resolves the design-time unknowns implied by the spec — algorithms, schemas, integration points, and the kill-criterion spike — before Phase 1 writes contracts.

---

## R1. Where to install the observation hook

**Decision**: Single hook at the bottom of `src/agent/tool-dispatch.ts`, after the dispatch result resolves and before it is returned to the caller. The hook is a fire-and-forget call (`recordInvocation(...)`) that wraps the result in a try/catch, never throwing into the dispatch path.

**Rationale**:
- `tool-dispatch.ts` is the single funnel: both `chat.ts` (manual) and `workflow-scheduler.ts` (automated) ultimately reach `executeDynamicTool` / static-tool branches through this file.
- One hook covers both call sites, satisfies FR-002 (capture both manual and scheduler), and avoids duplicating the observation logic.
- Placing the hook *after* dispatch ensures we record actual outcomes (success / approval-required / failure), not just intents.

**Alternatives considered**:
- *Hook inside `chat.ts` and `workflow-scheduler.ts` separately*: Doubles the integration surface and risks drift if a third entry point is added. Rejected.
- *Wrap each tool case individually inside the dispatch switch*: 23+ insertion points. Rejected as a Principle IV (small, cohesive) violation.
- *Use a higher-level interceptor / middleware abstraction*: Overkill for a single-instrumented call site. Adds complexity for no reuse benefit.

---

## R2. Argument-shape hashing

**Decision**: Compute a stable hash over the *shape* (sorted top-level keys + value types) of the tool-call arguments object, not the values. Algorithm:

1. Walk the args object once, building `[(key, typeof value)]` pairs sorted by key.
2. For nested objects, recurse to depth ≤ 2, then collapse to `'object'`.
3. For arrays, record `['array', length-bucket]` where length-bucket is `0`, `1`, `2-5`, `6+`.
4. Serialize the resulting structure to a canonical string and SHA-1 it. Truncate to first 16 hex chars (collision risk is acceptable at the volumes involved — < 1000 entries).

**Rationale**:
- FR-012 forbids storing raw values in the rolling log. The hash satisfies the privacy gate.
- Using shape (not values) means two `search_emails` calls with different queries hash identically, which is what we want for sequence detection — we're matching *what tool was used in what slot*, not *what literal arg was passed*.
- SHA-1 truncated to 16 chars matches the existing project pattern of small, JSON-friendly identifiers and avoids pulling in a heavier crypto dependency.

**Alternatives considered**:
- *Hash full argument values*: Violates FR-012 (PII / Workspace content in the log). Rejected.
- *No hash, only tool name*: Loses the ability to distinguish `search_emails` invocations that take a `query` from those that take a `threadId` — same name, materially different operation. Rejected.
- *Structural hash + value hash separately*: Two hashes per entry, doubles log size, no clear win. Deferred to v2 if needed.

---

## R3. Sequence detection algorithm

**Decision**: Plain n-gram extraction over the tool-name sequence, sliding window of length 2…`maxSequenceLength` (default 5). Group identical n-grams, count occurrences within `lookBackDays`, emit a `WorkflowProposal` for every n-gram whose count ≥ `minOccurrences` (default 3) and whose tool-name sequence is not already a registered dynamic tool.

Run the detector on a debounced trigger:
- After every N appends (default N=10), OR
- At a minimum interval (default 5 minutes), whichever comes first.

**Rationale**:
- The spec's volume target (≤ 1000 entries) keeps n-gram extraction trivially fast: at most 1000 × (5−1) = 4000 n-grams per pass. No need for streaming algorithms or suffix arrays.
- Contiguous n-grams match the user's mental model ("I do A then B then C"). Skip-grams or out-of-order patterns add complexity for marginal recall.
- Debounce keeps detector cost off the hot path (FR-014).

**Alternatives considered**:
- *Sequence-mining libraries (PrefixSpan, GSP)*: Designed for very large sequence databases; massive overkill, would add a dependency, and locked-stack rule (constitution) would require an amendment.
- *LLM-based pattern synthesis*: Tempting but expensive, non-deterministic, and conflicts with FR-014 (no LLM in the hot path) and Principle V (fail-closed determinism). Rejected for v1; could layer on top later.
- *Trigger detector synchronously on every append*: Violates FR-014. Rejected.

---

## R4. Persistence: file layout and atomicity

**Decision**: Three new JSON files in `DATA_DIR`, each scoped per-account via `getScopedDataPath()` and written atomically (temp + rename), matching `dynamic-tool-registry.ts` and `workflow-trigger-state.ts`:

| File | Purpose | Size cap |
|---|---|---|
| `.tool-invocation-log.{accountKey}.json` | Rolling hash-only log (entities: ToolInvocation[]) | 1000 entries / 30 days |
| `.workflow-proposals.{accountKey}.json` | Active proposals + dismiss state | unbounded but pruned with log |
| `.workflow-proposal-samples.{accountKey}.json` | Most-recent literal arg samples per active proposal | one entry per active proposal |

Each file uses the existing `version: 1` envelope shape and is loaded lazily (single in-memory cache, refreshed on write).

**Rationale**:
- Matches every existing persisted-state pattern in the agent layer (`.dynamic-tools.json`, `.workflow-trigger-state.json`, `.gmail-enrichment.{accountKey}.json`). Consistency over invention.
- Per-account scoping is mandatory per the constitution's persistence rules.
- Splitting samples into a separate file lets the user clear richer data independently (FR-012) without touching the hash-only log used for detection.

**Alternatives considered**:
- *Single file with all three concerns*: Couples privacy boundaries (hash vs. literal samples) into one blast radius. A user wanting to clear samples but keep the log is forced to lose both. Rejected.
- *SQLite or LevelDB*: New runtime dependency, requires constitutional amendment, and the data scale doesn't justify it.

---

## R5. Detector cost & hot-path overhead (SC-001)

**Decision**: Observation hook does only `JSON.stringify` of the small invocation record + atomic file append. Target ≤ 1 ms p95 measured via a microbench in `__tests__/`. Detection runs in a deferred timer / queue, never inline.

**Rationale**:
- The atomic-write path in this codebase already runs in < 1 ms for files this size on local SSD; adding it to the dispatch tail is well within budget.
- Keeping detection deferred decouples user-perceived latency from sequence-mining cost.

**Alternatives considered**:
- *Debounce the writes themselves (batched append)*: Would lose entries on crash and complicate ordering. Atomic per-call write is simpler and still meets the latency budget.

---

## R6. Privacy & PII guarantees (SC-006)

**Decision**: A CI test (`__tests__/synthesizer-privacy.test.ts`) loads a fixture `.tool-invocation-log.json` populated with calls whose args contain known PII tokens (`__SENTINEL_EMAIL_BODY__`, `__SENTINEL_RECIPIENT__`, etc.) and asserts those tokens never appear anywhere in the persisted file. A separate test verifies the same for `.workflow-proposals.json`.

The `.workflow-proposal-samples.json` file is the *only* place literal args may appear. It is opt-in cleared by the user and gated by the same `enableWorkflowSynthesis` flag.

**Rationale**:
- Constitution Principle I (User Data Sovereignty) plus FR-012 demand a hard, machine-checked guarantee that PII can't leak into the long-lived log.
- Sentinel-based content scan is robust to refactors that might accidentally introduce literal-value capture.

**Alternatives considered**:
- *Manual code review only*: Doesn't survive future edits. Rejected.
- *Encrypt the log*: Solves a different threat (file exfil); still needs the no-PII rule, doesn't replace it.

---

## R7. Sample collection without violating R6

**Decision**: When the detector promotes a sequence to a `WorkflowProposal`, it captures the *most recent* invocation's literal args **at that moment** by calling back into a short-lived, in-memory ring buffer (last 100 dispatches) held only while the process is alive. The ring is never persisted as-is. The captured snapshot is written to `.workflow-proposal-samples.json` only when the detector emits the proposal.

**Rationale**:
- Decouples the persistent log (hash-only) from the sample store (literal, per-proposal, smaller).
- The in-memory ring is acceptable per Principle I because (a) it's not persisted and (b) it's bounded.
- If the process restarts before a proposal is emitted, the worst case is a proposal with no sample — the user can still see "this sequence ran 3+ times" and edit args manually in the editor. Graceful degradation, not data loss.

**Alternatives considered**:
- *Persist the literal args alongside hashes*: Direct violation of FR-012. Rejected.
- *Re-run the sequence to capture args*: Side effects, totally unsafe. Rejected.

---

## R8. UI surface: where proposals appear

**Decision**: New "Suggested workflows" section at the top of `src/pages/AutomationsPage.tsx`, above the existing user-authored workflows list. Each card uses the same visual idiom as existing automation cards. A separate "Activity log" link in Settings opens the read-only invocation log view.

**Rationale**:
- Reuses an existing page; no new top-level navigation. Matches Principle IV (cohesive, feature-scoped) and the recent UI consistency pass.
- Keeping the activity log in Settings (not the automations page) signals "diagnostic / privacy" rather than "primary feature".

**Alternatives considered**:
- *Toast / inline chat suggestion*: Interrupts user flow; harder to dismiss durably; more prone to noise.
- *Dedicated "Insights" page*: Adds nav weight for a feature whose value is unproven.

---

## R9. Promotion path

**Decision**: Reuse the existing dynamic-tool editor. The "Save as workflow" action dispatches to the editor with `initialState = { name: '', steps: <proposed sequence>, parameters: {}, isWriteTool: <containsDestructive> }`. On save, the editor calls `registerDynamicTool()` exactly as today; the proposal is then removed from the active list (and its sample record cleared).

**Rationale**:
- Zero new editor UI. The editor is already the canonical promotion surface for user-authored workflows.
- FR-007 (destructive default) is enforced via the pre-fill, which the user can confirm but not silently bypass.
- Naming collision (FR-011) is already handled by `registerDynamicTool` returning `null`.

**Alternatives considered**:
- *Auto-name and one-click promote*: Skips the user's authorship moment, which is exactly the moment they should review destructive flags and arg values. Rejected.

---

## R10. Kill-criterion spike (SC-002)

**Decision**: Before shipping the proposals UI (User Story 2/3), land User Story 1 (observation only) behind the flag, dogfood it on the maintainer's own machine for at least 7 days, then run the detector offline against the captured log. Decision gate:

- ≥ 3 distinct candidate sequences (count ≥ 3 in 14 days) → proceed with US 2 & 3.
- < 3 candidates → shelve US 2 & 3, file a follow-up ticket revisiting the threshold or the algorithm in 60 days.

**Rationale**:
- This is a real product risk, not a perf risk: the feature is only valuable if signal exists. Forcing observation-first lets us make a data-driven kill/proceed decision.
- The cost of US 1 alone is small enough to absorb if the signal turns out to be too sparse.

**Alternatives considered**:
- *Build everything and see*: Burns engineering time on a UI that may surface zero proposals. Rejected.
- *Synthesize fake data to validate the UI*: Fine for unit tests, doesn't substitute for real signal-density measurement.

---

## Open questions deferred to v2

- *Argument-template auto-promotion*: Detect that `subject` varies across occurrences → promote to an input parameter automatically. v1 leaves this to the user in the editor.
- *Cross-tool argument flow inference* (`{{steps.N.fieldPath}}` auto-wiring): Significant complexity for unclear value when the user can author it in the editor. Deferred.
- *Proposal grouping*: If 5 near-identical sequences are detected, do we collapse them into one super-proposal? Defer until we see real candidates.
- *Telemetry / analytics*: No outbound telemetry in v1, per Principle I. Diagnostics are local only.
