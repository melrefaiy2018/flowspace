# FlowSpace — Impeccable Design Context

## Design Context

### Users
Knowledge workers and executives who live in Google Workspace. Their core frustration: email, calendar, tasks, and Drive are scattered across a half-dozen tabs with no unified view of what actually needs attention. FlowSpace is their single operational surface — the one tab they keep open all day. They care about starting their day without anxiety and acting on the right things fast. They are not developers and don't care about self-hosting.

### Brand Personality
**Warm, personal, grounded.** FlowSpace feels like a thoughtful colleague who's already read everything and tells you only what matters. Not a dashboard — more like a morning briefing from someone who knows your work. Confident without being cold. Smart without feeling robotic.

Three-word personality: **Calm clarity earned.**

Emotional goals: Users should feel *calm*, *on top of things*, and *trusted by a tool that knows them*.

### Aesthetic Direction
- **Primary theme**: Light mode. Clean, airy, generous whitespace. Light is the identity — like a well-lit workspace, not a cockpit. Dark mode exists and is polished, but light is the canonical experience.
- **Accent**: Green-500 (`#22c55e`) as the signature. Use it for actionable items, live state, success — never as decoration. It signals "good to act on."
- **Typography**: Geist Sans for UI text — lean into its clarity. Geist Mono for data, timestamps, and metadata to create precision without coldness. Avoid all-caps mono labels in light mode (too heavy).
- **References**: Superhuman (email focus + speed), Linear (quiet confidence), Notion (warmth). Personal and specific over generic and polished.
- **Anti-references**: Generic SaaS dashboards with purple gradient heroes, card-on-card-on-card layouts, cluttered analytics. Anything that feels like a demo app or a tool no one actually uses.
- **Border radius**: Mixed and intentional — small chips at 7px, interactive cards at 12-16px, hero panels at 24-30px. The scale expresses hierarchy.
- **Motion**: Subtle and purposeful. Entrance animations feel like information arriving, not UI performing. No bouncing. Prefer opacity and translate over scale.

### Design Principles

1. **Attention is scarce** — Every element on screen must earn its pixel. If it doesn't reduce anxiety or enable action, it shouldn't be there.

2. **Light as identity** — Surfaces should feel like quality paper, not clinical white. Use subtle warmth and shadow depth to create elevation in the light theme.

3. **Green is trust** — The accent color signals "good to act on." Use it for actionable items, not decoration. Never use it for neutral information.

4. **Warmth through specificity** — Personal touches (the user's name, their actual calendar events, their real email count) make the interface feel alive. Generic empty states and placeholder copy break the spell.

5. **Typography carries hierarchy** — Size, weight, and color contrast do the work. Don't rely on icons as primary communication when text does it better.

---

## Token Reference (from `src/index.css`)

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#1b1b1d` | Base page background |
| `--bg-elevated` | `#070708` | Deepest layer (sidebar, modals) |
| `--surface` → `--surface3` | `#1f2023` → `#2d2e33` | Card elevation scale |
| `--accent` | `#22c55e` | Primary green — use sparingly |
| `--accent-dim` | `#0d2818` | Muted green backgrounds |
| `--text` | `#ededed` | Primary text |
| `--text-dim` | `#b4b4bb` | Secondary text |
| `--text-faint` | `#7d7d86` | Meta, placeholders, kickers |
| `--border` | `#2b2c31` | Default borders |
| `--radius-sm/md/lg` | `7px / 12px / 16px` | Standard radius scale |

## Focus Areas for Impeccable Commands

- `/audit` — Check for typographic inconsistencies, off-scale radii, accent overuse, missing hover states
- `/normalize` — Align spacing, font sizes, and border radius to the established token scale
- `/polish` — Refine motion, micro-interactions, and edge states (loading, empty, error)
- `/distill` — Remove visual noise; anything that doesn't serve the user's task should go

---

## Landing Page Design Context

> This section describes the **marketing landing page** — a separate surface from the app dashboard above. The two have distinct identities. Do not blend them.

### Users
Developers, privacy-conscious knowledge workers, solo founders, small teams, and self-hosters who use Google Workspace daily and are frustrated by constant tab-switching. They are technically literate — they read READMEs, run curl commands, and evaluate tools by inspecting the source. They need to immediately understand what FlowSpace is and why it's different from Gemini, Copilot, and Reclaim.

### Brand Personality (Landing Page)
**Technical, calm, in control.** Like a senior engineer's personal tool — powerful but not flashy, sophisticated but not overdone. The colleague who already has the doc open before the meeting starts.

Three-word personality: **Precise. Local. Yours.**

Emotional goals: Visitors should feel *impressed by craftsmanship*, *trusted by transparency*, and *compelled to install*.

### Aesthetic Direction (Landing Page)
- **Theme**: Dark-only, non-negotiable. Background `#0c0c0c`. No light mode toggle.
- **Surface layers**: `#141414` (cards/panels) → `#1a1a1a` (elevated) → `#242424` (borders)
- **Accent**: Brand green `#22c55e` for primary actions, highlights, live state. `#0d2818` for contained badges.
- **Text scale**: `#ededed` (primary), `#a0a0a0` (secondary), `#555555` (muted)
- **Accent sparingly**: Amber `#f59e0b` for attention only; Blue `#3b82f6` for informational only
- **Typography**: Distinctive high-quality pair. Do NOT use Inter, Roboto, Arial, or generic system fonts. Use a refined display font + clean body + Geist Mono for terminal/code elements.
- **Visual texture**: Subtle noise/grain overlays, mesh gradients, or a faint green radial glow for atmospheric depth. Never flat solid backgrounds everywhere.
- **Motion**: Purposeful scroll-triggered reveals, smooth transitions. No particle effects, floating orbs, or decorative animation. Animations respond intelligently — they don't perform.
- **Layout**: Desktop-first (1440px+). Generous whitespace. Asymmetric where it adds interest. Spacious, not cramped.

### What to Avoid (Landing Page)
- Generic SaaS landing templates (gradient blobs, purple-on-white, floating mockups)
- "AI slop" — no sparkle emojis, no "powered by AI" badges, no chatbot illustrations
- Overly busy hero sections with multiple competing CTAs
- Stock photography or generic illustrations
- Anything that looks like it could be any product's page with the name swapped

### Hero Approach
**Terminal animation** — typewriter-style sequence: shows the `curl` install command being typed, then the morning briefing appears line by line. Speaks directly to the developer audience. The install command IS the primary CTA; developers respond to commands, not "Sign Up Free" buttons.

### Competitor Table (Privacy Section)
Include a factual, neutral comparison: FlowSpace vs. Gemini Spark vs. Microsoft Copilot. Attributes: data location, cost, model lock-in, open source, approval workflow. No editorial framing — let the facts speak.

### Section Order
1. Sticky navbar (logo, Features / How It Works / Architecture / GitHub, green "Install" CTA)
2. Hero (headline + subheadline + terminal animation + curl CTA + "View on GitHub")
3. Problem → Solution (tabs chaos → unified dashboard, visual contrast does the work)
4. Key Features (Morning Briefing, Inbox Triage, 23-Tool Agent, Human-in-the-Loop, BYO Model)
5. Architecture / How It Works (animated system diagram, technical audience)
6. Privacy & Open Source (local-first, no telemetry, competitor comparison table)
7. Get Started / Install (3 deployment paths: curl / Docker / .dmg — terminal-styled cards)
8. Tech Stack strip (React 19, TypeScript, Express, Tailwind v4, Tauri v2, Vite 6, Vitest, Docker)
9. Footer (wordmark, GitHub, "Built by Mohamed El Refaiy" → mohamedelrefaiy.com, license)

### Design Principles (Landing Page)

1. **The install command is the CTA** — Developers trust commands over buttons. Make the `curl` one-liner the most prominent interactive element on the page.
2. **Dark is the canvas** — Depth comes from layered surfaces and a faint green atmospheric glow, not from decorative elements.
3. **Green signals action** — Use `#22c55e` only for things the visitor can do (install, view source, copy). Never decorative.
4. **Technical credibility through specificity** — Real stats (23 tools, 20+ endpoints, 3 deployment targets, ~200MB vs Electron's ~500MB) earn trust faster than claims.
5. **Motion proves intelligence** — Animations should feel like the page is computing, not bouncing. The terminal animation in the hero is the signature moment.

### Key Stats to Display
- 23 AI tools (read + write + workflow)
- 34+ React components
- 20+ API endpoints
- 3 deployment targets (web, Docker, macOS desktop)
- ~200 MB desktop app (vs. ~500 MB Electron equivalent)
- 5-round max tool-calling loop with human-in-the-loop approval

### Technical Stack (Landing Page Build)
- Framework: Next.js (static export)
- Styling: Tailwind CSS
- Animations: Framer Motion
- Fonts: distinctive display + body pair (not Inter/Roboto) + Geist Mono for code
- Target: desktop-first, responsive to mobile (375px)
