# Calendar Redesign — Implementation Spec

## Overview

Transform the CalendarPage from a Google Calendar replica into a weekly command center. The new design answers four questions in order: what matters this week, what needs preparation, where time is healthy or broken, and what is actually scheduled.

The raw grid still exists but becomes a secondary utility, not the primary identity of the page.

---

## Current State Audit

### Files to replace or extend

| File | Current role | Action |
|------|-------------|--------|
| `src/pages/CalendarPage.tsx` | Top-level page shell | Rewrite |
| `src/components/calendar/CalendarToolbar.tsx` | Day/Week/Month/Agenda switcher | Rewrite with new view model |
| `src/components/calendar/ScheduleInsights.tsx` | Single-row metric strip | Expand into interactive Insight Rail |
| `src/components/calendar/WeekView.tsx` | 7-equal-column time grid | Demote to secondary Grid view |
| `src/components/calendar/AgendaView.tsx` | Flat date-grouped list | Keep, adapt as Timeline building block |
| `src/components/calendar/EventDetailPanel.tsx` | Right-side event inspector | Keep, integrate into Agent Panel |
| `src/components/calendar/EventBlock.tsx` | Grid time block pill | Keep for Grid view; new EventCard for Timeline |
| `src/components/calendar/DayView.tsx` | Single-day time grid | Keep as Grid fallback |
| `src/components/calendar/MonthView.tsx` | Month grid | Keep as Grid fallback |
| `src/components/calendar/TimeGrid.tsx` | Grid scaffold | Keep for Grid view |
| `src/hooks/useCalendarPage.ts` | State and data | Extend with new view types |

### New files to create

```
src/components/calendar/
  InsightRail.tsx          — interactive metric bar
  WeekRhythm.tsx           — left column: 7 day-cards with density bands
  AgendaTimeline.tsx       — center column: semantic agenda with hierarchy
  AgentPanel.tsx           — right column: prep queue + context bundle + actions
  EventCard.tsx            — semantic card for Timeline (replaces EventBlock in this context)
  DayCard.tsx              — single card in WeekRhythm column
  DensityBar.tsx           — morning/midday/afternoon density viz inside DayCard
  AllDayStrip.tsx          — horizontal capsule strip for all-day events
  ClusterLabel.tsx         — contextual grouping label over dense runs
  TimeHealthBadge.tsx      — back-to-back / overload / focus badges
```

---

## Data Model

### CalendarView enum

Extend `useCalendarPage.ts` to add new view types:

```ts
export type CalendarView = 'timeline' | 'focus' | 'prep' | 'grid' | 'agenda';
```

- `timeline` — default. Semantic agenda + WeekRhythm + AgentPanel
- `focus` — filters to important/external/conflict events only
- `prep` — filters to events needing briefs
- `grid` — current WeekView (demoted)
- `agenda` — current AgendaView (flat list fallback)

Default changes from `'week'` to `'timeline'`. Update `loadStoredView` validation list accordingly.

### InsightFilter type

```ts
export type InsightFilter =
  | 'meeting-load'
  | 'back-to-back'
  | 'external'
  | 'needs-prep'
  | 'focus-protected'
  | 'conflicts'
  | null;
```

Add `insightFilter` and `setInsightFilter` to `CalendarPageState`.

### WeekInsights shape

Computed by `computeWeekInsights(events)` — pure function, no API calls:

```ts
interface WeekInsights {
  totalMeetingMinutes: number;
  eventCount: number;
  backToBackCount: number;        // pairs within 15 min
  externalCount: number;          // attendees outside primary domain
  needsPrepCount: number;         // no aiInsight / high importance
  focusMinutes: number;           // gaps >= 45 min between 9-18
  conflictCount: number;          // hard overlaps
}
```

### EventMeta shape (UI-layer annotation)

Derived per event during render, not persisted:

```ts
interface EventMeta {
  isExternal: boolean;
  isImportant: boolean;
  prepStatus: 'none' | 'suggested' | 'ready' | 'stale';
  eventType: 'external' | 'internal' | 'deadline' | 'focus' | 'tentative' | 'personal';
  isBackToBack: boolean;
  conflictsWith: string[];   // event ids
  timeUntilStart: number;    // ms, negative if past
}
```

### DayLoad shape (WeekRhythm cards)

```ts
interface DayLoad {
  date: Date;
  events: CalendarEventDetail[];
  morningLoad: number;    // 0-1, fraction of 08-12 window covered
  middayLoad: number;     // 12-14
  afternoonLoad: number;  // 14-18
  eveningLoad: number;    // 18-22
  isOverloaded: boolean;
  hasFocusBlock: boolean;
  hasExternalMeeting: boolean;
  hasImportantMeeting: boolean;
  eventCount: number;
}
```

---

## Architecture

### Page layout

```
CalendarPage
├── CalendarHeader          (sticky, new)
├── InsightRail             (interactive metric strip)
└── [view body]
    ├── timeline mode
    │   ├── WeekRhythm      (left, narrow)
    │   ├── AgendaTimeline  (center, dominant)
    │   └── AgentPanel      (right, sticky)
    ├── focus / prep modes
    │   └── same 3-col layout, filtered AgendaTimeline
    ├── grid mode
    │   └── WeekView / DayView / MonthView  (existing)
    └── agenda mode
        └── AgendaView  (existing)
```

### State ownership

`useCalendarPage.ts` owns: view, filter, insightFilter, currentDate, events, selectedEventId, loading, error, dateRange

`CalendarPage.tsx` computes: aiInsightsMap, weekInsights, selectedEvent, eventMetas, dayLoads

All computations are `useMemo` with stable deps. No new API endpoints required.

---

## Component Specifications

### CalendarHeader

Replaces CalendarToolbar. Same nav controls, new view mode set.

**Props:** same shape as CalendarToolbar + `insightFilter` context display

**View mode options:**

```
Timeline | Focus | Prep | Grid | Agenda
```

**Quick filter chips** (new, conditionally shown):

```
Important · External · Needs prep · Focus time · Conflicts
```

Each chip toggles `insightFilter`. When any filter is active, show "Clear" chip.

**Freshness indicator** — right-aligned, small, dim text:

```
Updated 5m ago
```

Derive from a `lastFetchedAt` timestamp stored in the hook.

---

### InsightRail

Replaces ScheduleInsights. Six metric cards in a horizontal strip.

**Metrics:**

| Key | Label | Value display | Filter effect |
|-----|-------|---------------|---------------|
| `meeting-load` | Meeting hours | e.g. 14h | Show scheduled view |
| `back-to-back` | Back to back | e.g. 4 runs | Highlight dense stretches |
| `external` | External | e.g. 3 meetings | Filter to external events |
| `needs-prep` | Needs prep | e.g. 2 meetings | Switch to Prep mode |
| `focus-protected` | Focus time | e.g. 6h free | Highlight focus gaps |
| `conflicts` | Conflicts | e.g. 1 overlap | Highlight conflict events |

**Visual:** horizontal scrollable strip on mobile; flex row with gap on desktop.

Each card:
- Large number (18–20px, medium weight)
- Small label below (11px, dim)
- Warning color when value is high/bad (back-to-back >= 3, conflicts > 0)
- Calm color for focus-protected metric
- Active state (slight accent border) when its filter is engaged

**Interaction:** click → `setInsightFilter(key)`. Click again → `setInsightFilter(null)`.

---

### WeekRhythm (left column)

Seven day cards Monday → Sunday in a vertical stack. Width: ~160–180px fixed.

**DayCard anatomy:**

```
Mon 14                     ← day + date, bold if today
[density bars]             ← morning / midday / afternoon bands
3 meetings · 1 external    ← summary line
[optional badges]          ← Overloaded · Focus · Prep needed
```

**DensityBar:** three horizontal bands, each a thin fill (6px height) with fill percentage colored:
- Low fill: neutral/dim
- High fill: warning color
- Overloaded: red/error color

**Interaction:** clicking a day updates `selectedDay` state in the page. The AgendaTimeline scrolls to that day and expands it.

**Selected day state:** accent left border or highlight background.

**Today:** accent label color, slightly elevated surface.

---

### AgendaTimeline (center column, dominant)

Structured agenda view. Groups events by day. Days have sections: Morning, Midday, Afternoon, Evening.

**Day header:**

```
Today — Monday, Apr 14              [overload badge if applicable]
Morning · 3 meetings · 2h 30m
```

Today and tomorrow are expanded by default. Later days are slightly compressed — their events are shown but with reduced padding and smaller type. Clicking a compressed day header expands it.

**EventCard anatomy (new component):**

```
9:00 AM  1h                                [External] [Brief ready]
Q2 Board Review
John Smith, Sarah Chen +3 more
[Prepare meeting]  [Join]
```

Card variants:

| Variant | Trigger | Visual treatment |
|---------|---------|-----------------|
| Critical | `isImportant === true` | Accent left border, heavier title weight |
| Prep ready | `prepStatus === 'ready'` | Purple accent badge, "Open prep" button visible |
| Routine internal | Internal, non-important | Neutral surface, compact |
| Tentative | `flexibilityState === 'tentative'` | Dashed border, lower opacity |
| Focus block | `eventType === 'focus'` | Calm low-contrast surface, no action buttons |
| Past | `end < now` | Muted opacity, no action buttons |

**Back-to-back cluster label:**

When 3+ events are within 15min of each other, render a ClusterLabel above them:

```
4 meetings back to back  ·  3h solid
```

Label style: small, warning-tinted text, no hard border.

**All-day strip:**

Above each day's time events, render a horizontal strip of capsule chips:

```
[Q2 Planning Deadline]  [Company Holiday]  +2
```

Chips are compact (10px text, 4px padding). Overflow collapses to `+N`.

**Interaction:**

- Clicking an event card selects it → updates AgentPanel
- Clicking "Prepare meeting" fires `onAskAI` with full context
- Clicking "Join" opens hangout link

**Empty state:**

```
No events scheduled
```

Centered, minimal, no illustration needed.

---

### AgentPanel (right column)

Width: ~280–320px fixed on desktop. Sticky within scroll container.

**Sections:**

#### 1. Next Up

Shows the single next upcoming event (or most important upcoming event if current event is in progress).

```
Coming up in 42 min
Q2 Board Review · 2:00 PM
[No brief yet]
[Prepare now →]
```

#### 2. Prep Queue

List of events needing preparation, in chronological order.

```
Prep Queue (2)
────────────────────────────
Customer Sync   Tomorrow 10am   [No brief]   [Prep →]
Design Review   Wed 2pm         [Brief ready]  [Open →]
```

Each item: title, time, prep badge, action button.

#### 3. Context Bundle (when event selected)

Shows for the selected event (from EventDetailPanel content, reorganized):

- **Meeting prep note** (from aiInsight.prep_note)
- **Linked docs** (from aiInsight.linked_docs)
- **Attendees** (condensed)
- **Join / Open in Calendar** links

This replaces EventDetailPanel as the primary event detail surface. EventDetailPanel can be removed or kept as a fallback.

#### 4. Agent Actions

Below context bundle:

```
[Prepare this meeting]
[Summarize last thread]
[Draft follow-up]
[Continue in chat →]
```

Buttons: full width, icon + label, secondary/tertiary style.

**Empty state (no event selected):**

Show Next Up section + Prep Queue + a brief explanation:

```
Select a meeting to see prep context
and take action with the agent.
```

---

## Filter Logic

### insightFilter effects on AgendaTimeline

| Filter | Effect |
|--------|--------|
| `meeting-load` | No filter, scroll to top |
| `back-to-back` | Add yellow highlight overlay to back-to-back clusters |
| `external` | Dim internal events, highlight external |
| `needs-prep` | Dim prepped events, accent unprepped |
| `focus-protected` | Show gap regions between events as colored focus blocks |
| `conflicts` | Accent conflicting events with error color |

Filters are visual overlays, not hard filters. All events remain visible unless focus/prep view mode is active.

### View mode filters (Focus, Prep)

- `focus` mode: hide routine internal events, show only important, external, conflicts
- `prep` mode: show only events with `prepStatus !== 'ready'` that are upcoming

---

## Hook Changes

### useCalendarPage.ts changes

1. Add `CalendarView` values: `'timeline' | 'focus' | 'prep' | 'grid' | 'agenda'`
2. Change default view from `'week'` to `'timeline'`
3. Update `computeDateRange` for timeline/focus/prep: same as week range (Mon–Sun of currentDate)
4. Add `insightFilter: InsightFilter` state + `setInsightFilter` action
5. Add `lastFetchedAt: Date | null` state
6. Add `selectedDay: Date | null` state + `setSelectedDay` action
7. Keep `goNext`/`goPrev` working for timeline: advance by 1 week

No new API calls needed. `computeDateRange('timeline', anchor)` returns same Mon–Sun window as `'week'`.

---

## CalendarPage.tsx rewrite

```tsx
export default function CalendarPage() {
  const cal = useCalendarPage();
  const { sendMessage } = useChatContext();
  const { briefing } = useBriefing();

  // Derived state (all useMemo)
  const aiInsightsMap = useMemo(...)
  const selectedEvent = useMemo(...)
  const weekInsights = useMemo(() => computeWeekInsights(cal.events), [cal.events])
  const dayLoads = useMemo(() => computeDayLoads(cal.events, cal.dateRange), [...])
  const eventMetas = useMemo(() => computeEventMetas(cal.events, aiInsightsMap), [...])

  const handleAskAI = useCallback(...)
  const rangeLabel = formatRangeLabel(...)

  const isGridView = cal.view === 'grid';
  const isAgendaView = cal.view === 'agenda';
  const isSemanticView = !isGridView && !isAgendaView;

  return (
    <div className="flex flex-col h-full">
      <CalendarHeader ... />
      <InsightRail insights={weekInsights} activeFilter={cal.insightFilter} onFilter={cal.setInsightFilter} />

      {isGridView && <GridViewBody ... />}
      {isAgendaView && <AgendaView ... />}
      {isSemanticView && (
        <div className="flex flex-1 min-h-0 gap-0">
          <WeekRhythm dayLoads={dayLoads} selectedDay={cal.selectedDay} onSelectDay={cal.setSelectedDay} />
          <AgendaTimeline
            events={cal.filteredEvents}
            eventMetas={eventMetas}
            insightFilter={cal.insightFilter}
            view={cal.view}
            selectedEventId={cal.selectedEventId}
            selectedDay={cal.selectedDay}
            onSelectEvent={cal.selectEvent}
            onAskAI={handleAskAI}
          />
          <AgentPanel
            selectedEvent={selectedEvent}
            aiInsight={selectedEvent ? aiInsightsMap.get(selectedEvent.id) : undefined}
            events={cal.events}
            eventMetas={eventMetas}
            onAskAI={handleAskAI}
            onSelectEvent={cal.selectEvent}
          />
        </div>
      )}
    </div>
  );
}
```

GridViewBody is a thin wrapper that decides between WeekView / DayView / MonthView based on a secondary `gridSubView` state (default: week).

---

## Pure Computation Functions

These are pure functions with no side effects, exported from a new `src/components/calendar/calendarUtils.ts` file.

### computeWeekInsights(events, aiInsightsMap)

Returns `WeekInsights`. Scans events, counts:
- Total meeting minutes (timed events only)
- Back to back pairs (gap <= 15 min)
- External meetings (attendees with different email domain than organizer)
- Events needing prep (no aiInsight entry, or prepStatus === 'none')
- Estimated focus minutes (gaps >= 45 min between 9am and 6pm on weekdays)
- Hard conflicts (overlapping start/end times)

### computeDayLoads(events, dateRange)

Returns `DayLoad[]`, one per day in the week range. Computes morning/midday/afternoon/evening load fractions.

### computeEventMetas(events, aiInsightsMap)

Returns `Map<string, EventMeta>`. Determines per-event classification, prep status, back-to-back state, and external status.

### detectBackToBackClusters(events)

Returns `Map<string, string[]>` — event id → list of event ids it is clustered with.

---

## Styling Guide

Extend existing CSS custom properties. No new tokens required. Use composition of existing vars.

### Event card variant classes

| Variant | Border | Background | Title color |
|---------|--------|-----------|-------------|
| Critical | `var(--accent)` left 3px | `var(--accent-dim)/20` | `var(--text)` bold |
| Prep ready | `var(--purple)` left 3px | `var(--purple-dim)/15` | `var(--text)` |
| Routine | `var(--border)` | `var(--surface1)` | `var(--text-dim)` |
| Tentative | dashed `var(--border)` | `var(--surface1)/50` | `var(--text-faint)` |
| Focus | `var(--surface3)` | `var(--surface1)` | `var(--text-faint)` |
| Past | any | any | `var(--text-faint)` opacity-50 |

### Density bar colors

| Load % | Color |
|--------|-------|
| 0–40% | `var(--border2)` |
| 40–70% | `var(--text-faint)` |
| 70–90% | `var(--warn)` |
| 90%+ | `var(--error)` |

### Insight rail metric states

| State | Treatment |
|-------|-----------|
| Normal | `var(--text)` number, `var(--text-faint)` label |
| Warning | `var(--warn)` number |
| Critical | `var(--error)` number |
| Active filter | `var(--accent-border)` 1px border around card |

---

## Responsive Behavior

| Breakpoint | Layout |
|-----------|--------|
| ≥ 1200px (desktop) | Full 3-column: WeekRhythm + AgendaTimeline + AgentPanel |
| 900–1200px (tablet landscape) | WeekRhythm hidden; AgendaTimeline + AgentPanel |
| 640–900px (tablet portrait) | AgendaTimeline full width; AgentPanel below as collapsible drawer |
| < 640px (mobile) | InsightRail → AgendaTimeline → AgentPanel stacked; WeekRhythm accessible via tab |

WeekRhythm hides at `lg:hidden` equivalent, not behind a drawer — it simply disappears and AgendaTimeline takes full width.

AgentPanel collapses to a bottom sheet on tablet/mobile, triggered by event selection.

---

## Motion Spec

All animations use Framer Motion (`motion` from the existing dependency).

| Interaction | Animation |
|-------------|-----------|
| Day selection in WeekRhythm | `layoutId` on selected border for smooth position transition |
| Event selection → AgentPanel update | `AnimatePresence` + `initial={{ opacity: 0, y: 8 }}` on panel sections |
| Compressed day expansion | `motion.div` with `animate={{ height: 'auto' }}` |
| Insight filter activation | `opacity` and `scale` on metric cards: active scales to 1.02 |
| View mode switch | `AnimatePresence` with `opacity` crossfade |

Keep durations short: 150–200ms for micro-interactions, 250ms for panel transitions.

---

## Accessibility

- All interactive elements have `aria-label` or visible text
- `InsightRail` metrics: `aria-pressed` on filter buttons
- `WeekRhythm` day cards: `role="button"`, `aria-label="Monday April 14, 3 meetings, overloaded"`
- `EventCard`: `role="button"`, announces time + title + prep status in label
- `AgentPanel` sections: `role="region"` with `aria-label`
- Focus ring: consistent `focus-visible:ring-2 ring-[var(--accent)]`
- `prefers-reduced-motion`: wrap all Framer Motion components with `useReducedMotion()` guard

---

## Implementation Order

### Phase 1 — Hook and data layer

1. Extend `useCalendarPage.ts`:
   - New `CalendarView` types
   - `insightFilter` state
   - `selectedDay` state
   - `lastFetchedAt` timestamp
   - Updated `computeDateRange` for timeline/focus/prep views

2. Create `src/components/calendar/calendarUtils.ts`:
   - `computeWeekInsights`
   - `computeDayLoads`
   - `computeEventMetas`
   - `detectBackToBackClusters`

### Phase 2 — InsightRail and CalendarHeader

3. Rewrite `CalendarToolbar.tsx` → `CalendarHeader.tsx`:
   - New view mode set (Timeline, Focus, Prep, Grid, Agenda)
   - Quick filter chips
   - Freshness indicator

4. Rewrite `ScheduleInsights.tsx` → `InsightRail.tsx`:
   - Six interactive metric cards
   - Active filter state
   - Warning/calm color encoding

### Phase 3 — Left column

5. Create `DensityBar.tsx`
6. Create `DayCard.tsx`
7. Create `WeekRhythm.tsx`

### Phase 4 — Center column

8. Create `AllDayStrip.tsx`
9. Create `ClusterLabel.tsx`
10. Create `TimeHealthBadge.tsx`
11. Create `EventCard.tsx` (semantic card, not grid block)
12. Create `AgendaTimeline.tsx`

### Phase 5 — Right column

13. Rewrite/extend `EventDetailPanel.tsx` → `AgentPanel.tsx`:
    - Next Up section
    - Prep Queue
    - Context Bundle (absorbs EventDetailPanel content)
    - Agent Actions

### Phase 6 — Page assembly

14. Rewrite `CalendarPage.tsx` with new 3-column layout

### Phase 7 — Polish

15. Add Framer Motion transitions
16. Responsive breakpoint tuning
17. Accessibility audit pass
18. Reduced motion guard

---

## What Not To Do

- Do not start by enhancing the existing WeekView grid
- Do not keep `'week'` as default view — change to `'timeline'`
- Do not add new API endpoints; all data comes from existing `/api/calendar/range`
- Do not rely on color alone to encode meaning — always pair with text/icon
- Do not compress meaning into tiny event pills in the Timeline view
- Do not make EventDetailPanel the primary selection surface — AgentPanel absorbs that role
- Do not build all-day events as a heavy row — use the AllDayStrip capsule approach

---

## Files Not Changed

- `src/components/calendar/TimeGrid.tsx` — kept for Grid view
- `src/components/calendar/DayView.tsx` — kept for Grid view
- `src/components/calendar/MonthView.tsx` — kept for Grid view
- `src/components/calendar/AgendaView.tsx` — kept for Agenda fallback view
- `src/hooks/useEventClassification.ts` — unchanged; still used for mine/team classification
- `src/services/api.ts` — no new endpoints needed
