---
name: FlowSpace Dashboard
description: The product UI for FlowSpace. Light-mode-first paper aesthetic with a green accent for actionability.
colors:
  bg: "#f4f4f5"
  bg-elevated: "#ffffff"
  surface: "#ffffff"
  surface-2: "#f0f0f2"
  surface-3: "#e8e8eb"
  surface-soft: "#f7f7f8"
  surface-strong: "#e4e4e7"
  surface-hover: "#ebebed"
  border: "#e2e2e5"
  border-2: "#d1d1d6"
  text: "#111113"
  text-dim: "#4b4b52"
  text-faint: "#8c8c96"
  accent: "#22c55e"
  accent-dim: "#dcfce7"
  accent-border: "#86efac"
  green: "#15803d"
  amber: "#d97706"
  amber-dim: "#fef3c7"
  amber-border: "#fcd34d"
  blue: "#2563eb"
  blue-dim: "#dbeafe"
  blue-border: "#93c5fd"
  error: "#dc2626"
  error-dim: "#fee2e2"
  red-border: "#fca5a5"
  purple: "#7c3aed"
  purple-dim: "#ede9fe"
  purple-border: "#c4b5fd"
  dark-bg: "#1b1b1d"
  dark-bg-elevated: "#070708"
  dark-surface: "#1f2023"
  dark-text: "#ededed"
  dark-border: "#2b2c31"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.01em"
  body-lg:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  meta:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "7px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  2xl: "28px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg-elevated}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    typography: "{typography.label}"
  chip-default:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    typography: "{typography.meta}"
  chip-accent:
    backgroundColor: "{colors.accent-dim}"
    textColor: "{colors.green}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    typography: "{typography.meta}"
  card-default:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "16px"
  card-home-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "20px"
  signal-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "14px"
  input-base:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    typography: "{typography.body}"
---

# Design System: FlowSpace Dashboard

## 1. Overview

**Creative North Star: "The Morning Briefing on Quality Paper"**

The FlowSpace dashboard is what a thoughtful colleague would have prepared for you before you sat down. Not a control panel; not a productivity cockpit. A quietly organized surface where the right three or four things rise to your attention because they are the right three or four things, not because every panel is competing for the eye. The user is a knowledge worker or executive who lives inside Google Workspace, has half a dozen tabs open, and reaches for FlowSpace to start the day without anxiety.

The aesthetic lane is **light as identity**. The canvas (`#f4f4f5`) is the color of slightly off-white paper, not clinical white; surfaces step up to pure white (`#ffffff`) for elevated cards, and depth comes from gentle shadow rather than heavy borders. The accent green (`#22c55e`) appears only on things the user can act on (sign-off prompts, "ready to send" states, live indicators) so it functions as a verb, not a decoration. Dark mode exists and is polished, but light is the canonical experience: anything that breaks light should be reconsidered in light first.

This system explicitly rejects: generic SaaS dashboard clichés (purple gradient hero panels, card-on-card-on-card layouts, cluttered analytics walls), color used decoratively (accent green on neutral information, multi-color category coding for variety's sake), and anything that feels like a demo app or a tool no one actually uses. Typography is the single biggest driver of hierarchy; icons are secondary to text whenever text is clearer.

**Key Characteristics:**
- Light-mode-first; dark mode is supported, not co-equal
- Surfaces feel like paper (warm whites, soft shadows), not interface chrome
- Green is the verb of the system: it signals "good to act on," nothing else
- Mixed border-radius scale (7 / 12 / 16 / 22 / 28px) expresses hierarchy explicitly
- Geist for UI, Geist Mono for data and timestamps only
- Personal specificity over generic patterns: real names, real counts, real events

## 2. Colors

The palette is a tinted-neutral system anchored by a single saturated green. Restraint is the strategy: light surfaces, quiet text scale, one accent.

### Primary
- **Signal Green** (`#22c55e`): The accent. Used for actionable items (Send, Approve, Connect), live state (online indicator, "now" labels), and success confirmations. Always paired with `accent-dim` (`#dcfce7`) for filled containers in light theme, and with `accent-border` (`#86efac`) for outlined treatments.
- **Signal Green (Dark Theme Variant)** (`#15803d`): The darker green used inside `--green` for dark-theme legibility of secondary state copy. Same role, deeper hue for the dark surfaces.

### Secondary
- **Attention Amber** (`#d97706`): Used for "needs your attention" states (Follow-ups, overdue items, deadlines). Always paired with `amber-dim` (`#fef3c7`) for filled containers in light theme. Never for decoration.
- **Information Blue** (`#2563eb`): Used for informational status (Calendar event tiles, "review" buckets in inbox triage). Paired with `blue-dim` (`#dbeafe`). Reserved for neutral information, not action.

### Tertiary
- **Error Red** (`#dc2626`): Failure states only (send failed, sync error, destructive confirmations). Paired with `error-dim` (`#fee2e2`).
- **Workflow Purple** (`#7c3aed`): Reserved for automation and workflow surfaces (saved workflows, triggers). Paired with `purple-dim` (`#ede9fe`).

### Neutral (light theme, canonical)
- **Paper Canvas** (`#f4f4f5`): The page background. A faint warm gray, not white. This is what gives the dashboard its "quality paper" feel.
- **Page Elevated** (`#ffffff`): Pure white. Used for cards, sidebars, modals: everything that sits above the canvas.
- **Surface 2** (`#f0f0f2`): Internal surface for nested cards or contextual headers.
- **Surface 3** (`#e8e8eb`): Deepest interactive surface.
- **Surface Soft** (`#f7f7f8`): Faint hover layer.
- **Surface Hover** (`#ebebed`): Interactive hover background for buttons and list rows.
- **Border** (`#e2e2e5`): The 1px hairline between every card and the canvas. Soft, never sharp.
- **Border 2** (`#d1d1d6`): Stronger border for emphasis (active selection, focused input).
- **Text** (`#111113`): Primary text. Headlines and body.
- **Text Dim** (`#4b4b52`): Secondary text. Descriptions, sub-copy.
- **Text Faint** (`#8c8c96`): Meta and labels. Timestamps, kickers, placeholders.

### Neutral (dark theme, supported)
The dark theme inverts the surface ramp around `#1b1b1d` (canvas) and `#070708` (deepest elevated layer; sidebars and modals). Text inverts to `#ededed` / `#b4b4bb` / `#7d7d86`. The accent stays at `#22c55e` because the same green reads correctly on both themes.

### Named Rules
**The Green-Is-A-Verb Rule.** Signal Green never marks neutral information. It marks things the user can do, or state that is live. If a green element is not actionable and not signaling live state, it is wrong. The same green never carries category color: blue is for information, amber is for attention, purple is for workflow surfaces.

**The Paper-Not-Plastic Rule.** The light canvas is `#f4f4f5`, never `#ffffff`. Pure white is reserved for elevated surfaces sitting on top of the canvas. This is what creates the paper feeling instead of a clinical-white app shell.

## 3. Typography

**Display Font:** Geist (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Body Font:** Geist (same family)
**Data/Meta Font:** Geist Mono (with `ui-monospace, monospace` fallback)

**Character:** One sans family for warmth and consistency; one mono family for precision where precision matters (timestamps, counts, system data). The pair works together: Geist's clarity for ideas, Geist Mono's exactness for evidence.

### Hierarchy
- **Display** (600, 28px, line-height 1.2, tracking -0.02em): Page-level greetings (Context Header), full-page section openings. Used sparingly.
- **Headline** (600, 22px, line-height 1.25): Section openings (Needs Attention, Calendar, Inbox Triage). One per panel.
- **Title** (600, 16px, line-height 1.4): Card titles, individual item headlines.
- **Body Large** (400, 15px, line-height 1.6): Briefing prose, important descriptive copy.
- **Body** (400, 14px, line-height 1.6, tracking -0.01em): Default UI text. Max measure 65 to 75ch.
- **Label** (500, 13px, line-height 1.4): Inline labels, button text, list-item primary text.
- **Meta** (Geist Mono, 400, 12px, tracking 0.01em): Timestamps, counts, system metadata. Mixed-case (not all-caps) in light theme.

### Named Rules
**The Mono-As-Data Rule.** Geist Mono is for data (timestamps, counts, IDs, durations) and nothing else. Mono on body copy is forbidden; it reads as decoration. Mono on labels is allowed only when the label is itself a data value (e.g. "v1.0").

**The No-All-Caps-In-Light-Mode Rule.** All-caps mono labels read as too heavy on light surfaces. Use sentence case for section kickers in light theme. (The dark-theme variants and the landing page can break this; the dashboard cannot.)

**The Text-Beats-Icons Rule.** When text is clearer than an icon, use text. Icons supplement text in primary actions; they do not replace text. The exception is the sidebar rail, where icons + tooltips earn the space saving.

## 4. Elevation

The system uses a **soft-shadow plus border combination**. Every card carries both a hairline 1px border (`#e2e2e5` in light theme) and a soft drop shadow. The two work together: the border defines the card's edge crisply at high zoom, and the shadow lifts it off the paper canvas at normal zoom. This is the central depth metaphor: each card is a thin slip of paper resting on the canvas, not a glass tile floating in space.

Home-panel cards (the major dashboard panels) carry a deeper composite shadow (`0 22px 48px rgba(0, 0, 0, 0.10)`) to anchor them as primary surfaces. Standard cards carry only `shadow-card`. Sidebars and modals use `shadow-elevated`. Tooltips, popovers, and the chat panel use a yet-deeper shadow that is not formally tokenized; they exist outside the normal elevation pyramid because they are temporary.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px var(--border)`): The default. Every standard card uses this.
- **Elevated** (`box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px var(--border)`): Sidebars, modal surfaces, sign-in modal panels.
- **Home Panel** (`box-shadow: 0 22px 48px rgba(0,0,0,0.10)`): The major dashboard panels (Calendar, Inbox Triage, Needs Attention, Tasks). Used on the home dashboard only.
- **Attention Flash** (`box-shadow: 0 0 0 0–4px color-mix(in srgb, var(--amber) 20–40%, transparent)`): A 1.1s ease-out animation applied to panels that the user just scrolled to via a "scroll to attention" action. Signal, not state.

### Named Rules
**The Paper-On-Paper Rule.** Every card has both a 1px hairline border AND a soft shadow. Border without shadow looks like a flat outlined box; shadow without border looks like glass. Together they look like paper.

**The No-Heavy-Shadow Rule.** Shadows are subtle. If you can clearly see the shadow from across the room, it is too strong. The shadow's job is to lift the card a few millimeters, not to dramatize it.

## 5. Components

### Buttons
- **Shape:** 7px radius (`rounded.sm`)
- **Primary:** Signal Green background (`#22c55e`), Page Elevated text (`#ffffff`), 8/14px padding, Label weight 500. Used for the single primary action per surface (Send, Approve, Connect).
- **Secondary:** Page Elevated background (`#ffffff`), Text color (`#111113`), 1px Border, same shape. Used for "Cancel", "Edit", and non-primary actions.
- **Ghost:** Canvas background (`#f4f4f5` in light; transparent in dark), Text Dim color, no border at rest. Used for inline actions in list rows.
- **Hover / Focus:** Primary: filter brightness 1.06. Secondary: surface shifts to Surface Hover (`#ebebed`). Ghost: surface shifts to Surface 2 (`#f0f0f2`). Focus: 2px Signal Green outline at 2px offset.
- **Active (press):** Filter brightness 0.96 across all variants.

### Chips
- **Default:** Surface 2 background (`#f0f0f2`), Text Dim text, 7px radius, 2/8px padding, Meta typography. Used for filter pills and inline labels.
- **Accent (Live / Active):** Accent Dim background (`#dcfce7`), Green text (`#15803d`), same shape. Used for "live", "now", "ready", and active filter selections.
- **Attention:** Amber Dim background (`#fef3c7`), Amber text (`#d97706`), same shape. Used for "needs sign-off", "overdue", "deadline today".
- **Workflow:** Purple Dim background (`#ede9fe`), Purple text (`#7c3aed`), same shape. Used on automation surfaces.

### Cards / Containers
- **Standard Card:** Page Elevated background (`#ffffff`), 1px Border, 12px radius (`rounded.md`), 16px internal padding. Default for everything.
- **Home Panel:** Same background and border, 12px radius, 20px internal padding, with the Home Panel shadow (`0 22px 48px rgba(0, 0, 0, 0.10)`). Used for the major dashboard panels only.
- **Signal Card:** Standard card with a hover treatment (filter brightness 1.06 on hover, 0.96 on press). Used for clickable summary cards in the Stats and Activity rows.
- **Workspace Section:** Page Elevated background, 1px Border, 12px radius, border-color shifts gently on hover. Used as the container for the major workspace areas (Mail tab, Calendar tab, etc.).
- **Never nested.** Cards do not contain other cards. If a card needs internal grouping, use Surface 2 (`#f0f0f2`) as a contained zone with no extra border or shadow.

### Inputs / Fields
- **Style:** Page Elevated background, 1px Border, 7px radius, 8/12px padding, Body typography.
- **Focus:** Border shifts to Accent Border (`#86efac`), and a 0 0 0 3px `var(--accent-glow)` ring appears (rgba(34, 197, 94, 0.08) in light; 0.16 in dark). The ring is the focus indicator; do not also change the background.
- **Error:** Border shifts to Error (`#dc2626`); the validation message appears below in Error text + Meta typography.
- **Disabled:** Background shifts to Surface 2; text dims to Text Faint; no focus ring.

### Navigation (AppRail)
- **Style:** Fixed left rail, ~56px wide. Vertical stack of icon buttons with tooltips on hover. Background is a subtle gradient (`linear-gradient(180deg, var(--bg-elevated), var(--rail-gradient-stop))`) so the rail reads as a separate surface from the canvas.
- **Active State:** A 2px Signal Green vertical bar appears to the left of the active rail icon. The icon itself shifts from Text Faint to Text. The active treatment is the bar, not a background fill.
- **Hover:** Icon shifts from Text Faint to Text Dim; no background change.
- **Mobile:** The rail collapses into a bottom-aligned tab bar. Icons keep the same active-bar metaphor, repositioned to the top edge of the active tab.

### Signature Component: Context Header
The greeting band at the top of the home dashboard. Single row, left-aligned, with the user's name in Display typography and a one-sentence AI briefing below in Body Large. To the right, a row of live signal chips (Inbox, Calendar, Drive counts) rendered in Meta typography. This is the personal-specificity moment of the dashboard; the briefing copy must always reference real data, never placeholder text. The background is `var(--surface)` with a subtle radial gradient on the dashboard root (`radial-gradient(circle at 50% 0%, rgba(var(--accent-rgb), 0.06), transparent 40%)`) that gives the top of the page a quiet warmth.

### Signature Component: Approval Card
The human-in-the-loop component. When the AI proposes a write action (send email, create event, modify document), an Approval Card appears in-place (never as a modal). The card shows the action verb (`send_email` in Meta), the action target (recipient, event details, document path), and the action payload (the proposed email body, event title, etc.) in editable form. Three buttons: Primary (Send / Create / Apply), Secondary (Edit), and Ghost (Discard). The payload is editable inline before approval. This component is the architectural commitment of the product: the user is always in the loop.

## 6. Do's and Don'ts

### Do:
- **Do** use `#f4f4f5` as the page canvas, not `#ffffff`. Reserve pure white for elevated surfaces.
- **Do** use Signal Green (`#22c55e`) only for actionable elements (Send, Approve, Connect) and live state. Never for decoration or category color.
- **Do** carry real specificity in dashboard copy: the user's actual name, real event counts, real deadlines. Generic placeholder copy breaks the warmth.
- **Do** pair every card with both a 1px hairline border AND a soft shadow. Either alone reads wrong.
- **Do** use the mixed border-radius scale (7 / 12 / 16 / 22 / 28px) deliberately. Small chips at 7px, interactive cards at 12px, hero panels at 22 to 28px. The scale expresses hierarchy.
- **Do** use Geist Mono for data (timestamps, counts, IDs) and Geist for everything else.
- **Do** support dark mode, but treat it as a secondary theme. Anything that breaks light should be reconsidered in light first.
- **Do** put approval inline (Approval Card), never in a modal. The user stays in context.
- **Do** use the AppRail active-bar metaphor (2px green left bar) consistently across surfaces.
- **Do** use icon + text together in primary actions; do not let icons replace text outside the rail.

### Don't:
- **Don't** use purple gradient hero panels or generic SaaS dashboard aesthetics. PRODUCT.md anti-reference: "Generic SaaS dashboards with purple gradient heroes, card-on-card-on-card layouts, cluttered analytics."
- **Don't** nest cards inside cards. Use Surface 2 as a contained zone with no extra border or shadow.
- **Don't** use Signal Green for category color, hover backgrounds, or anything not actionable.
- **Don't** use all-caps mono labels in light mode. They read as heavy and clinical.
- **Don't** use side-stripe borders (`border-left > 1px` as a colored accent). The AppRail active indicator is a separate floating bar, not a card stripe.
- **Don't** show empty states or placeholder copy ("No items yet", "Welcome!"). Generic empty states break the spell; show a real, contextual prompt instead.
- **Don't** put critical actions behind a modal when an inline Approval Card would do.
- **Don't** introduce a new accent color. The amber/blue/purple secondaries are reserved for their specific roles (attention/information/workflow); do not invent a new accent for a new feature.
- **Don't** rely on icons as primary communication. Text labels beat icon-only buttons whenever the surface has the room.
- **Don't** use heavy drop shadows. A shadow visible from across the room is too strong; it should lift the card a few millimeters, not stage-light it.
