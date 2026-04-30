# TODOS

## P1 — Extract Shared `getDataDir()` Utility

**What:** Create `src/lib/data-dir.ts` exporting a single `getDataDir()` function with three modes: production (`~/Library/Application Support/FlowSpace/`), dev (project root), and npm/CLI (`~/.flowspace/`). Replace the 4 duplicate definitions in `server.ts`, `chat.ts`, `dynamic-tool-registry.ts`, and `llm-settings.ts`.
**Why:** DRY violation — data directory logic is copied in 4 files. Adding `~/.flowspace/` as a third mode would mean updating all 4 separately, which is a guaranteed bug source. Single source of truth.
**Pros:** One place to change when adding new modes. Prevents inconsistencies. Makes the CLI launcher simpler.
**Cons:** Touching 4 files to extract, but all changes are mechanical import swaps.
**Context:** The three modes should be resolved by env vars or a flag: `FLOWSPACE_PRODUCTION=1` → Library path, `FLOWSPACE_DATA_DIR` env var → custom path, otherwise → `~/.flowspace/` (for npm users) or project root (for `make dev` users). The CLI launcher sets the env var before spawning the server.
**Effort:** S (human: ~2h / CC: ~5min)
**Priority:** P1 — prerequisite for CLI launcher
**Depends on:** Nothing

---

## P1 — CLI Launcher & Setup Wizard (`npx flowspace`)

**What:** Create `bin/cli.ts` entry point that checks Node.js version, detects existing config in `~/.flowspace/`, runs an interactive setup wizard (BYO Google OAuth + AI provider selection), then starts the Express server.
**Why:** The dream one-command install for open-source adoption. Users run `npx flowspace` and get a guided experience instead of reading a wall of README text. This is the core deliverable for community recognition.
**Pros:** Dramatically lowers the barrier to entry. Professional CLI experience (like Vite, Astro, Create T3 App). Makes FlowSpace feel like a real product, not a side project.
**Cons:** Adds a new entry point to maintain. Interactive prompts need a library (e.g., `prompts` or `inquirer`). Must handle edge cases (Ctrl+C, invalid input, network errors).
**Context:** The setup wizard guides users through: (1) pasting their `client_secret.json` path from their own GCP project, (2) choosing an AI provider or skipping, (3) writing config to `~/.flowspace/`. The Express server already supports multi-provider LLM via `llm-settings.ts`. Add `"bin": {"flowspace": "./bin/cli.mjs"}` to `package.json`. Architectural decisions (from eng review): data dir = `~/.flowspace/`, server = pre-bundled `server.mjs` via esbuild, CLI prompts = `@clack/prompts`. The CLI sets `FLOWSPACE_DATA_DIR=~/.flowspace/` before spawning the server process.
**Effort:** M (4-6 hours, human: ~1 week / CC: ~30min)
**Priority:** P1 — core deliverable
**Depends on:** Extract shared `getDataDir()` utility

---

## P1 — Fresh Public Repo & Security Cleanup

**What:** Create a new public GitHub repo for FlowSpace. Copy current code (without `.git/` history) to avoid leaking real Google OAuth credentials that exist in the private repo's git history. Remove `src-tauri/resources/client_secret.json` from tracked files, add `.env.example`, rotate old Google OAuth credentials in GCP Console.
**Why:** Real `client_secret.json` credentials were committed in earlier git history. Rewriting history is risky; a fresh repo is safer. Must be done before making anything public.
**Pros:** Zero risk of credential leak. Clean first commit. Fresh start for open-source community.
**Cons:** Lose git history (but private repo stays as reference).
**Context:** The current `client_secret.json` in the repo has placeholder values, but earlier commits had real credentials. After creating the fresh repo, go to Google Cloud Console and rotate/delete the old OAuth client ID.
**Effort:** S (1-2 hours)
**Priority:** P1 — blocker for going public
**Depends on:** Nothing

---

## ~~P1 — Open-Source README & GCP Setup Guide~~ DONE

Completed: README rewritten with hero section, badges, demo GIF placeholder, "Why FlowSpace?" section, feature highlights, quick start guide, step-by-step GCP setup (BYO OAuth), multi-provider AI table (6 providers), web-only architecture diagram, tech stack, contributing section with dev setup, and desktop app teaser.

---

## P1 — npm Publishing Setup

**What:** Remove `"private": true` from `package.json`, add `"bin"` entry pointing to CLI launcher, create `.npmignore` (exclude `src-tauri/`, `.claude/`, `.opencode/`, test files, etc.), test with `npm pack` locally, then `npm publish`.
**Why:** Publishing to npm enables `npx flowspace` — the one-command install experience. Without this, users must git clone.
**Pros:** Standard distribution channel. Versioned releases. Easy updates via npm.
**Cons:** Need to pick a package name (check if "flowspace" is available on npm). Must maintain npm releases going forward.
**Context:** Check `npm view flowspace` to see if the name is taken. If taken, consider `@flowspace/app` or `flowspace-app`. The `.npmignore` should exclude Tauri files, test files, `.claude/` config, and other dev-only artifacts.
**Effort:** S (1-2 hours)
**Priority:** P1
**Depends on:** CLI Launcher (TODO #1)

---

## P2 — Dashboard Graceful Degradation Without AI

**What:** Ensure the dashboard renders and is fully functional even when no AI provider is configured. The briefing, triage, and chat should show helpful messages ("Configure AI in Settings") instead of errors.
**Why:** Many open-source users will try FlowSpace before configuring an AI key. The dashboard should still be useful as a Google Workspace viewer without AI features.
**Pros:** Better first-run experience. Users see value before committing to an AI key.
**Cons:** Need to audit every AI-dependent component for graceful fallback.
**Context:** The LLM client already throws "No LLM provider configured" — need to catch this at the UI level and show friendly messages. Triage heuristics already have a non-AI fallback. Briefing and chat need verification.
**Effort:** S (2-3 hours)
**Priority:** P2
**Depends on:** Nothing

---

## P2 — `flowspace doctor` Diagnostic Command

**What:** Add a `flowspace doctor` subcommand that checks: Node.js version, gws CLI installed, `client_secret.json` valid, Google auth status, AI provider configured, port 3000 available. Prints a clean health report with green checkmarks and red X marks.
**Why:** Users love diagnostic commands — it's the first thing they run when something breaks. Like `brew doctor` or `npx next info`. Reduces support burden.
**Pros:** Self-service debugging. Shows professionalism. Reduces GitHub issues.
**Cons:** Another codepath to maintain.
**Context:** Can reuse existing `checkGwsAuthStatus()`, `isLLMConfigured()`, and port-check logic from `server.ts`.
**Effort:** S (30 min)
**Priority:** P2
**Depends on:** CLI Launcher (TODO #1)

---

## P2 — ASCII Welcome Banner

**What:** Show a tasteful ASCII art FlowSpace logo + welcome message on first run of `npx flowspace`. Inspired by Vite, Astro, and Create T3 App first-run experiences.
**Why:** Makes the first impression memorable and professional. Sets the tone for quality.
**Pros:** Delightful first-run experience. Low effort, high impact.
**Cons:** Can feel gimmicky if overdone.
**Context:** Keep it minimal — 3-4 lines of ASCII art, version number, and a link to docs.
**Effort:** S (15 min)
**Priority:** P2
**Depends on:** CLI Launcher (TODO #1)

---

## P2 — GitHub Actions CI

**What:** Add `.github/workflows/ci.yml` that runs `npm test` and `tsc --noEmit` on every push and PR. Add green CI badge to README.
**Why:** Shows the community that code quality is taken seriously. Prevents regressions. Green badge in README signals a healthy project.
**Pros:** Automated quality gate. Professional appearance. Catches breakage early.
**Cons:** GitHub Actions minutes (free for public repos).
**Context:** Simple workflow: checkout, setup Node 20, npm ci, npm test, tsc --noEmit.
**Effort:** S (20 min)
**Priority:** P2
**Depends on:** Fresh Public Repo (TODO #2)

---

## P2 — Demo GIF/Video for README

**What:** Record a 15-second screen recording showing FlowSpace dashboard in action — calendar view, inbox triage, AI chat interaction. Convert to GIF or host as video.
**Why:** The single highest-impact thing for GitHub stars. People decide in 3 seconds whether to star a repo, and a visual demo is what sells it.
**Pros:** Instant understanding of what FlowSpace does. Much more effective than text.
**Cons:** Needs to be re-recorded when UI changes significantly.
**Context:** Tools: macOS screen recording → ffmpeg to GIF, or use LICEcap. Host on GitHub (commit to repo) or use a CDN.
**Effort:** S (30 min)
**Priority:** P2
**Depends on:** Dashboard looking polished

---

## P3 — One-Click Deploy Buttons (Railway, Render)

**What:** Add "Deploy to Railway" and "Deploy to Render" buttons in README. Create `railway.json` and `render.yaml` config files for one-click deployment.
**Why:** Users who don't want to self-host can click one button and have FlowSpace running in the cloud. Massive adoption booster.
**Pros:** Lowers barrier even further. Reaches non-developer users.
**Cons:** Cloud deploy still requires Google OAuth setup. Environment variable configuration needed.
**Context:** Both platforms support Node.js apps. Need to handle the `client_secret.json` as an environment variable or uploaded file. May need a setup page in the web UI for first-time cloud deploys.
**Effort:** M (1 hour per platform)
**Priority:** P3 — Phase 2 enhancement
**Depends on:** npm Publishing (TODO #4)

## P2 — Vector Embeddings for Semantic Memory Search

**What:** Replace keyword matching in memory retrieval with embedding similarity search.
**Why:** Keyword matching breaks when users use synonyms or vague references. "Find memories about my job search" should work even without the exact word "tracker."
**Pros:** Dramatically more accurate memory retrieval. Enables fuzzy/conceptual matching.
**Cons:** Requires an embedding model dependency (local ONNX or API-based). Adds storage overhead for embedding vectors.
**Context:** The Phase 1 memory schema already includes a nullable `embedding?: number[]` field on each `MemoryEntry`. This TODO populates that field and replaces the keyword-based retriever with a cosine-similarity ranker. Start in `src/agent/memory/memory-retriever.ts`.
**Effort:** M (3-4 hours)
**Depends on:** Memory system Phase 1

---

## P3 — Proactive Memory-Based Suggestions

**What:** Agent detects temporal patterns in memory access and proactively suggests actions.
**Why:** Transforms the agent from reactive ("do what I ask") to proactive ("you usually do this on Mondays"). Example: "You usually update your Job Applications tracker on Mondays — want me to check for new job emails?"
**Pros:** Makes the agent feel like a trusted human assistant who knows your routines.
**Cons:** Requires pattern detection over memory access logs. Risk of annoying suggestions if patterns are noisy.
**Context:** The `accessCount` and `lastAccessedAt` fields on `MemoryEntry` provide the raw signal. A lightweight pattern detector would analyze access timestamps to find recurring patterns (daily, weekly, etc.). Could integrate with the existing `[SUGGEST: ...]` system in `chat.ts`.
**Effort:** L (6-8 hours)
**Depends on:** Memory system Phase 1 + sufficient access log data (needs weeks of usage)

---

## P3 — Shared JsonFileStore Utility

**What:** Extract a shared `JsonFileStore<T>` utility from `dynamic-tool-registry.ts` and `memory-store.ts`.
**Why:** Both use the same FileIO + JSON persistence pattern (read/write JSON to DATA_DIR, in-memory cache, CRUD operations). Two copies is acceptable; a third would be a DRY smell.
**Pros:** Eliminates duplicate persistence logic. Makes adding new stores trivial.
**Cons:** Premature abstraction if no third store is needed. The two stores have different schemas and validation.
**Context:** Wait until a third JSON-backed store is needed. If that happens, extract the common pattern from `src/agent/dynamic-tool-registry.ts` and `src/agent/memory/memory-store.ts`.
**Effort:** S (1-2 hours)
**Depends on:** A third JSON file store being needed
