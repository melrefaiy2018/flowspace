# Implementation Plan: Workflow Synthesizer

**Branch**: `007-workflow-synthesizer` | **Date**: 2026-04-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-workflow-synthesizer/spec.md`

## Summary

Add an opt-in "auto-skill" capability inspired by Hermes Agent: passively observe the agent's tool dispatches, mine repeated sequences, and propose them as saved workflows the user can promote into the existing dynamic-tool registry. The implementation reuses every existing piece of FlowSpace plumbing — atomic JSON state in `DATA_DIR`, the dynamic-tool registry, the workflow editor, the trigger/scheduler stack — and adds one new module (`src/agent/synthesizer/`), one new settings flag, and a small UI surface in the existing Automations page. Default-off; hash-only persistence; literal arguments stored only per-active-proposal in a separately clearable file. Ships behind a kill criterion: ≥ 3 real candidate sequences in 7 days of dogfooding, or User Stories 2 and 3 are shelved.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+ (server) and React 19 (frontend), per Constitution stack lock.
**Primary Dependencies**: Express (existing), Vitest (existing), `crypto` (Node built-in for SHA-1), Tailwind v4 + Lucide React (existing UI). No new runtime dependencies.
**Storage**: JSON files in `DATA_DIR`, scoped per Google account via `getScopedDataPath()`, written atomically (temp + rename). Three new files: `.tool-invocation-log.{accountKey}.json`, `.workflow-proposals.{accountKey}.json`, `.workflow-proposal-samples.{accountKey}.json`.
**Testing**: Vitest + `@vitest/coverage-v8`. Test files co-located in `__tests__/` directories adjacent to source. Includes a privacy-assertion test (`synthesizer-privacy.test.ts`) that scans persisted files for PII sentinels.
**Target Platform**: macOS (Tauri v2 packaging) and local-dev Express; same boundary as the rest of FlowSpace.
**Project Type**: Web (Express server + React SPA, single Express boundary per Constitution II).
**Performance Goals**: Observation hook ≤ 1 ms p95 on the tool-dispatch hot path. Detector runs deferred / debounced (every 10 appends or 5 min, whichever first); never inline.
**Constraints**: No raw arg values in the rolling log (Constitution I). No new runtime dependency (Constitution stack lock). All write tools route through the approval pipeline (Constitution I). Atomic writes per persistence rule.
**Scale/Scope**: ≤ 1000 invocation log entries / ≤ 30 days retention (configurable). Single-user, local-only. Proposal store unbounded but pruned with the log.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-design check (after spec, before research)

| Principle | Compliance | Notes |
|---|---|---|
| **I. User Data Sovereignty** | ✅ | Default-off; hash-only persistence (FR-012); literal samples in a separately clearable file; no outbound telemetry. |
| **II. Two-Layer Server Architecture** | ✅ | All endpoints in `server.ts`; frontend access via `src/services/api.ts` typed wrappers (see contracts/api.md). |
| **III. Test-First Development** | ✅ | Spec lists testable acceptance scenarios per user story; SC-001/-004/-005/-006 are mechanically verifiable. Phase 2 will TDD them. |
| **IV. Small, Cohesive, Immutable Modules** | ✅ | New code lives in `src/agent/synthesizer/` with one file per concern (observer, log-store, detector, proposal-store, sample-store, settings). All entities defined as `readonly` interfaces. Append-only log; FIFO eviction returns a new array. |
| **V. Boundary Validation & Explicit Errors** | ✅ | Settings PATCH endpoint validates ranges; persisted file readers fall back to empty on malformed JSON (matching `dynamic-tool-registry`); observer hook is try/caught and never throws into dispatch. |

**Stack lock**: No new runtime dep — uses Node built-ins (`crypto`, `fs`).
**Persistence rule**: All three new files use `getScopedDataPath()` and atomic writes.
**Approval pipeline**: Promoted workflows flow through the existing dynamic-tool path; destructive proposals default `isWriteTool: true`.

**Result**: PASS. Proceeding to Phase 0.

### Post-design check (after Phase 1 contracts/data-model)

| Principle | Compliance | Notes |
|---|---|---|
| **I. User Data Sovereignty** | ✅ | Data model splits hash-only log from per-proposal samples. Privacy invariant has a dedicated CI test (research R6). No new outbound network. |
| **II. Two-Layer Server Architecture** | ✅ | Eight new endpoints, all in `server.ts`, all consumed via `src/services/api.ts`. Cache convention does not apply (mutations + diagnostic reads). |
| **III. Test-First Development** | ✅ | Phase 2 will produce: unit tests for hash, eviction, detector; integration tests for each endpoint; contract test for promote → registry. |
| **IV. Small, Cohesive, Immutable Modules** | ✅ | Six new files in `src/agent/synthesizer/`, each ~80–200 lines. No file approaches 800-line ceiling. UI changes are additive (new section on existing page + new Settings panel). |
| **V. Boundary Validation & Explicit Errors** | ✅ | Settings range validation in PATCH; promote endpoint maps `registerDynamicTool` null return to 409; observer hook fail-closed. |

**Result**: PASS. No violations to track.

## Project Structure

### Documentation (this feature)

```text
specs/007-workflow-synthesizer/
├── plan.md              # This file
├── spec.md              # Feature spec
├── research.md          # Phase 0 — algorithm, schema, privacy decisions
├── data-model.md        # Phase 1 — entities, invariants, state transitions
├── quickstart.md        # Phase 1 — implementer onboarding
├── contracts/
│   └── api.md           # Phase 1 — HTTP + observer-hook contracts
└── tasks.md             # Phase 2 — emitted by /speckit.tasks (NOT in this run)
```

### Source Code (repository root)

```text
src/
├── agent/
│   ├── synthesizer/                       # NEW
│   │   ├── observer.ts                    # recordInvocation hook (called from tool-dispatch)
│   │   ├── invocation-log.ts              # append-only rolling log + atomic writes
│   │   ├── args-hasher.ts                 # canonical shape hash (research R2)
│   │   ├── detector.ts                    # n-gram extraction + emit proposals
│   │   ├── proposal-store.ts              # active + dismissed proposals
│   │   ├── sample-store.ts                # per-active-proposal literal-arg samples
│   │   ├── settings.ts                    # SynthesisSettings + range validation
│   │   ├── ring-buffer.ts                 # in-memory last-N dispatches for sample capture
│   │   ├── types.ts                       # ToolInvocation, WorkflowProposal, etc.
│   │   └── __tests__/
│   │       ├── args-hasher.test.ts
│   │       ├── invocation-log.test.ts
│   │       ├── detector.test.ts
│   │       ├── proposal-store.test.ts
│   │       ├── sample-store.test.ts
│   │       ├── settings.test.ts
│   │       └── synthesizer-privacy.test.ts # PII sentinel scan (SC-006)
│   ├── tool-dispatch.ts                   # MODIFIED: one call to recordInvocation in finally
│   └── workflow-scheduler.ts              # MODIFIED: ensure scheduler dispatches also reach the hook
│
├── components/
│   └── synthesizer/                       # NEW
│       ├── ProposalCard.tsx
│       ├── ActivityLogView.tsx
│       └── SynthesisSettingsPanel.tsx
│
├── pages/
│   └── AutomationsPage.tsx                # MODIFIED: add "Suggested workflows" section
│
└── services/
    └── api.ts                             # MODIFIED: add typed wrappers for /api/synthesizer/*

server.ts                                  # MODIFIED: register 8 new endpoints (see contracts/api.md)
```

**Structure Decision**: Web project, single Express boundary (Constitution II). New backend logic is fully confined to `src/agent/synthesizer/` and a single edit to `tool-dispatch.ts`. New frontend logic is confined to `src/components/synthesizer/` and additive edits to `AutomationsPage.tsx` and `services/api.ts`. No new top-level directories.

## Phase Summaries

### Phase 0 (complete) — Outline & Research

`research.md` resolves 10 design questions covering hook placement, hashing algorithm, n-gram detection, persistence layout, hot-path budget, privacy enforcement, sample collection, UI surface, promotion path, and the kill-criterion spike. No `NEEDS CLARIFICATION` markers were emitted by the spec; the research document captures the decisions, rationale, and explicitly considered alternatives for each.

### Phase 1 (complete) — Design & Contracts

- `data-model.md`: 5 entities (ToolInvocation, InvocationLog, WorkflowProposal, ProposalSampleStore, SynthesisSettings) with field types, validation rules, state transitions, and cross-entity privacy invariants.
- `contracts/api.md`: 8 HTTP endpoints (settings GET/PATCH, log GET/DELETE, proposals GET, dismiss POST, sample GET, promote POST, samples DELETE) plus the internal `recordInvocation` observer-hook contract.
- `quickstart.md`: end-to-end smoke test, build/test commands, privacy invariant guidance, kill criterion.
- Agent context update: pending — to be run in the next step via `.specify/scripts/bash/update-agent-context.sh claude`.

### Phase 2 (NOT in this run) — `/speckit.tasks`

Will produce `tasks.md` with TDD-ordered work items: write tests first per Principle III, then types/stubs, then logic, then endpoints, then UI. User stories are independently shippable (US1 = observation only, US2 = proposals visible, US3 = promotion); tasks will be grouped by user story so US1 can ship and dogfood before US2/US3 are built.

## Complexity Tracking

> Constitution Check passed both pre- and post-design. No violations to justify. This section intentionally left empty.
