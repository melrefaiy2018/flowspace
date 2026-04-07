# Tasks: Cowork Clarity (Narrative First + Telemetry Visibility)

## Bootstrap
- [x] T001 Create branch `codex/feat/cowork-clarity-visibility`
- [x] T002 Add implementation checklist doc

## Milestone A: Narrative First
- [x] T010 Update website hero + feature messaging to “Delegate -> Track -> Approve”
- [x] T011 Update website metadata/open-graph text to same positioning
- [x] T012 Update in-app empty-state copy + command placeholder to outcome-driven language
- [x] T013 Add compact in-app explainer that write actions require approval

## Milestone B: Telemetry Foundation
- [x] T020 Add run lifecycle types + stream event variants
- [x] T021 Instrument chat tool execution to create/update run records
- [x] T022 Instrument approval execution to continue/update run records
- [x] T023 Add in-memory run store (24h TTL) + summary metrics
- [x] T024 Implement `/api/runs*` endpoints
- [x] T025 Add frontend API methods for runs + summary

## Milestone C: Visibility UX
- [x] T030 Add Runs UI with counts/filtering
- [x] T031 Add Approvals UI with pending count and quick entry
- [x] T032 Link run items back to originating conversation/message
- [x] T033 Add source-app chips on run/result cards
- [x] T034 Add before/after preview in approval cards for write actions

## Milestone D: Reliability & Polish
- [x] T040 Add error taxonomy mapping + friendly UI errors
- [x] T041 Add run completion receipt summary
- [x] T042 Add retry action for safe failed runs (read-only rerun)

## Acceptance checks
- [x] Two concurrent chats produce independent run records
- [x] Write action creates awaiting-approval run and appears in approvals panel
- [x] Approving from global approvals updates correct run to complete
- [x] `/api/runs/summary` matches UI counters
- [x] Website + app messaging both use delegate/track/approve model
- [x] Failed tool calls display friendly error and terminal run status
