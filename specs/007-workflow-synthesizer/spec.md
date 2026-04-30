# Feature Specification: Workflow Synthesizer

**Feature Branch**: `007-workflow-synthesizer`
**Created**: 2026-04-29
**Status**: Draft
**Input**: User description: "Add a Hermes-inspired auto-skill capability to FlowSpace — observe repeated manual tool sequences in the agent and propose them as saved workflows the user can promote into the existing dynamic-tool registry / trigger / scheduler stack."

## User Scenarios & Testing *(mandatory)*

The Workflow Synthesizer earns its keep only if (a) repeated tool sequences actually exist in real usage, and (b) the user can promote a proposal to a saved workflow without leaving their normal flow. The user stories below are prioritized so that P1 alone is a shippable, opt-in observation surface; P2 turns observation into proposals; P3 closes the loop with promotion.

### User Story 1 - Opt in to passive observation (Priority: P1)

A user enables "Suggest workflows from my activity" in Settings. From that point, every tool call the chat agent makes (manual or scheduled) is recorded to a local rolling log with a coarse argument-shape hash. No proposals are surfaced yet — this story exists to ship the observation substrate behind a flag, validate signal density, and let the user audit what's logged before anything is suggested.

**Why this priority**: Without volume data there is no way to tune the detector. Shipping the log + a "Show my recorded activity" view first lets the user see exactly what's captured (privacy gate) and lets the team measure whether n-gram mining will find anything before building the UI.

**Independent Test**: Toggle the flag on, run the agent for a session, open the activity view, and verify (1) every tool call appears, (2) toggling off stops new entries and (3) "Clear log" empties the file. The MVP is useful even with zero proposals: it's a personal "what did the agent do today" audit trail.

**Acceptance Scenarios**:

1. **Given** the synthesizer flag is OFF (default), **When** the agent invokes any tool, **Then** no entry is appended to the invocation log.
2. **Given** the flag is ON, **When** the agent invokes a tool, **Then** an entry containing tool name, argument-shape hash, timestamp, success, and approval status is appended atomically to the log.
3. **Given** the flag is ON and the log holds the rolling cap (e.g. 1000 entries), **When** a new entry is added, **Then** the oldest entry is evicted in the same atomic write.
4. **Given** the user opens the activity view, **When** entries exist, **Then** they are listed newest-first with a "Clear all" action.

---

### User Story 2 - See proposed workflows (Priority: P2)

When the synthesizer detects that the same contiguous sequence of tool calls has occurred at least N times within the look-back window (default N=3, window=14 days) and that sequence is not already a saved dynamic tool, it surfaces a proposal card in the Automations page. Each card shows the sequence (ordered tool names + a representative argument set from the most recent occurrence), occurrence count, and first/last seen timestamps.

**Why this priority**: This is where the feature begins to deliver value. The user sees their own repetition reflected back to them as a concrete suggestion. P2 is independently shippable as a read-only suggestions panel — no promotion path required to deliver insight.

**Independent Test**: Manually seed an invocation log with three identical 3-step sequences, reload the Automations page, confirm a single proposal appears with the correct sequence and a count of 3.

**Acceptance Scenarios**:

1. **Given** an invocation log containing three occurrences of the sequence `search_emails → apply_label_to_threads → archive_email_threads`, **When** the user opens the Automations page, **Then** exactly one proposal card appears with that sequence and `occurrences: 3`.
2. **Given** a sequence has already been registered as a dynamic tool, **When** the detector runs, **Then** no proposal is emitted for that sequence.
3. **Given** a sequence repeated twice (below the threshold), **When** the detector runs, **Then** no proposal is emitted.
4. **Given** the user dismisses a proposal, **When** the detector runs again, **Then** the dismissed sequence is not re-proposed for at least the dismiss-cooldown period (default 30 days).

---

### User Story 3 - Promote a proposal to a saved workflow (Priority: P3)

The user clicks "Save as workflow" on a proposal. The existing dynamic-tool editor opens, pre-filled with the sequence as steps and the most recent argument set as literal values. The user names the workflow, optionally edits arguments / promotes literals to input parameters, and saves. The new workflow appears immediately in the regular workflow list and is eligible for triggers like any user-authored workflow.

**Why this priority**: Promotion is what closes the loop, but observation + visibility (P1+P2) are independently valuable. P3 layers on top.

**Independent Test**: From a proposal card, click "Save as workflow," accept the pre-filled values, save, then verify the workflow appears in `getDynamicTools()` and is callable from chat.

**Acceptance Scenarios**:

1. **Given** the user clicks "Save as workflow" on a proposal, **When** the editor opens, **Then** the steps array matches the proposed sequence in order and arg fields are pre-filled from the most recent occurrence.
2. **Given** the user saves the workflow with a unique name, **When** the save completes, **Then** the workflow is persisted via the existing dynamic-tool registry and the corresponding proposal is removed from the proposals list.
3. **Given** the user attempts to save with a name that collides with an existing tool, **When** the save is submitted, **Then** the registry refuses the write and the user sees a clear error.

---

### Edge Cases

- **Destructive sequences**: If a proposed sequence contains any write tool (e.g. `send_email`, `delete_*`), the proposal card MUST display a destructive-action warning and the saved workflow MUST default to `isWriteTool: true` (approval-gated) regardless of which steps are individually safe.
- **Argument-shape drift**: If the same tool-name sequence has wildly different arg shapes across occurrences (e.g. `search_emails` query string changes every time), the detector still groups them by name-sequence but the proposal card flags "arguments varied across runs" so the user knows the literal pre-fill is just a sample.
- **Log corruption**: If the invocation log file is malformed on read, the system treats it as empty (consistent with how `dynamic-tool-registry` handles bad JSON), logs a warning, and continues — never blocks the agent.
- **Privacy of arguments**: Raw arguments may contain message bodies, recipient emails, file contents. The log MUST persist a hash of the argument *shape*, not the full arguments, by default. A "representative sample" of full arguments is held only for proposals the detector has already emitted, in a separate file the user can clear independently.
- **Concurrent agent runs**: Atomic writes (temp + rename, same pattern as `.workflow-trigger-state.json`) prevent corruption when scheduler and chat agent both fire at once.
- **Disabled mid-session**: Toggling the flag OFF stops new appends immediately; in-flight detector runs complete on the data they already have.
- **Long sequences**: Detector caps subsequence length at 5 to bound cost and avoid proposing unwieldy macros.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST default the synthesizer feature to OFF and MUST NOT persist any invocation data when disabled.
- **FR-002**: When enabled, system MUST append a `ToolInvocation` record to the rolling log on every tool dispatch (chat agent and scheduler paths alike), capturing: tool name, argument-shape hash, ISO timestamp, success boolean, and approval-gate outcome.
- **FR-003**: System MUST cap the invocation log at a configurable size (default 1000 entries) and at a configurable age (default 30 days), evicting oldest entries first, in the same atomic write that adds new entries.
- **FR-004**: System MUST persist the log via atomic write (temp file + rename) in `DATA_DIR`, consistent with existing JSON state files (`.workflow-trigger-state.json`, `.dynamic-tools.json`).
- **FR-005**: System MUST detect contiguous tool-name subsequences of length 2–5 that occur at least 3 times (configurable) within the look-back window (default 14 days, configurable) and are not already registered as dynamic tools.
- **FR-006**: System MUST exclude detector-only "read" sequences from being silently auto-promoted — any promotion to the registry MUST be user-initiated.
- **FR-007**: System MUST flag proposals that contain at least one write/destructive tool and MUST default the resulting saved workflow's `isWriteTool` to true.
- **FR-008**: Users MUST be able to view the recorded invocation log and clear it from the Settings or Automations page.
- **FR-009**: Users MUST be able to dismiss a proposal; dismissed proposals MUST NOT reappear for at least 30 days.
- **FR-010**: Users MUST be able to promote a proposal into a saved dynamic tool via the existing workflow editor pre-filled with the proposed sequence and a representative argument set.
- **FR-011**: System MUST refuse to register a promoted workflow whose name collides with an existing static or dynamic tool, surfacing a clear error.
- **FR-012**: System MUST never store full argument values in the rolling log itself; only argument-shape hashes. A separate, per-proposal "representative sample" file MAY hold the most recent literal arguments for the proposed sequences, and MUST be clearable independently.
- **FR-013**: System MUST expose a settings flag (`enableWorkflowSynthesis`) and MUST honor flag-off immediately for new invocations.
- **FR-014**: Detector MUST run on a debounced schedule (e.g. on log append + min interval) and MUST NOT block the tool-dispatch hot path; observation hook MUST be O(1) append + return.
- **FR-015**: System MUST be observable: a count of recorded invocations, count of active proposals, and last detector run timestamp MUST be queryable for diagnostics.

### Key Entities

- **ToolInvocation**: Single recorded tool call. Attributes: tool name, argument-shape hash, timestamp, success, approval outcome, source (`chat` | `scheduler`). Append-only, capped, evicted FIFO.
- **InvocationLog**: Persisted rolling collection of ToolInvocations (`.tool-invocation-log.json`). Versioned wrapper, atomic write.
- **WorkflowProposal**: Detector output. Attributes: ordered tool-name sequence, occurrence count, first/last seen timestamps, contains-destructive flag, pointer to representative-arguments sample, dismissed flag + dismissed-at timestamp.
- **ProposalSampleStore**: Per-proposal literal-argument samples (`.workflow-proposal-samples.json`), kept separate from the hash-only log so users can clear richer data independently.
- **SynthesisSettings**: User-configurable parameters: `enabled`, `minOccurrences`, `lookBackDays`, `maxSequenceLength`, `dismissCooldownDays`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the flag enabled, observation overhead on the tool-dispatch path is ≤ 1 ms per tool call at the 95th percentile (measured locally with the existing test harness).
- **SC-002**: Across one week of opt-in self-dogfooding by the maintainer, the system surfaces at least 3 distinct proposals OR returns a clear "no candidate sequences found" diagnostic. (This is the kill criterion: if signal density is too low, the feature is shelved without shipping the proposal UI.)
- **SC-003**: Of proposals shown to the user, ≥ 50 % are either promoted to a saved workflow or actively dismissed within 30 days of first appearing — i.e. the system avoids generating noise the user ignores.
- **SC-004**: Zero invocation-log corruption events under simulated concurrent writes (chat agent + scheduler firing simultaneously) in a 1000-iteration stress test.
- **SC-005**: Toggling the flag OFF stops new log appends within one tool dispatch; toggling ON resumes them within one dispatch — verified by integration test.
- **SC-006**: No raw email bodies, recipient addresses, file contents, or other PII appear in `.tool-invocation-log.json` at any point — verified by a content scan in CI.
