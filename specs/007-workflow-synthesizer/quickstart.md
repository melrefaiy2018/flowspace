# Quickstart — Workflow Synthesizer

**Audience**: A developer (or future-Claude) sitting down to implement this feature for the first time.

## TL;DR

The synthesizer watches the agent's tool calls. When the same sequence repeats ≥ 3 times, it offers to save it as a workflow. It is OFF by default, hash-only by default, and reuses every existing piece of FlowSpace plumbing it can — atomic JSON in `DATA_DIR`, the dynamic-tool registry, the workflow editor, the trigger/scheduler stack.

## Prerequisites

- Branch `007-workflow-synthesizer` checked out.
- `make install` complete.
- Familiarity with `src/agent/dynamic-tool-registry.ts`, `src/agent/tool-dispatch.ts`, and `src/agent/workflow-trigger-state.ts` — the new code mirrors these.

## End-to-end smoke test (after implementation)

1. **Enable** — open Settings → "Suggest workflows from my activity" → toggle ON.
2. **Observe** — open the chat, ask the agent to do something repetitive three times in a row, e.g.:
   - "Search for newsletter emails from this week and label them 'Newsletters', then archive."
   - Repeat the request twice more (over the same session is fine; the detector debounces but does not require time gaps).
3. **Audit log** — Settings → "Activity log" should now show the recorded invocations (newest first), each with tool name + opaque `argsHash`. No literal email content should be visible anywhere.
4. **See proposal** — open Automations page. A new "Suggested workflows" card should appear at the top showing the 3-tool sequence with `occurrences: 3`.
5. **Promote** — click "Save as workflow". The dynamic-tool editor opens pre-filled. Name it `newsletter_archive`, save.
6. **Verify** — the proposal disappears from the suggestions list and the new workflow appears in the regular list, callable from chat.

## Build / test commands

| Task | Command |
|---|---|
| Type check | `make typecheck` |
| Run synthesizer tests only | `npx vitest run src/agent/synthesizer` |
| Run privacy assertion test | `npx vitest run src/agent/synthesizer/__tests__/synthesizer-privacy.test.ts` |
| Coverage on changed code | `npm run test:coverage -- src/agent/synthesizer` |

## Privacy invariant — DO NOT BREAK

Searching the persisted log files for known PII sentinels MUST return zero hits. The CI test `synthesizer-privacy.test.ts` enforces this. If you change what is captured, run that test first, then the rest.

```sh
# Quick local check
grep -i "to:.*@" "$DATA_DIR/.tool-invocation-log."*.json     # should be EMPTY
grep -i "subject:" "$DATA_DIR/.tool-invocation-log."*.json   # should be EMPTY
```

## Disable / nuke

- Toggle off in Settings → no further appends.
- Settings → "Clear activity log" → empties `.tool-invocation-log.*.json`.
- Settings → "Clear sample data" → empties `.workflow-proposal-samples.*.json`.
- Settings → "Forget all proposals" → empties `.workflow-proposals.*.json`.
- Or, with the app stopped: `rm "$DATA_DIR/.tool-invocation-log.*.json" "$DATA_DIR/.workflow-proposals.*.json" "$DATA_DIR/.workflow-proposal-samples.*.json"`.

## Kill criterion

If you (the implementer / dogfooder) run with the flag enabled for 7 days and see fewer than 3 candidate sequences, **stop**. Don't ship the proposals UI. File a follow-up ticket. The detector is cheap to keep running for diagnostics; the UI is what costs us if the signal isn't there.
