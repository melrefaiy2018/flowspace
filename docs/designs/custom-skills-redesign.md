# Custom Skills Redesign — From Workflow Builder to "Teach the Agent"

## Context

FlowSpace already has a working Custom Skills backend: users can define multi-step agent workflows, persist them to `.dynamic-tools.json`, and invoke them from chat. The mechanics are solid — the registry, template interpolation (`{{input.x}}`, `{{steps.N.field}}`), validation, approval-gated write tools, and LLM tool-bridge all work (`src/agent/tool-composer.ts:153-219`, `src/agent/dynamic-tool-registry.ts`, `src/agent/dynamic-tool-bridge.ts`).

The problem is the **front door**. `src/pages/SkillsPage.tsx` + `src/components/SkillCard.tsx` (529 lines of form state) drop the user into an engineer's workflow editor: raw `name` slug, JSON Schema `parameters`, a step-by-step action picker, and a write-tool checkbox. Normal users do not think in those terms. They think "prep my 9am meeting," "every Friday, send me a weekly digest of what I shipped," "turn this email into a task."

FlowSpace is moving toward a chat-centric, outcome-first, trust-forward assistant. The Custom Skills surface is the biggest remaining pocket of builder-UX in the product. This plan replaces it with a natural-language-first experience that uses the **already-existing `create_tool` meta-tool** (registered in `dynamic-tool-bridge.ts`) to let the agent author skills *for* the user, while keeping full power available behind an "Advanced" disclosure for the 5% who want it.

The backend does not need to change. This is a frontend + microcopy + IA redesign that also lightly extends two existing surfaces (ChatContext hand-off and a new "Save as reusable workflow" affordance in chat).

---

## 1. Diagnosis — why the current page fails

The current screen (`SkillsPage.tsx:1-204`, `SkillCard.tsx:1-529`) has six conceptual failures, not visual ones:

1. **Tool-first, not outcome-first.** The headline user question is "what do I want to happen?" The form asks "what's the internal name, what JSON Schema describes the parameters, which of these 30 low-level actions do you want to chain?" The user has to reverse-engineer their goal into the system's vocabulary before they can make progress.
2. **Blank-canvas paralysis.** A brand-new user lands on an empty list ("Ask the agent to do something complex..." per `SkillsPage.tsx`) followed by a form with eight empty fields. There is no on-ramp, no templates, no example, no "here's what a skill looks like."
3. **Leaks implementation language.** "Requires approval (write tool)", "Parameters (JSON Schema)", "outputKey", `{{steps.0.spreadsheetId}}` are all developer terms. The trust model ("ask me before sending email") is hidden behind a checkbox labeled with a type annotation.
4. **Step editor is a programming task.** Users are expected to pick an action from a dropdown of 30+ internal names (`search_drive`, `docs_write`, `sheets_append`, …), type arg values, and thread them by `outputKey`. This is DAG authoring. It belongs in an Advanced mode, not the default experience.
5. **Disconnected from chat.** The strongest interaction model in FlowSpace is chat + approval cards + `triggerAction()` hand-off (`ChatContext.tsx:673-731`, `ChatThread.tsx:578-701`). Custom Skills ignores all of it. The user writes a skill in a form, saves it, and has to guess how to run it. There is no dry-run, no preview, no "try it once and see."
6. **No trust ladder.** The user goes from "I just typed a description" straight to "it's saved and executable." There is no test run, no visible plan preview, no "here is what I will do on your behalf and what I will ask permission for." Trust has to be earned, not assumed.

The underlying meta-failure: **the page treats the user as the author of the workflow**, when the product should treat the **agent** as the author and the **user** as the person describing the outcome and approving the result.

---

## 2. New product framing

Rename and reframe the surface. "Custom Skills / Create New Skill" is internal language.

- **Nav label:** `Workflows` (replacing `Skills` in `AppRail.tsx`)
- **Page title:** `Your workflows`
- **Subtitle:** `Recurring jobs you've taught FlowSpace to do for you.`
- **Primary CTA:** `Teach a new workflow` (not "Create New Skill")
- **Concept:** A **workflow** is "a recurring job the agent has learned from you." The verb is **teach**, not **build**. The user describes an outcome in plain language; the agent proposes a plan; the user tries it; the user saves it.

"Skill" is reserved internally (in code, types, API routes) — no backend rename required. The user never sees the word.

---

## 3. Redesigned page structure

Three surfaces, in order of importance:

### 3a. `Your Workflows` — the index page

Replaces `SkillsPage.tsx`.

**Header row** (matches `ContextHeader.tsx` pattern):
- Kicker: `Workflows`
- Title: `Recurring jobs you've taught FlowSpace`
- Right side: `＋ Teach a new workflow` button (primary)

**Content:**
- **Section 1 — "Your workflows"** (shown if any exist): Card grid matching `AttentionPanel.tsx` / `FollowupPanel.tsx` conventions — rounded-[22px], border-white/6, p-4, hover lift. Each card shows:
  - Workflow name (human label, not slug)
  - One-line "what it does" description
  - Last run relative time ("Ran 2 hours ago" / "Never run")
  - A trust chip: `Asks before sending` / `Runs automatically` (derived from `isWriteTool`)
  - Row of inline actions on hover: `▶ Run now`, `⋯ Edit`, `Delete`
- **Section 2 — "Suggested for you"**: 4–6 starter templates rendered as dimmer cards with a `+` affordance. Templates are hardcoded seed descriptions, not pre-created skills. Clicking one pre-fills the teach flow with its description.
  - `Prep me for my next meeting`
  - `Turn this email into a task`
  - `Weekly digest of what I shipped`
  - `Triage my inbox every morning`
  - `Follow up on unanswered emails after 3 days`
  - `Save important emails to a Drive doc`
- **Empty state** (no workflows yet): single hero card with `Sparkles` icon, copy: *"FlowSpace can learn recurring jobs for you. Describe one in plain language and I'll figure out the steps."* + primary CTA + the suggested templates rendered below.

### 3b. `Teach a new workflow` — the natural-language authoring flow

This is the replacement for `SkillCard.tsx` create mode. A full-page modal (not a sidebar form), with a **three-stage progression**. The user only sees one stage at a time; advancing is explicit.

**Stage 1 — Describe (natural language input)**

- Headline: `What recurring job should I learn?`
- Subhead: `Describe it the way you'd ask a colleague. I'll figure out the steps.`
- Single large textarea (autofocus, 4 rows min), placeholder: *"Every Friday afternoon, summarize what I shipped this week based on my calendar, recent docs, and sent emails — then draft an email to my manager."*
- Below the textarea: a row of **"Start from a template"** chips (the same 6 suggestions from the index).
- Primary button: `Generate plan →` — calls the existing `create_tool` meta-tool path on the backend (same one the agent uses). The LLM produces a `DynamicToolDef` (name, description, steps, isWriteTool). No schema editing yet.
- Secondary button: `Cancel`.

**Stage 2 — Review the plan** (generated plan preview)

This is the single most important new screen. It turns an opaque `DynamicToolDef` into something a non-technical user can read and trust.

- Headline: `Here's what I'd do`
- Subhead: `Review the plan. You can tweak it, run it once to test, or save it as-is.`
- **Plan card** (card style matches `AttentionPanel`):
  - **Name** (editable, human label — e.g., "Weekly shipping digest")
  - **What it does** (editable one-line — feeds `description`)
  - **Steps** rendered as a **numbered vertical timeline**, each step as a natural-language sentence generated from the action + args, not the action name. Examples:
    - `1. Look at your calendar for the past week`
    - `2. Find Google Docs you edited in the past week`
    - `3. Check your sent emails for project updates`
    - `4. Summarize everything into a digest`
    - `5. Draft an email to your manager` ← this step shows an amber `Asks before sending` chip
  - Each step has a subtle `Edit` link that, when clicked, reveals the raw action/args inline (progressive disclosure — but most users will never click).
- **Trust summary** (auto-generated from steps): a short sentence like *"This workflow reads from Calendar, Drive, and Gmail, and will ask you before sending the email."* Replaces the "Requires approval (write tool)" checkbox entirely. The checkbox still exists **inferred automatically** from whether any step is a write action; user never has to set it.
- Buttons:
  - Primary: `▶ Try it once` (runs the workflow live with any approvals surfaced in chat — see §8)
  - Secondary: `Save without testing`
  - Tertiary: `← Regenerate` (re-prompts the meta-tool with the same description) / `Start over`

**Stage 3 — Test run result**

After `Try it once`:

- Headline: `Here's what happened`
- A result card showing each step with a green check / red X / amber "waited for approval" state, plus the final output (rendered as chat-message-style markdown).
- Buttons:
  - Primary: `Save workflow` (commits via `POST /api/dynamic-tools`)
  - Secondary: `Tweak the plan` (back to Stage 2 with edits preserved)
  - Tertiary: `Discard`
- On save, toast: `Workflow saved. You can run "Weekly shipping digest" anytime from chat or the Workflows page.`

### 3c. Chat hand-off affordance (new, lightweight)

When the user has a long chat where the agent just did a complex multi-step thing, surface a subtle bottom-of-message affordance (already a good pattern spot — compare `InboxTriage` feedback buttons):

> `Save this as a reusable workflow?`

Clicking opens Stage 2 directly, pre-populated from the recent tool calls. This is the strongest growth loop for workflows: users don't discover the Workflows page first — they build trust in chat, then promote good runs into workflows.

---

## 4. Interaction states

The redesigned flow must handle these states explicitly:

| State | Where | What the user sees |
|---|---|---|
| **Index — empty** | `Your Workflows` | Hero empty card + suggested templates; no list section |
| **Index — populated** | `Your Workflows` | Workflow cards + suggested templates below |
| **Teach — draft (Stage 1)** | Modal | Textarea with placeholder; `Generate plan` disabled until ≥10 chars |
| **Teach — generating** | Modal | Stage 2 skeleton + shimmer on steps; button shows `Thinking…` with Sparkles |
| **Teach — generation failed** | Modal | Stage 1 with inline error card: *"I couldn't turn that into a plan. Try adding more detail about when and what."* + a `Try again` button |
| **Teach — plan ready (Stage 2)** | Modal | Editable plan with steps timeline; all buttons enabled |
| **Teach — regenerating** | Modal | Stage 2 with skeleton over steps; header shows `Rethinking…` |
| **Teach — test running (Stage 3)** | Modal | Steps timeline with live per-step status (spinner → check/X); approval requests surface inline as amber cards matching `ChatThread.tsx:578-701` |
| **Teach — test waiting for approval** | Modal | Amber card inline: *"Step 5 wants to send an email. Review and confirm?"* with Confirm / Cancel |
| **Teach — test succeeded** | Modal | Green header check, final output rendered, `Save workflow` primary |
| **Teach — test failed** | Modal | Red header, failing step highlighted, error message, options: `Edit step`, `Regenerate`, `Save anyway` (for cases where failure is expected e.g. no calendar events today) |
| **Teach — saved** | Toast + modal closes | Index updates with new card, briefly highlighted |
| **Edit existing** | Modal reused | Opens directly at Stage 2 with the saved plan loaded |
| **Advanced mode expanded** | Stage 2 only | Extra section appears below trust summary — see §7 |
| **Running from index** | Chat takes over | `Run now` calls `triggerAction()` and opens chat with the workflow invoked |

---

## 5. Microcopy

Exact strings a frontend engineer can lift directly.

**Nav & page titles**
- Nav item: `Workflows`
- Page kicker: `Workflows`
- Page title: `Recurring jobs you've taught FlowSpace`
- Primary button: `＋ Teach a new workflow`

**Index — empty state**
- Title: `Teach FlowSpace a recurring job`
- Body: `Describe something you do regularly — prepping for meetings, weekly summaries, inbox triage — and FlowSpace will learn the steps. You'll review the plan and test it before anything runs for real.`
- Primary: `Teach your first workflow`

**Index — section headers**
- `Your workflows`
- `Suggested for you`

**Card — trust chips**
- `Asks before sending` (for write-tool workflows)
- `Read-only` (for read-only workflows)
- `Ran {relativeTime}` / `Never run yet`

**Teach — Stage 1**
- Headline: `What recurring job should I learn?`
- Subhead: `Describe it the way you'd ask a colleague. I'll figure out the steps.`
- Placeholder: `Every Friday at 4pm, summarize what I shipped this week from my calendar, recent docs, and sent emails — then draft an email to my manager.`
- Helper under textarea: `Tip: mention when it should run, what to look at, and what to produce.`
- Primary: `Generate plan →`
- Chip row label: `Or start from a template`

**Teach — Stage 2**
- Headline: `Here's what I'd do`
- Subhead: `Review the plan. You can tweak it, run it once to test, or save it as-is.`
- Step label format: natural-language sentences, generated by the meta-tool (e.g. `Look at your calendar`, not `calendar_agenda`)
- Trust summary format:
  - Read-only: `This workflow only reads from {services}. It won't change anything on its own.`
  - Mixed: `This workflow reads from {readServices} and will ask before {writeVerbs}.`
  - e.g. `This workflow reads from Calendar, Drive, and Gmail, and will ask before sending the email.`
- Edit step link: `Edit this step`
- Primary: `▶ Try it once`
- Secondary: `Save without testing`
- Tertiary: `Regenerate` / `← Start over`

**Teach — Stage 3**
- Success headline: `Looks good — ready to save?`
- Failure headline: `That didn't work. Want to tweak it?`
- Primary (success): `Save workflow`
- Primary (failure): `Edit the plan`
- Save toast: `Workflow saved. You can run "{label}" anytime from chat or the Workflows page.`

**Chat hand-off prompt**
- After a successful multi-step run: `Save this as a reusable workflow?`
- Tooltip: `FlowSpace can learn from what it just did so you don't have to ask again.`

**Approval language (replaces "Requires approval (write tool)" checkbox)**
- No longer a checkbox. Inferred automatically. Shown as part of trust summary and per-step chips.
- If user opens Advanced and disables auto-detect, the label becomes: `Ask me before each run` (plain English), not `isWriteTool`.

---

## 6. Information architecture — what's shown vs. hidden

**Default (visible to everyone):**
- Workflow label (human)
- One-line description
- Steps as natural-language sentences
- Trust summary (auto-derived)
- Test-run result
- Last run time

**Hidden by default (Advanced disclosure, see §7):**
- Internal `name` slug (auto-generated from label; user never sees unless they expand Advanced)
- `parameters` JSON Schema (auto-generated from the description; most workflows need no parameters)
- Raw `action` name per step (e.g. `docs_write`)
- `args` map and `outputKey`
- Template interpolation syntax (`{{input.x}}`, `{{steps.N.field}}`)
- `isWriteTool` boolean (auto-inferred from step actions via existing `ALLOWED_ACTIONS` write list in `tool-composer.ts:17-31`)
- `createdAt`, version, raw JSON export

**Key IA principle:** the user can successfully author, test, and save a workflow **without ever touching the Advanced section**. Advanced exists for power users and debugging, not for completeness.

---

## 7. Advanced mode

On Stage 2, below the trust summary, a collapsible: `▸ Advanced`

When expanded, reveals:
- **Internal name** (text field, pre-filled from label; warns on collision, uses the existing validation from `tool-composer.ts:116-136`)
- **Parameters** — a friendly key/description editor (not raw JSON); user can add `parameter: description` rows, which compile to a minimal JSON Schema on save. A `</> Edit raw JSON` link toggles to raw mode for true developers.
- **Step editor** — the existing `SkillCard.tsx` step editor (lines 77–181) reused verbatim, just moved behind this disclosure. Users who want to pick `action`, type `args`, and set `outputKey` can still do exactly what they do today.
- **Ask before each run** — explicit override of auto-inferred `isWriteTool`.
- **Export / Import JSON** — round-trips to `DynamicToolDef` shape.

Crucially, this means **zero features are removed**. The redesign is purely additive: a new outcome-first front door, with the old builder-style controls demoted to an Advanced drawer.

---

## 8. Relationship to chat

Chat is where trust is built. Workflows should live on a continuum with chat, not in a parallel universe.

Three integration points:

1. **"Save this as a workflow" hand-off from chat → Stage 2.**
   After any assistant message that includes ≥2 tool calls (detectable from the existing `toolEvents` on the message — see `staged-drafts.json` and current chat block rendering), render a subtle footer chip: `＋ Save as reusable workflow`. Clicking opens the Teach modal at Stage 2, pre-populated: label = "Untitled workflow", description = the user's original prompt from that turn, steps = a `DynamicToolDef` derived from the `toolEvents` (reversed engineering via `create_tool` — we can pass the tool-call trace in as the seed).

2. **"Try it once" from Stage 2 runs the workflow inside chat.**
   Instead of a separate execution surface inside the modal, `Try it once` calls `triggerAction(prompt, true)` (`ChatContext.tsx:673-683`) with a synthetic prompt `Run the workflow I'm drafting` + the draft `DynamicToolDef` in a scratch registry. The modal minimizes to a floating "Testing workflow…" pill, chat opens, the workflow executes exactly like any agent run — **including the existing approval cards in `ChatThread.tsx:578-701`**. When the run finishes, the pill becomes `Test finished — review` and clicking re-opens the modal at Stage 3 with the result wired in. This reuses the entire existing approval infrastructure and trust model. No new approval UI is needed.

3. **"Run now" from index → chat.**
   Clicking `Run now` on a saved workflow card calls `triggerAction()` with `/run {label}` or an equivalent. The workflow runs in a fresh chat conversation so the output, any approvals, and any follow-up questions all land in the user's familiar chat surface. Workflows never execute "silently" from the dashboard — every run has a visible chat trace for trust and debuggability.

The net effect: chat is the **runtime**, Workflows is the **library**, and the Teach flow is a guided bridge between "I described what I want" and "the agent did it."

---

## 9. Final recommendation

**Adopt the three-stage Teach flow (Describe → Review Plan → Test Run), rename the surface to "Workflows", and move the existing step/schema editor behind an Advanced disclosure.** Run all workflow executions — including the test run — through the existing chat + approval infrastructure rather than building a parallel runtime inside the modal.

This is the strongest direction because:

- **It matches how users already think** (outcomes, not DAGs).
- **It requires minimal backend work** — the `create_tool` meta-tool, `executeDynamicTool()`, `DynamicToolDef`, approval flow, and registry all exist and work today. This is a frontend/IA/microcopy redesign, plus one small ChatContext hand-off.
- **It reuses the most trusted surface in the product** (chat + approval cards) as the runtime, so users don't have to learn a second trust model.
- **It doesn't remove any power** — advanced users still get the full step editor and JSON Schema, just one click away.
- **It creates a natural growth loop**: users build trust in chat → save runs as workflows → run them from chat → build more trust. The Workflows page becomes the "library of things I've taught my agent," which is a much stronger product story than "list of tools I manually configured."

The alternatives — "just polish the form," "add a wizard on top of the existing fields," or "build a visual node editor" — all keep the user in the role of workflow author. None of them fix the conceptual failure. This plan moves the user into the role of **outcome describer** and lets the agent do the authoring, which is the whole point of FlowSpace.

---

## Files to modify / reference

**Replace / rewrite:**
- `src/pages/SkillsPage.tsx` (1–204) — becomes the Workflows index with cards + suggested templates + empty state
- `src/components/SkillCard.tsx` (1–529) — gutted; the step editor portion (lines 77–181) is preserved and relocated into a new `AdvancedWorkflowEditor.tsx` used only inside the Advanced disclosure

**New components (suggested paths):**
- `src/pages/WorkflowsPage.tsx` — index
- `src/components/workflows/TeachWorkflowModal.tsx` — three-stage container
- `src/components/workflows/TeachStageDescribe.tsx` — Stage 1
- `src/components/workflows/TeachStageReview.tsx` — Stage 2 (plan preview, timeline, trust summary)
- `src/components/workflows/TeachStageResult.tsx` — Stage 3 (test-run outcome)
- `src/components/workflows/WorkflowCard.tsx` — index card
- `src/components/workflows/SuggestedTemplates.tsx` — template chip row (shared)
- `src/components/workflows/AdvancedWorkflowEditor.tsx` — relocated step/schema editor
- `src/components/workflows/TrustSummary.tsx` — derives the human-readable sentence from a `DynamicToolDef`

**Lightly extend:**
- `src/context/ChatContext.tsx` (673–731) — add a `runDraftWorkflow(draft)` helper that injects a draft `DynamicToolDef` into a scratch registry and triggers a chat turn; add a callback so the Teach modal can observe completion
- `src/components/ChatThread.tsx` — add the "＋ Save as reusable workflow" footer chip on assistant messages with ≥2 `toolEvents`
- `src/components/AppRail.tsx` (200–250) — rename nav item `Skills` → `Workflows`, keep the `Puzzle` icon or swap for `Workflow`/`Repeat`
- `src/services/api.ts` (830–856) — no schema change; may add `runDryWorkflow(draft)` if we decide to support stateless test runs without persisting

**No changes required (verified in exploration):**
- `src/agent/tool-composer.ts` — validation, execution, interpolation all stay
- `src/agent/dynamic-tool-registry.ts` — persistence stays
- `src/agent/dynamic-tool-bridge.ts` — LLM bridge stays, including `create_tool` meta-tool which now gets heavier use
- `src/agent/dynamic-tool-types.ts` — `DynamicToolDef` shape stays
- `server.ts` (3905–3958) — endpoints stay; possibly add `POST /api/dynamic-tools/dry-run` if test runs shouldn't persist

---

## Verification

1. **Empty state:** fresh DATA_DIR (no `.dynamic-tools.json`), open Workflows page → see hero empty card + suggested templates, no list section.
2. **Template → teach:** click a suggested template chip → modal opens at Stage 1 with the template text pre-filled → click `Generate plan` → Stage 2 renders a human-readable timeline within a few seconds.
3. **Trust summary correctness:** test with a read-only workflow (e.g. `meeting_prep`-style) and a write workflow (e.g. `send digest email`) — confirm the auto-inferred summary and chips match the actual step actions per `ALLOWED_ACTIONS` write set.
4. **Test run inside chat:** click `Try it once` → Teach modal minimizes to a pill → chat opens and runs the draft workflow → any write step surfaces the existing amber approval card from `ChatThread.tsx:578-701` → approving advances execution → modal re-opens at Stage 3 with the result.
5. **Save flow:** click `Save workflow` → `POST /api/dynamic-tools` succeeds → toast appears → index refreshes and shows the new card highlighted.
6. **Advanced mode parity:** on Stage 2, expand Advanced → confirm the relocated step editor still edits `name`, `parameters`, `steps[]`, `isWriteTool` with the same validation behavior as today (`tool-composer.ts:116-136`). Run existing tests in `src/pages/__tests__/SkillsPage.test.tsx` + `src/agent/__tests__/tool-composer.test.ts` — they should still pass against the relocated editor.
7. **Chat hand-off:** in chat, run any assistant turn that triggers ≥2 tool calls → confirm the `＋ Save as reusable workflow` chip appears on the assistant message → clicking opens Stage 2 pre-populated.
8. **Run from index:** click `▶ Run now` on a saved workflow card → chat opens in a new conversation and runs the workflow end-to-end, with approvals surfaced inline.
9. **Regression:** existing `SkillsPage.test.tsx`, `dynamic-tool-registry.test.ts`, `dynamic-tool-integration.test.ts`, `tool-composer.test.ts` all pass (backend untouched; frontend tests will need updates to reflect the new component tree).
