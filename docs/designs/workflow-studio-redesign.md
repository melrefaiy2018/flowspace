# Workflow Studio Redesign — From Blocking Modal to Persistent Workspace

**Date:** 2026-04-10  
**Status:** Approved for implementation  
**Supersedes:** `custom-skills-redesign.md` (modal-based approach)

---

## 1. Diagnosis: What is wrong with the modal flow

### 1a. It blocks at the worst moment

The user types a description and clicks "Generate plan →". The modal enters a `generating` state and the user is **trapped** — they can't browse existing workflows for reference, can't open the action palette, can't check what templates exist. A `fixed inset-0` overlay with 60% black backdrop seals them inside. If the LLM takes 4–6 seconds, they sit in a dead pocket with one visible piece of state: the word "Thinking…" next to a pulsing icon.

### 1b. Generation output appears all at once, then the context disappears

The streaming response from `streamChat` is accumulated into a string with no intermediate display — the user sees nothing until the full JSON arrives. Then the description they typed disappears (Stage 1 is replaced by Stage 2). There is no way to see the original intent and the generated plan side by side. "← Start over" discards everything.

### 1c. "Try it once" is theatrical, not real

Clicking "Try it once" fires `triggerAction` and opens chat, then starts an **800ms `setTimeout`** that unconditionally resolves with `success: true` and hardcoded step outputs (`"Running in chat panel…"`). The Stage 3 screen the user sees is fake — it has nothing to do with what the workflow did. This breaks trust.

### 1d. A wizard in a 640px modal is not a workspace

When the user expands "Advanced", the step editor renders 5+ step cards that grow the content past the visible area. Patching to `h-[90vh]` made it a taller box but didn't fix the structural problem: a linear wizard with multiple state-changing sections isn't suited to a fixed-size overlay. It needs stable, scannable surface area.

### 1e. Index and creation share no context

When the user opens the modal from the index page, the existing workflow list disappears behind a backdrop. They can't cross-reference what they already have. Horizon never does this — selecting a brief shows it in the center column while the list stays visible on the left.

---

## 2. Proposed structure: Two pages, no modal

### Page A — Workflow Library (`/workflows`)

Two-column full-page layout:

**Left column (300px fixed):**
- Section header "Your workflows"
- List of saved workflow rows — name, trust chip, step count, hover actions (Run / Edit)
- "Suggested for you" section below with compact template rows
- "+ Teach a new workflow" CTA at top

**Right column (fills remaining space):**
- **Empty state:** large centered description + CTA when nothing selected
- **Preview state:** when a workflow row is hovered or selected — name, description, step timeline (read-only), trust summary, "Run now" and "Edit" buttons
- Clicking "Edit" navigates to Studio with the workflow pre-loaded
- Clicking a template row navigates to Studio with description pre-filled

The list stays visible at all times. No modal. No backdrop.

---

### Page B — Workflow Studio (`/workflow-studio`)

Three-column full-page layout, directly modeled on Horizon.

#### Left column (280px): "Intent"

Always visible, always interactive. Contains:
- `← Back to library` link
- The description textarea the user typed (persists throughout generation)
- Template chips for quick-replace
- "Regenerate" link at the bottom

This column is the user's anchor — it answers "what did I ask for?" at any point in the flow, even during generation.

#### Center column (flex-1): "Plan"

**During generation:**
- Column header: "Generating plan…" with a subtle animated dot
- Step skeleton rows appear as LLM chunks arrive — each step card fades in and fills as the stream progresses
- User is not gated; left column remains interactive

**After generation (success):**
- Clean step timeline: numbered steps, human-readable labels, write-action amber badges
- Workflow name and description editable inline at the top
- Each step row has an "Edit this step" disclosure → expands raw action/args editor in-place
- Column header: step count chip

**After generation (failure):**
- Error card in center: "I couldn't turn that into a plan. Try adding more detail."
- "Try again" link restarts generation using the current left-column description
- Nothing is lost; left column is unchanged

**After "Try it in chat":**
- A status card appears at the top of the center column: "Running in chat — check the chat panel for output and approvals"
- Steps remain visible below so the user can review while the run happens

#### Right column (280px): "Status + Actions"

Modeled directly on Horizon's right panel:

- **Trust summary** — auto-derived sentence (reads from X, will ask before Y)
- **Progress tracker** — 3 milestones:
  1. Description written ✓
  2. Plan generated ✓
  3. Saved to library ✓
- **Primary action button** — state-adaptive:
  - Generating: `[···] Generating…` (disabled)
  - Plan ready: `Save workflow` (primary) + `Try it in chat` (secondary)
  - Saved: `View in library` (link)
- **"Try it in chat" behavior:** opens chat panel via `triggerAction` without navigating away from Studio. Right column status updates to "Running in chat…". Studio stays open for review and save.
- **Advanced section** (collapsible at bottom of right column) — internal name slug, raw JSON parameters, full step editor from `AdvancedWorkflowEditor`. Lives in the right column's scroll area so expanding it never pushes the plan out of view.

---

## 3. How generation and loading state work without trapping the user

**Principle:** async work is shown in a persistent panel, not behind a loading gate. (Same as Horizon's activity log.)

1. User fills description in left column → clicks "Generate plan"
2. Center column header immediately shows "Generating plan…" with animated dot
3. `api.streamChat` starts. As `assistant_chunk` events arrive, partial JSON is parsed and step cards appear incrementally — step 1 fills in, then step 2, etc.
4. Left column remains fully interactive throughout. If the user edits the description while generation runs, a "Regenerate with new description?" chip appears in the center column header when generation finishes.
5. Right column progress tracker: milestone 1 is already checked; milestone 2 checks as generation completes.
6. Stream ends → center column snaps from shimmer to full plan. "Save workflow" becomes enabled in the right column.
7. If stream errors → error card in center column, left column unchanged, nothing lost.

---

## 4. Alignment with Horizon Space

| Horizon pattern | Workflow Studio equivalent |
|---|---|
| Left column = list of briefs (persistent) | Left column = description intent (persistent) |
| Center column = active brief detail | Center column = streaming plan (editable) |
| Right column = agent status + actions | Right column = trust summary + progress + save |
| Activity log shows async work live | Center column streams steps as they arrive |
| "Start Prep Session" opens chat in same view | "Try it in chat" opens chat panel without leaving Studio |
| `ResizeHandle` on column dividers | Same `ResizeHandle` component reused |
| No modal — everything in page layout | No modal — Studio is a full routed page |
| Errors appear in activity log | Errors appear as a card in center column |
| User refines and reruns inline | User edits left column → clicks Regenerate |

---

## 5. Files to build

### New files
- `src/pages/WorkflowLibraryPage.tsx` — replaces `WorkflowsPage.tsx`; two-column, no modal
- `src/pages/WorkflowStudioPage.tsx` — three-column Studio page
- `src/components/workflows/PlanStream.tsx` — streaming plan renderer; handles `streamChat`, parses partial JSON, renders step skeletons → filled steps

### Files to delete
- `src/components/workflows/TeachWorkflowModal.tsx`
- `src/components/workflows/TeachStageDescribe.tsx`
- `src/components/workflows/TeachStageReview.tsx`
- `src/components/workflows/TeachStageResult.tsx`

### Files to keep (no changes)
- `src/components/workflows/WorkflowCard.tsx`
- `src/components/workflows/SuggestedTemplates.tsx`
- `src/components/workflows/TrustSummary.tsx`
- `src/components/workflows/AdvancedWorkflowEditor.tsx`
- All backend: `tool-composer.ts`, `dynamic-tool-registry.ts`, `dynamic-tool-bridge.ts`, API endpoints

### Files to update
- `src/App.tsx` — add `activeView === 'workflow-studio'` state; pass draft/description as props to Studio; remove modal-related `workflowHandoffDescription` state
- `src/components/AppRail.tsx` — "Workflows" nav item already renamed; no further changes needed

---

## 6. Routing model

`App.tsx` already manages `activeView` as a string state. Add:

```typescript
type ActiveView = ... | 'skills' | 'workflow-studio';

// State to carry context into the Studio
const [studioContext, setStudioContext] = useState<{
  initialDescription?: string;
  editingDraft?: DynamicToolItem;
} | null>(null);
```

Navigation:
- "Teach a new workflow" → `setStudioContext({ initialDescription: '' })` + `setActiveView('workflow-studio')`
- Template chip clicked → `setStudioContext({ initialDescription: template.description })` + `setActiveView('workflow-studio')`
- "Edit" on a workflow card → `setStudioContext({ editingDraft: workflow })` + `setActiveView('workflow-studio')`
- "← Back to library" in Studio → `setActiveView('skills')` + `setStudioContext(null)`
- "Save as workflow" from chat → `setStudioContext({ initialDescription: '...' })` + `setActiveView('workflow-studio')`

---

## 7. Streaming plan parsing

The LLM prompt asks for a JSON object. As chunks stream in, attempt incremental parsing:

```typescript
// In PlanStream.tsx
let accumulated = '';
await api.streamChat([{ role: 'user', content: prompt }], (event) => {
  if (event.type === 'assistant_chunk') {
    accumulated += event.chunk;
    // Try to extract completed steps from partial JSON
    const steps = parsePartialSteps(accumulated);
    setPartialSteps(steps);
  }
  if (event.type === 'assistant_complete') {
    // Parse final JSON, set full draft
    const plan = extractFullPlan(accumulated);
    onPlanReady(plan);
  }
});
```

`parsePartialSteps` uses a regex to find `{ "action":` objects that are closed (end with `}`), allowing each step to render as it completes even if the outer array is still open.

---

## 8. What not to do

- **Do not** use a modal for any part of this flow
- **Do not** simulate test results with a `setTimeout` — real test runs happen in the chat panel, and the Studio shows a "running in chat" status card
- **Do not** hide the description textarea once generation starts — it stays in the left column throughout
- **Do not** collect the full LLM response before rendering — stream steps incrementally
- **Do not** use a three-stage linear wizard — the Studio has persistent columns that all stay visible
