# FlowSpace Product Redesign Plan

## Overview

FlowSpace should not evolve into another Gmail app. It should become a work execution layer on top of Google Workspace.

The main product shift is simple:
- Gmail stores and transports communication
- FlowSpace helps the user prepare, decide, reply, follow up, and complete work

This direction matches the current FlowSpace trajectory. The product today is still mostly reactive, while the near term approved move is to add a proactive Draft Queue that sits above the dashboard and opens chat with context rather than executing autonomously. The planning direction is also clear that distribution and habit formation come first, while memory becomes the long term moat later.

---

## 1. Product Direction

### Core Product Thesis

FlowSpace should be designed as a work execution layer on top of Google Workspace.

That means:
- Gmail is the archive and transport layer
- FlowSpace is the execution layer

Users should open FlowSpace when they want to finish work, not when they want to browse inboxes.

### Product Promise

When users open FlowSpace, they should immediately understand:
- what needs attention now
- what can be finished quickly
- what they are waiting on
- what they should prepare for next

### Primary User

The primary user is the busy founder, executive, senior IC, or operator with too many commitments and no human chief of staff. The real pain is missed follow ups, cold meetings, dropped threads, and forgotten commitments.

### Non Goals

- Do not build full Gmail parity
- Do not optimize for mailbox management as the core experience
- Do not make Inbox, Saved, or AI Triage the primary navigation model
- Do not design the product around passive reading

---

## 2. Strategic Principles

### Principle 1. Stop Organizing Email and Start Orchestrating Work

The current Gmail like surface still anchors the product in mailbox behavior. That weakens the product because it makes the app feel like a prettier inbox instead of a higher value work surface.

### Principle 2. Proactive Surfaces Should Lead

The approved Draft Queue direction should become the flagship behavior in Phase 1 because it creates day one value without requiring the memory loop first.

### Principle 3. Meeting Prep Is the First Habit

Meeting prep is the correct wedge because it is independently valuable, already paid for in the market, and useful even before memory compounds.

### Principle 4. Memory Follows Usage

Memory should remain secondary until the product proves people actually use the Draft Queue. The plan is explicit that Phase 2 should be gated on Phase 1 validation.

---

## 3. Product Goals

### Primary Goals

- Make FlowSpace the place users open before important work
- Create a repeatable prep habit around upcoming meetings
- Reduce time spent scanning Gmail, Drive, and Calendar manually
- Move users from incoming information to a clear next step faster

### Secondary Goals

- Build trust in the proactive layer
- Teach users that FlowSpace is for execution, not browsing
- Create a natural bridge from proactive prep into contextual chat

### Success Criteria

- Users understand the product through work states rather than mailbox states
- The proactive prep flow becomes a repeated behavior
- The transition from prep to action feels natural and structured
- Users rely less on raw Gmail for work preparation

---

## 4. Information Architecture

The current frontend still centers on a reactive dashboard with panels such as briefing, attention, inbox triage, followups, and raw Gmail or Calendar views.

The redesign should replace that mental model with a work state model.

### Proposed Top Level Navigation

**Work** — Default landing view. Shows what needs action now.

**Prepare** — Meeting prep, upcoming context packs, important pre reads, suggested talking points.

**Waiting** — Threads and commitments where the next move belongs to someone else.

**Memory** — Saved people, projects, important threads, reusable context, learned preferences.

**Chat** — Execution workspace with structured context, not a blank assistant surface.

**Workspace** — Raw Gmail, Calendar, Drive, and Tasks access when needed.

### Navigation Rules

- Work should be the default destination
- Prepare should be the flagship proactive surface
- Workspace should be clearly secondary
- Mailbox language should be minimized in primary navigation

---

## 5. Screen by Screen Redesign Plan

### Screen 1. Work

**Purpose.** Make this the default home screen.

**User Question Answered.** What matters right now, what can I finish quickly, and what am I waiting on?

**Structure.**

Top Summary Row:
- Needs action now
- Quick wins
- Waiting on others
- Upcoming prep

Main Content — Left column:
- Needs action now
- Quick wins

Main Content — Right column:
- Upcoming prep
- Waiting on others

Bottom area:
- Recent completions
- Recently saved memory
- Recent decisions

**Card Format.** Each card should show:
- title
- why this surfaced
- recommended next action
- estimated effort
- source chips such as Gmail, Calendar, Drive

**Example Card.**

> AMD Careers replied
> Recommended next action: send a short acknowledgment
> Why now: external reply received today
> Effort: 1 minute

**Design Intent.** This screen should shift the experience from reading content to finishing work.

---

### Screen 2. Prepare

This should be the flagship surface for the first release because it aligns directly with the approved Draft Queue direction. The current implementation plan already specifies scan, cards, useful toggle, dismiss, and approve to chat. It also specifies that the panel should sit above AttentionPanel and include seven interaction states.

**Purpose.** Build a daily or repeated habit around proactive meeting prep.

**Structure.**

Header:
- Prepare for next 48 hours
- Scan now
- Last scan time
- Small helper text explaining what is included

Main Queue: chronological list of meeting prep cards

Footer or Metadata Bar:
- meetings found
- meetings prepped
- errors or partial results
- optional scan duration

**Card Structure.** The existing card hierarchy is already strong:
- meeting time
- meeting title
- attendees
- brief preview
- context badges
- action row

Refine the action row labels to feel more natural:
- Open prep
- Ask a question
- Mark not useful

Internally, `Open prep` can still hit the approve endpoint, but the product language should stay user centered.

**Expanded Card State.** When opened, each prep card should show four blocks:
- What this meeting is about
- What changed recently
- What you may need to decide
- Suggested talking points

**Interaction States.** Use the seven states already defined in the reviewed plan:
- First run
- Scanning
- Populated
- Empty
- Partial
- Error
- All actioned

**Success Behavior.** Opening a prep should transition into a contextual work surface, not just display a passive summary.

---

### Screen 3. Execution Workspace

The current bridge is approve to chat with the brief loaded as `threadBrief` through `ChatContext.triggerAction()`. That is technically correct, but the product surface should feel more like a decision workspace than a generic chat panel.

**Purpose.** Turn context into action.

**Layout.**

Left Rail:
- brief
- relevant files
- related emails
- suggested actions

Center:
- primary execution area
- drafting
- question answering
- task extraction
- decision support

Right Rail:
- people
- dates
- memory hits
- commitments
- meeting facts

**Above the Composer.** Always show:
- title
- one sentence summary
- recommended next action

**Action Buttons.**
- Draft reply
- Summarize thread
- Extract tasks
- Schedule follow up
- Save to memory
- Mark waiting

**Product Rule.** No blank state after opening a prep. The workspace must always lead with a recommendation.

---

### Screen 4. Waiting

**Purpose.** Make open loops visible without forcing users back into Gmail.

**Included Items.**
- waiting on reply
- delegated tasks
- pending approvals
- follow ups due soon
- threads where the user has already acted

**Card Design.** Each card should show:
- what is pending
- who owns next move
- last activity
- recommended follow up timing

**Actions.**
- Draft follow up
- Remind me
- Snooze
- Archive

**Why It Matters.** This is where FlowSpace starts feeling like a chief of staff instead of a triage tool.

---

### Screen 5. Memory

The plans already state that memory is the long term moat, but not the first wedge. This screen should exist early for transparency, but it should not dominate the first release.

**Purpose.** Show what the system knows and why.

**Sections.**
- People
- Projects
- Important threads
- Preferences
- Reusable docs
- Recent decisions

**Entry Design.** Each memory item should explain:
- what it is
- why it is saved
- where it came from
- how often it is used

**Product Benefit.** This gives the user trust and control before deeper learning starts.

---

### Screen 6. Workspace

**Purpose.** Preserve access to raw sources without making them the product center.

**Tabs.**
- Gmail
- Calendar
- Drive
- Tasks

**Design Rule.** These views should feel secondary and utility based. They should not compete visually with Work or Prepare.

---

## 6. Gmail Specific Redesign Plan

The current Gmail page still looks like a mailbox clone. The left list, reader pane, tabs like Inbox and Saved, and chip heavy triage language all reinforce that feeling.

### What Should Change

**Change the Page Purpose.** Do not make the Gmail screen the first class destination.

**Reframe the Gmail Surface.** Instead of showing mailboxes first, show action buckets:
- Needs reply
- Can archive
- Waiting on others
- Important reference

**Change Each Row.** Today, a row mostly communicates sender, subject, snippet, and time.

Instead, a FlowSpace row should communicate:
- what this is
- why it matters
- recommended action
- estimated effort

**Example.**

> Payment confirmation
> Suggested action: archive
> Why: informational only, no follow up needed
> Effort: none

**Saved Redesign.** Saved should not be a passive bucket. It should become a useful reference layer:
- Important people
- Important threads
- Opportunities
- Admin items
- Reference docs

> **Note.** A detailed, code-grounded Gmail tab enhancement plan lives in `docs/designs/gmail-tab-enhancement.md`. It specifies concrete component-level changes that reuse the intelligence already in FlowSpace (`InboxTriage`, `AttentionPanel`, `FollowupPanel`, agent tools) without rebuilding Gmail.

---

## 7. Interaction Model

### Current Approved Bridge

The approved Phase 1 flow is:

1. user scans
2. drafts appear
3. user approves
4. chat opens with context

### Recommended Product Language Shift

Replace:
- Ask agent about your inbox
- AI Sort
- Categorize by project

With:
- Show what needs action
- Prep my next meetings
- Find quick wins
- What am I waiting on

This shift makes the product feel natural and task oriented instead of tool oriented.

### Desired Agent Behavior

The agent should feel ambient and supervisory, not something the user must summon manually each time.

The product should do the first pass. The user should review, edit, and continue.

---

## 8. Phase Based Implementation Plan

### Phase 0. Product Framing and Navigation Cleanup

**Objective.** Change the language and framing before deeper feature expansion.

**Work.**
- Rename top level navigation to Work, Prepare, Waiting, Memory, Chat, Workspace
- Remove Inbox and AI Triage from primary top navigation
- Move raw Gmail access under Workspace
- Rewrite labels to task language

**Deliverables.**
- updated navigation schema
- new screen titles
- new CTA language
- routing plan

**Success Criteria.** A new user should understand the app in terms of work states, not mailbox states.

---

### Phase 1. Make Prepare the Flagship Surface

This maps closely to the reviewed implementation plan. The reviewed plan already specifies manual scan, in process scanner, server routes, Draft Queue component, and approve to chat behavior.

**Objective.** Ship the first proactive habit.

**Product Work.**
- Promote Draft Queue to main hero area
- Rename it in the UI to Prepare
- Refine card copy and CTA language
- Improve expanded card content to show decisions and talking points
- Add a visible success loop such as weekly prep count

**Design Work.**
- final card layout
- expanded card interaction
- empty and error states
- metadata bar
- animation and focus transitions

**Engineering Work.** Keep the approved server side model:
- `POST /api/drafts/scan`
- `GET /api/drafts`
- `POST /api/drafts/:id/approve`
- `POST /api/drafts/:id/dismiss`
- `PATCH /api/drafts/:id/useful`

**Acceptance Criteria.**
- user can scan next 48 hours
- qualifying meetings appear as cards
- opening a prep launches chat with context
- marking not useful is recorded
- drafts purge cleanly
- partial failures are visible without breaking the flow

**Product Metrics.**
- Draft Queue open rate
- number of scans
- open prep rate
- useful toggle rate
- day 2 return rate

---

### Phase 1.5. Turn Work Into the Default Home

**Objective.** Make the product destination about work, not email.

**Product Work.** Introduce Work home screen with four sections:
- Needs action now
- Quick wins
- Upcoming prep
- Waiting on others

**Design Work.**
- card taxonomy
- effort estimates
- why surfaced explanation
- priority rules

**Engineering Work.** Aggregate signals from existing surfaces:
- Briefing
- Attention
- Followups
- Draft Queue
- Inbox triage

The current dashboard already has most of these ingredients in separate panels. The redesign is mainly composition and prioritization, not brand new data plumbing.

**Acceptance Criteria.** The home screen should answer the user's main question in under five seconds: what should I do now?

---

### Phase 2. Add Waiting and Memory as Strong Product Surfaces

**Objective.** Turn FlowSpace into a real commitment system.

**Product Work.**
- launch Waiting as a first class screen
- expose Memory as a transparent system surface
- make saved information explainable and useful

**Design Work.**
- waiting state taxonomy
- memory entry design
- memory provenance and control UI

**Engineering Work.** This should align with the broader memory direction already documented in the memory plans, but only after Phase 1 shows clear usage signals.

**Acceptance Criteria.**
- users can track open loops without using raw inboxes
- users can inspect what the system remembers and why
- memory is helpful without feeling intrusive

---

### Phase 3. Reduce Gmail to a Utility Layer

**Objective.** Keep Gmail accessible, but stop making it the center of the product.

**Product Work.**
- move Gmail under Workspace
- redesign email rows around recommended action
- keep raw thread view available when needed
- shift Saved into reference and memory roles

**Acceptance Criteria.** Users still have confidence that nothing is hidden, but prefer Work and Prepare for daily use.

---

## 9. Design System Guidance

**Tone.** Calm, confident, and structured.

**UI Principles.**
- less tab chrome
- fewer chips
- more clear work queues
- stronger explanations of why something surfaced
- visible next actions everywhere

**Core Rules.**
- every surfaced item should have a recommended next step
- every proactive suggestion should be inspectable and reversible
- every state should feel lighter than an inbox

---

## 10. Research and Validation Plan

**Questions to Validate.**
- Do users understand the product more clearly under work based navigation?
- Do users return for Prepare without reminders?
- Does contextual chat feel like execution rather than generic AI?
- Do users rely less on Gmail for meeting prep after using FlowSpace?

**Methods.**
- clickable prototype review
- task based usability sessions
- compare current Gmail first layout against Work first layout
- observe whether users naturally open Prepare before meetings

**Key Signals.**
- prep usage frequency
- repeat usage within one week
- open prep to chat conversion
- number of completed actions from FlowSpace

---

## 11. Final Recommendation

If only one structural change happens, it should be this:

**Replace Gmail as the destination with Work as the destination.**

That single decision will force the rest of the product to become more natural.

- Prepare becomes the first proactive habit.
- Chat becomes the execution workspace.
- Gmail becomes a source layer, not the core experience.

That is the most credible path to making users prefer FlowSpace over Gmail for getting work done.

---

## 12. Open Questions (review notes)

Captured during plan review so future sessions can pick these up rather than rediscover them.

1. **Work vs Prepare distinction.** Both screens answer variants of "what should I do now?" If Prepare is meeting-driven and Work is everything else, that needs to be stated clearly in the IA. Proposed split: **Prepare = future-facing** (next 48h meetings I haven't prepped), **Work = present-facing** (things already landed that I haven't resolved). Confirm and document.

2. **Waiting backend prerequisite.** No single source of truth exists today for "commitments you're waiting on." `FollowupPanel` covers part of it. The Waiting screen needs a real backend (extend `.followup-state.json` or add `.commitments.json`) before it can launch. Flag as a prerequisite for Phase 2, not a design decision.

3. **Memory page scope creep.** Six sections (People, Projects, Threads, Preferences, Docs, Decisions) is a lot for a screen the plan calls secondary. Proposed Phase 1 Memory = single list ("what FlowSpace has learned, why, when"). Six-section IA becomes a Phase 2+ milestone.

4. **Phase 0 cosmetic trap.** Renaming nav entries without reorganizing screens leaves the same dashboard under new labels. Phase 0 must also move Gmail/Drive/Calendar/Tasks under a `Workspace` parent route, not just relabel the rail.

5. **InboxTriage component fate.** `InboxTriage` (buckets: needs_reply / needs_input / fyi_only / can_ignore) currently lives on the dashboard. In the new IA it should either become the core of `Work`'s "Needs action now" section or be absorbed into the Gmail tab's new triage layer. It cannot live in both places without duplication. Pick one.
