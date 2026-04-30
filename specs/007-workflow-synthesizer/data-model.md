# Phase 1 — Data Model

**Feature**: Workflow Synthesizer
**Branch**: `007-workflow-synthesizer`

All entities live in `src/agent/synthesizer/` (new directory) and are persisted as JSON in `DATA_DIR` via `getScopedDataPath()`. All files use the existing `version: 1` envelope and atomic write pattern.

---

## Entity 1: ToolInvocation

A single recorded tool dispatch. Append-only into the rolling log.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | UUIDv4. |
| `name` | `string` | Static or dynamic tool name (e.g. `search_emails`). |
| `argsHash` | `string` | 16-char SHA-1 prefix of canonicalized arg-shape (see research R2). Never the literal args. |
| `timestamp` | `string` | ISO-8601. |
| `success` | `boolean` | Whether dispatch returned a non-error result. |
| `approval` | `'auto' \| 'user_approved' \| 'user_rejected' \| 'pending'` | Outcome of the approval gate. |
| `source` | `'chat' \| 'scheduler'` | Which entry point invoked the tool. |

**Validation rules**:
- `name` MUST be a non-empty string.
- `argsHash` MUST match `/^[0-9a-f]{16}$/`.
- `timestamp` MUST be parseable by `Date.parse`.
- `source` MUST be one of the literal values.

**State transitions**: None. ToolInvocation is immutable; entries are only ever appended or evicted (FIFO by `timestamp`).

---

## Entity 2: InvocationLog

Persisted rolling collection. File: `.tool-invocation-log.{accountKey}.json`.

```ts
interface InvocationLogFile {
  readonly version: 1;
  readonly entries: readonly ToolInvocation[];
}
```

**Invariants**:
- `entries.length ≤ 1000` (configurable via SynthesisSettings).
- For all `e` in `entries`, `now() − e.timestamp ≤ retentionDays` (default 30).
- Eviction policy: oldest by `timestamp` when either cap is exceeded.
- Writes are atomic (temp + rename). Concurrent writers serialize via the same lock pattern as `workflow-trigger-state.ts`.

---

## Entity 3: WorkflowProposal

Detector output. Persisted in `.workflow-proposals.{accountKey}.json`.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | UUIDv4, stable for the life of the proposal. |
| `sequence` | `readonly string[]` | Tool names in order. Length 2–5. |
| `occurrences` | `number` | Count within `lookBackDays`. Re-computed on each detector run. |
| `firstSeen` | `string` | ISO-8601 of earliest matching invocation in window. |
| `lastSeen` | `string` | ISO-8601 of latest matching invocation in window. |
| `containsDestructive` | `boolean` | True if any tool in `sequence` is in the write-tool allowlist. |
| `sampleRef` | `string \| null` | ID into ProposalSampleStore, or null if no sample captured. |
| `dismissedAt` | `string \| null` | ISO-8601 of dismissal, or null if active. |

**Validation rules**:
- `sequence.length ∈ [2, 5]`.
- `occurrences ≥ minOccurrences` (default 3) at time of emission.
- `firstSeen ≤ lastSeen`.
- `dismissedAt`, if set, MUST be ≥ `lastSeen`.

**State transitions**:

```
        (detector emits)
NONE ─────────────────────► ACTIVE
                              │
                              ├─(user dismisses)──────► DISMISSED
                              │                            │
                              │                            └─(30+ days elapsed and sequence still ≥ 3 in window)──► ACTIVE
                              │
                              ├─(user promotes)───────► PROMOTED → removed from store
                              │
                              └─(sequence registered as dynamic tool by other means)──► removed
```

DISMISSED proposals are kept in the file (with `dismissedAt` set) so the detector can honor the cooldown without losing history.

---

## Entity 4: ProposalSampleStore

Per-proposal literal-argument samples. File: `.workflow-proposal-samples.{accountKey}.json`. Separated from the proposal store so users can clear samples without losing dismiss state.

```ts
interface ProposalSampleFile {
  readonly version: 1;
  readonly samples: Readonly<Record<string /* sampleRef */, ProposalSample>>;
}

interface ProposalSample {
  readonly proposalId: string;
  readonly capturedAt: string;       // ISO-8601
  readonly steps: readonly {
    readonly action: string;         // tool name
    readonly args: Readonly<Record<string, unknown>>;
  }[];
}
```

**Validation rules**:
- `steps.length` MUST equal the corresponding proposal's `sequence.length`.
- `steps[i].action` MUST equal `proposal.sequence[i]`.

**State transitions**: Created when detector emits a new proposal; deleted when the proposal is promoted, dismissed-and-purged, or the user clicks "Clear samples" in Settings.

---

## Entity 5: SynthesisSettings

User-tunable parameters. Stored alongside other settings (likely extending the existing settings file rather than a new one — confirm during implementation).

| Field | Type | Default | Range |
|---|---|---|---|
| `enabled` | `boolean` | `false` | — |
| `minOccurrences` | `number` | `3` | `[2, 10]` |
| `lookBackDays` | `number` | `14` | `[1, 90]` |
| `maxSequenceLength` | `number` | `5` | `[2, 10]` |
| `dismissCooldownDays` | `number` | `30` | `[1, 365]` |
| `logCapEntries` | `number` | `1000` | `[100, 10000]` |
| `logRetentionDays` | `number` | `30` | `[1, 365]` |

**Invariant**: When `enabled` flips from `true` → `false`, no in-flight detector run is cancelled, but no new appends occur.

---

## Cross-entity rules

- **No collisions**: A WorkflowProposal whose `sequence` exactly matches a registered dynamic tool's step actions MUST be filtered before persistence.
- **Privacy boundary**: ToolInvocation and WorkflowProposal MUST contain no literal argument values. ProposalSample is the only entity allowed to hold them, and only for active proposals.
- **Account scoping**: All four files MUST be scoped per Google account via `getScopedDataPath()`.
