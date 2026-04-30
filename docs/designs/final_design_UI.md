# FlowSpace IA & UI Redesign — Phase 1

## Context

FlowSpace today has three competing navigation systems (top tabs, left rail, right chat panel), four conflicting names for the same surfaces (Workspace/Tools, Automations/Workflows, Agent queue/Horizon, Flux Agent/FlowSpace), and the meeting-prep flow — the approved Phase 1 hero feature — is fragmented across Home (`AgentDraftsStrip`), a separate `agent-drafts` view (`HorizonView`), and the chat panel. The product story ("manual Scan next 48h → Draft Queue → Approve opens chat with brief") is invisible because no single screen owns it end-to-end.

Phase 1 goal: collapse to **one clear loop** — Home shows the Draft Queue as the dominant proactive surface, Approve opens chat with context, everything else recedes. This document specifies the IA, naming, layout, and shell rules to make that happen, plus a sequenced implementation plan.

---

## 1. Diagnosis (concrete problems, not generic)

Verified against the code:

| # | Problem | Evidence |
|---|---|---|
| 1 | **Two nav systems compete.** Top bar renders Home/Gmail/Calendar/Tasks tabs (`App.tsx:908-941`) while the left rail renders Home, New chat, Workspace, Automations, Agent queue, Recents, Settings (`AppRail.tsx:312-372`). Gmail/Calendar/Tasks appear in both. | App.tsx:908-941; AppRail.tsx:344-371 |
| 2 | **Workspace ≠ Tools.** Left rail label is "Workspace" (AppRail.tsx:346); page title is "Tools" (App.tsx:683); back button says "Back to Tools" (App.tsx:865); WorkspaceHub h2 says "Workspace" (App.tsx:110). | Three different strings, one screen. |
| 3 | **Agent queue ≠ Horizon.** Nav says "Agent queue" (AppRail.tsx:366); title says "Horizon" (App.tsx:689); component is `HorizonView` rendering meeting briefs — not abstract agents. | AppRail.tsx:366 vs App.tsx:689 |
| 4 | **Automations ≠ Workflows.** Nav: "Automations" (AppRail.tsx:359); page title: "Workflows" (App.tsx:684); file is `WorkflowLibraryPage.tsx`. | Three names. |
| 5 | **Meeting prep is split across 3 surfaces.** `AgentDraftsStrip` on Home (HomeDashboard.tsx:1011), full `HorizonView` on `agent-drafts` route (App.tsx:1067), and the chat panel after Approve (App.tsx:476). User must context-switch to do one job. |
| 6 | **Brand split.** `branding.ts:1` defines "Flux Agent"; the product is "FlowSpace". Two names for one assistant. |
| 7 | **Cowork Center is vague.** `RunCenter.tsx:168` is actually a workflow run-status tray, not a "center". |
| 8 | **Right rail is too wide and always-on.** Default 420px, max 700px (App.tsx:60-63), persists on every main view. On a 1440px screen with a 240px left rail it eats ~30% of horizontal space even when irrelevant (e.g. on Gmail where the page already has its own thread reader). |
| 9 | **Home overloads.** ContextHeader → CommandInput → SystemContextBand → AgentDraftsStrip → 4 stat cards → NextBestAction → AttentionPanel → YourDayPanel → InboxTriage → FollowupPanel (HomeDashboard.tsx:981-1241). Ten distinct blocks; no clear primary action. The Draft Queue (the Phase 1 hero) is buried as a horizontal strip between the context band and stat cards. |
| 10 | **No empty-state system.** 20+ ad-hoc strings ("No X", "Nothing X", "X yet"); no shared `EmptyState` component. CTA verbs (Approve / Run / Run now / Scan / Generate / Create / Start) vary by page. |
| 11 | **No page-shell system.** Each page rolls its own header, padding, and panel rules. |

---

## 2. Revised Sitemap

**Three top-level destinations. That's it.**

```
FlowSpace
├── Home                ← dashboard + Draft Queue (Phase 1 hero lives here)
├── Mail                ← Gmail workbench
├── Calendar            ← Calendar workbench
├── Tasks               ← Tasks workbench
└── Workflows           ← launcher for saved multi-step automations
   └── (Drive lives inside Workflows as a tool, not a top-level nav item)

Global (not in nav):
├── Chat                ← right rail, contextual; not a page
├── Run status          ← topbar popover (formerly "Cowork Center")
├── Settings            ← rail footer
└── Recents             ← rail history section (chat threads)
```

**Removed / merged:**
- ❌ "Workspace" / "Tools" page → **deleted**. It was a launcher hub for Gmail/Calendar/Tasks/Drive that already exist in nav. Drive moves under Workflows.
- ❌ "Agent queue" / "Horizon" as a separate page → **absorbed into Home** as the Draft Queue panel.
- ❌ Top-bar tabs (Home/Gmail/Calendar/Tasks) → **deleted**. Left rail is the only nav.
- ❌ "New chat" rail item → **moved** to a button in the right-rail chat header (it's a chat action, not a destination).

---

## 3. Final Recommended Names

| Today | Tomorrow | Why |
|---|---|---|
| Home / Dashboard | **Home** | Keep. |
| Workspace / Tools | _(deleted)_ | Redundant launcher. |
| Gmail | **Mail** | Match Apple/iOS convention; product-agnostic. |
| Calendar | **Calendar** | Keep. |
| Tasks | **Tasks** | Keep. |
| Automations / Workflows | **Workflows** | Pick one. "Workflows" matches the file name and is more accurate (multi-step, user-defined). |
| Agent queue / Horizon | **Draft Queue** (panel on Home) + **Briefs** (full archive view, optional Phase 2) | "Draft Queue" matches the product brief language. "Agent queue" is engineer-speak; "Horizon" is poetic and meaningless to users. |
| Flux Agent | **FlowSpace Assistant** (or just "Assistant" in UI) | One brand. The chat surface is "Assistant"; the product is "FlowSpace". Delete "Flux". |
| Cowork Center | **Run Status** | It's a status tray. Name it that. |
| "Scan next 48h" | **Scan next 48 hours** | Keep, just spell it out. Primary CTA on Home. |
| Approve | **Approve & open in chat** (full label) / **Approve** (compact) | Set expectation: this is not "execute". |
| Discuss | **Open in chat** | "Discuss" is vague. |
| Dismiss | **Dismiss** | Keep. |

---

## 4. Per-Page Layout Recommendations

### 4.1 Home — the Phase 1 hero page

**Goal:** one primary action ("Scan next 48 hours"), one primary proactive panel (Draft Queue), supporting context below.

```
┌─────────────────────────────────────────────────────────────┐
│  Good morning, Mohamed.                          [refresh]  │  ← ContextHeader, slimmed
│  Saturday, April 11 · 3 meetings today · 12 unread          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Draft Queue                       [Scan next 48 hrs] │  │  ← THE hero panel
│  │  ─────────────────────────────────────────────────────│  │     full width
│  │                                                        │  │     replaces strip
│  │  [DraftCard] [DraftCard] [DraftCard]                  │  │
│  │                                                        │  │
│  │  3 briefs ready · last scan 12 min ago                │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │  Today              │  │  Needs attention             │  │  ← 2-col supporting
│  │  (YourDayPanel)     │  │  (AttentionPanel)            │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │  Inbox triage       │  │  Follow-ups                  │  │
│  │  (InboxTriage)      │  │  (FollowupPanel)             │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Concrete deletions on Home:**
- ❌ `CommandInput` hero (HomeDashboard.tsx:981) — chat lives in the right rail, not on Home.
- ❌ `SystemContextBand` (HomeDashboard.tsx:1001) — fold its contents into the slimmed ContextHeader subtitle.
- ❌ 4 `Signal Cards` row (HomeDashboard.tsx:1024) — replace with one inline subtitle line.
- ❌ `NextBestAction` row (HomeDashboard.tsx:1068) — its job is now done by the Draft Queue.
- ❌ `AgentDraftsStrip` (HomeDashboard.tsx:1011) — promoted to the full `DraftQueue` panel.

**Promote:** `DraftQueue` (already exists at `src/components/DraftQueue.tsx`) becomes the second block on Home, full width, with **all six states** it already supports (FIRST_RUN, SCANNING, POPULATED, ALL_ACTIONED, EMPTY, ERROR — DraftQueue.tsx:427-522). Reuse as-is.

### 4.2 Mail (formerly Gmail) — workbench

Single-pane, no shell duplication. Page header = "Mail". Right rail collapsed by default (see §5).

### 4.3 Calendar / Tasks — workbench

Same shell. Page header = name. Right rail collapsed by default.

### 4.4 Workflows — launcher

Reuse `WorkflowLibraryPage.tsx` as-is. Header = "Workflows". Drive lives here as a Workflow tile (one-shot tool), not as a separate route.

### 4.5 Briefs (Phase 2, optional) — archive

If users want to see past approved/dismissed briefs, add a "Briefs" link **inside the Draft Queue panel header** ("View all"), not as a top-level rail item. Defer until users ask for it.

---

## 5. Right-Rail (Assistant) Behavior Rules

Three modes, one rule per page:

| Page | Default state | Rationale |
|---|---|---|
| **Home** | **Closed** | Home is for proactive triage, not chat. Open via FAB or after Approve. |
| **Mail** | **Closed** | Page already has its own thread reader; chat would compete. Open contextually when user clicks "Ask about this thread". |
| **Calendar** | **Closed** | Same — page is the workbench. |
| **Tasks** | **Closed** | Same. |
| **Workflows** | **Closed** | Same. |
| **After Approve** | **Auto-open at default 420px** | This is the primary deep-work surface for the brief. Already wired (App.tsx:476). |
| **Mobile (<lg)** | **FAB only**, full-screen overlay when opened | Already implemented (App.tsx:1222-1248). Keep. |

**Width rules:**
- Default width: **400px** (down from 420 — leaves more room for Mail/Calendar columns).
- Min: 320px. Max: 560px (down from 700 — 700 was eating half the screen).
- Persist per-user via localStorage (already done at `CHAT_WIDTH_KEY`, App.tsx:60).

**Open triggers:**
1. User clicks Assistant FAB / toggle in topbar.
2. User clicks **Approve** on a draft → auto-open with brief context (existing behavior — keep).
3. User clicks **Open in chat** (formerly "Discuss") on a draft → auto-open with draft context.
4. User clicks "Ask about this" on a Mail thread, Calendar event, or Task → auto-open with item context.

**Never:** persist open across navigations except when the user explicitly opened it on this page.

---

## 6. Shell System (one shell per page kind)

Three page kinds. Pick one per route.

### 6.1 `<DashboardShell>` — Home only
- Slim ContextHeader (greeting + one-line subtitle).
- Vertically stacked panels.
- No tabs, no top-bar nav.

### 6.2 `<WorkbenchShell>` — Mail, Calendar, Tasks
- Page header: title + page-level actions (Compose, New event, New task) on the right.
- Single content area; page owns its own internal columns.
- Right rail closed by default.

### 6.3 `<LauncherShell>` — Workflows
- Page header: title + "New workflow" CTA.
- Two-pane (list + preview) — already exists in `WorkflowLibraryPage`.

**All three share:** the left `AppRail`, the topbar (slimmed — see below), and the right Assistant rail (per §5 rules).

**Topbar after redesign** — strip everything except:
- Left: page title + status dot (auth/connection).
- Right: Run Status popover, Refresh, Account menu, Assistant toggle.
- **Delete:** Workspace tabs (App.tsx:908-941), section divider, ProviderSwitcher (move to Settings).

---

## 7. Empty-State & Status System

Create one shared component, replace 20+ ad-hoc strings.

### `<EmptyState>` props
```ts
{ icon, title, description, primaryAction?, secondaryAction? }
```

### Five canonical states (apply everywhere)
| State | Visual | Title pattern | Action |
|---|---|---|---|
| `first-run` | Soft illustration | "Get started with X" | Primary CTA |
| `loading` | Skeleton shapes matching content geometry | _(no text)_ | _(none)_ |
| `empty` | Muted icon | "No X yet" | Optional CTA |
| `all-done` | Checkmark | "All caught up" | _(none)_ |
| `error` | Warning icon | "Couldn't load X" | "Retry" |

The Draft Queue already implements all five states (DraftQueue.tsx:427-522). **Use it as the reference implementation** when building `<EmptyState>`.

### CTA verb hierarchy (standardize)
- **Primary action that creates/triggers:** `Scan`, `Create`, `Compose`, `New`
- **Approval gate:** `Approve` (always means "open in chat with context", never "execute")
- **Open detail:** `Open in chat`, `View brief`, `View all`
- **Destructive:** `Dismiss`, `Delete`

Delete: "Run", "Run now", "Generate", "Start" — replace per the table above.

---

## 8. Duplications to Remove

| Duplication | Resolution |
|---|---|
| Top-bar tabs vs left rail (Home/Gmail/Cal/Tasks) | Delete top-bar tabs (App.tsx:908-941). |
| Workspace hub vs left-rail nav (both link to Gmail/Cal/Tasks/Drive) | Delete WorkspaceHub view + 'workspace' activeView (App.tsx:1036, ChatContext.tsx:39). |
| `AgentDraftsStrip` (Home) vs `HorizonView` (page) | Delete both. Use full `DraftQueue` panel on Home only. Delete 'agent-drafts' activeView. |
| `SkillsPage.tsx` (legacy) vs `WorkflowsPage.tsx` | Delete `SkillsPage.tsx`. |
| "Flux Agent" branding vs "FlowSpace" | Delete `branding.ts` Flux references; use "Assistant" everywhere. |
| Three labels for the meeting-prep feature (Agent queue, Horizon, Drafts) | One label: **Draft Queue**. |

---

## 9. Critical Files to Modify

| File | Change |
|---|---|
| `src/components/AppRail.tsx:312-372` | Remove "New chat" and "Workspace" entries; rename "Automations"→"Workflows", "Agent queue"→remove (absorbed into Home); reorder: Home, Mail, Calendar, Tasks, Workflows, then divider, Recents, Settings. |
| `src/App.tsx:859-1021` | Strip topbar to: title + status + Run Status + Refresh + Account + Assistant toggle. Delete workspace tabs block. |
| `src/App.tsx:1025-1109` | Remove `workspace`, `agent-drafts`, and (legacy) `skills` views from the activeView switch. |
| `src/App.tsx:683-689` | Update `viewTitle` to match nav labels exactly. |
| `src/context/ChatContext.tsx:39` | Trim activeView union: `'home' \| 'mail' \| 'calendar' \| 'tasks' \| 'workflows' \| 'settings'`. Drop `chat`, `dashboard`, `workspace`, `gmail`, `drive`, `skills`, `agent-drafts`. |
| `src/components/HomeDashboard.tsx:981-1241` | Delete CommandInput, SystemContextBand, AgentDraftsStrip, signal cards, NextBestAction. Insert full `<DraftQueue>` as second block. |
| `src/components/DraftQueue.tsx` | Reuse as-is. Already has all six states. |
| `src/components/HorizonView.tsx` | **Delete** (1245 lines removed). |
| `src/pages/SkillsPage.tsx` | **Delete** (legacy). |
| `src/lib/branding.ts:1` | Replace "Flux Agent" → "FlowSpace Assistant". Grep & replace all `Flux` references. |
| `src/components/RunCenter.tsx:168` | Rename component label "Cowork Center" → "Run Status". |
| `src/components/EmptyState.tsx` | **New file.** Single shared component per §7. |
| `src/components/shells/{DashboardShell,WorkbenchShell,LauncherShell}.tsx` | **New files.** Per §6. |
| `src/pages/GmailPage.tsx` | Wrap in `<WorkbenchShell title="Mail">`. |
| `src/pages/CalendarPage.tsx` | Wrap in `<WorkbenchShell title="Calendar">`. |
| `src/pages/TasksPage.tsx` | Wrap in `<WorkbenchShell title="Tasks">`. |
| `src/pages/WorkflowLibraryPage.tsx` | Wrap in `<LauncherShell title="Workflows">`. |

---

## 10. Prioritized Implementation Plan

**Phase A — IA & naming (1–2 days, no design risk).** Pure rename + delete. Ships the structural story immediately.
1. Trim `activeView` union and route switch (ChatContext.tsx, App.tsx).
2. Rename rail items; remove "New chat" and "Workspace"; reorder (AppRail.tsx).
3. Delete `HorizonView.tsx`, `SkillsPage.tsx`, WorkspaceHub view.
4. Strip topbar tabs and divider.
5. Global rename: Flux Agent → FlowSpace Assistant; Cowork Center → Run Status; Automations → Workflows; Agent queue → Draft Queue.
6. Update viewTitle map (App.tsx:683-689) so titles match rail exactly.

**Phase B — Home redesign (2–3 days, the hero work).**
1. Slim `ContextHeader`: greeting + one subtitle line.
2. Delete CommandInput, SystemContextBand, AgentDraftsStrip, signal cards, NextBestAction from `HomeDashboard.tsx`.
3. Mount `<DraftQueue>` as the full-width second block. Verify all six states render.
4. Lay out the four supporting panels in a 2×2 grid (Today, Attention, Inbox, Follow-ups).
5. Manually QA the Approve → chat-opens flow end-to-end.

**Phase C — Shell + right-rail behavior (2 days).**
1. Build `<DashboardShell>`, `<WorkbenchShell>`, `<LauncherShell>`.
2. Wrap Home, Mail, Calendar, Tasks, Workflows.
3. Implement the per-page right-rail default-state rule (§5). Reset `chatPanelOpen` on navigation unless the page is "after-Approve".
4. Lower right-rail max width to 560px; default to 400px.

**Phase D — Empty state & CTA standardization (1–2 days).**
1. Build `<EmptyState>` per §7.
2. Replace the 20+ ad-hoc empty messages (file list in audit).
3. Sweep CTAs to the standardized verb set.

**Phase E — Polish (1 day).**
1. Visual QA at 1280, 1440, 1920 widths.
2. Verify Draft Queue states with mocked data.
3. Update `CLAUDE.md` IA section to match the new sitemap.

Total: ~7–10 days of focused work.

---

## 11. Verification

End-to-end manual test after Phase B:

1. `make dev`. Open `http://localhost:3000`.
2. Sign in. Land on **Home**. Verify: slim header, Draft Queue is the dominant block, no CommandInput, no signal cards.
3. Click **Scan next 48 hours**. Verify scanning state → populated state.
4. Click **Approve** on a brief. Verify: right rail auto-opens at 400px with brief context seeded into chat.
5. Navigate to **Mail**. Verify: right rail closes (per §5 rule). Page header says "Mail".
6. Navigate to **Calendar**, **Tasks**, **Workflows**. Verify each says its name in topbar and rail; no top-bar tabs; right rail closed.
7. Verify "Flux Agent" appears nowhere (`grep -ri flux src/`).
8. Verify "Cowork Center" appears nowhere.
9. Verify "Workspace" / "Tools" / "Horizon" / "Agent queue" appear nowhere as page or nav labels.
10. Run `make typecheck` — must pass.
11. Run `npm test` — must pass.
12. Visual sweep at 1280px and 1920px — Home Draft Queue must be the visual focal point at both widths.

---

## 12. Open Questions for Product

1. **Mail vs Gmail naming.** "Mail" is cleaner but loses the Google brand affinity. Stick with "Gmail" if users expect to see the source product. _Recommendation: Mail._
2. **Briefs archive page.** Do users need to see past approved/dismissed briefs? If yes, add a Phase 2 "Briefs" page reachable from the Draft Queue header ("View all"). _Recommendation: defer until requested._
3. **Drive.** Currently a placeholder ("coming soon", App.tsx:1055). Keep as a future Workflow tile, or restore as a top-level destination once it ships? _Recommendation: Workflow tile._
4. **Recents (chat history).** Keep in the rail expanded section, or move into a chat-pane drawer? Rail history is useful but adds visual weight. _Recommendation: keep in rail, collapsed by default._
5. **Run Status placement.** Topbar popover or rail item? _Recommendation: topbar popover — it's transient status, not a destination._
6. **Should "Approve" require a confirmation modal?** Today it's one click. The label "Approve" sets the expectation of a gate; a one-click action may surprise users. _Recommendation: keep one-click but show a 3-second undo toast._
7. **Provider switcher** (currently in topbar). Move to Settings or keep as a power-user shortcut? _Recommendation: Settings._
