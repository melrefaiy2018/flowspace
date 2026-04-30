<!--
Sync Impact Report
==================
Version change: (none) → 1.0.0
Rationale: Initial ratification of the FlowSpace constitution. MAJOR=1 because
this is the first adopted version; MINOR/PATCH reset to 0.

Modified principles: N/A (initial adoption)
Added sections:
  - Core Principles (I–V)
  - Technical Constraints & Security
  - Development Workflow & Quality Gates
  - Governance
Removed sections: N/A

Templates requiring updates:
  - .specify/templates/plan-template.md         ✅ reviewed (Constitution Check
    gate references generic principles; no edits required — principles here
    are compatible with its placeholder structure)
  - .specify/templates/spec-template.md         ✅ reviewed (no principle
    conflicts; user-story/requirements structure is compatible)
  - .specify/templates/tasks-template.md        ✅ reviewed (TDD ordering in
    template already aligns with Principle III)
  - .specify/templates/checklist-template.md    ✅ reviewed (generic; no edits)
  - .specify/templates/agent-file-template.md   ✅ reviewed (generic; no edits)
  - CLAUDE.md                                   ✅ reviewed (project guide
    already consistent; no edits required)

Deferred items:
  - TODO(RATIFICATION_DATE): Confirm with maintainer whether 2026-04-11 is the
    true original adoption date or whether an earlier informal adoption date
    should be recorded.
-->

# FlowSpace Constitution

FlowSpace is a personal Google Workspace dashboard (React 19 + Express + Vite,
packaged as a Tauri v2 macOS app) with an AI chat agent that reads and writes
across Drive, Gmail, Calendar, and Tasks via configurable LLM providers. This
constitution defines the non‑negotiable rules that govern how the project is
designed, built, tested, and shipped.

## Core Principles

### I. User Data Sovereignty (NON‑NEGOTIABLE)

FlowSpace is a single‑user, local‑first application. User credentials, tokens,
and Google Workspace data MUST remain on the user's machine.

- OAuth credentials and access tokens MUST be stored only under `DATA_DIR`
  (`~/Library/Application Support/FlowSpace/` in production, project root in
  dev) using atomic write patterns (temp file + rename).
- The server MUST NOT transmit user Workspace content to any third party
  except (a) Google APIs the user authenticated against, and (b) the LLM
  provider the user explicitly configured via the Settings UI.
- Secrets MUST NEVER be hardcoded. No API keys, client secrets, or tokens in
  source, tests, fixtures, or commit history.
- Write‑scope tools (send email, create/modify docs, upload files, modify
  tasks) MUST flow through the approval pipeline before execution.

**Rationale**: FlowSpace has privileged, read/write access to the user's
entire Workspace. Any leak of credentials or unapproved write is a
catastrophic, user‑visible failure. Sovereignty is the product.

### II. Two‑Layer Server Architecture

The Express server in `server.ts` MUST remain the single entry point for both
API and frontend delivery, with Vite mounted as middleware in dev and the
built SPA served from `dist/` in production. The Tauri shell MUST spawn this
same server as a child process — there MUST NOT be a separate "Tauri‑only"
code path that bypasses the Express API surface.

- New API endpoints MUST live in `server.ts` (or a module it imports) and
  follow the existing 60‑second in‑memory cache convention unless a documented
  reason exists to deviate.
- Frontend data access MUST go through `src/services/api.ts` typed wrappers,
  not ad‑hoc `fetch` calls scattered through components.
- Google API clients (Drive, Gmail, Calendar, Tasks) MUST be created lazily
  via the `getAuthClient()` helper; modules MUST NOT cache their own auth
  clients.

**Rationale**: A single server boundary keeps dev, prod, and Tauri behavior
identical, preserves HMR, and prevents the auth state machine from being
duplicated or desynchronized.

### III. Test‑First Development (NON‑NEGOTIABLE)

TDD is mandatory for all new features, bug fixes, and refactors.

- Tests MUST be written before implementation (Red → Green → Refactor).
- Vitest (`npm test`) is the single test runner. Test files live in
  `__tests__/` directories adjacent to source.
- Coverage MUST remain ≥ 80% for changed code, measured via
  `@vitest/coverage-v8` (`npm run test:coverage`).
- Every PR MUST include: unit tests for pure logic, integration tests for any
  new API endpoint, and an end‑to‑end or contract test for any new tool the
  AI agent can call.
- Fixing a failing test by deleting or weakening it is forbidden. Tests may
  only be changed when the underlying contract has intentionally changed, and
  the change MUST be called out in the PR description.

**Rationale**: FlowSpace executes real side‑effects in a user's Google
account. Regressions are irreversible. Tests are the only backstop.

### IV. Small, Cohesive, Immutable Modules

Code MUST be organized as many small files over few large ones.

- Target file size: 200–400 lines. Hard ceiling: 800 lines. Files approaching
  the ceiling MUST be split before merging.
- Functions MUST be ≤ 50 lines and nesting ≤ 4 levels deep; use early returns.
- Data structures MUST be treated as immutable. Update by creating new
  objects/arrays, never by in‑place mutation. React state and server caches
  both follow this rule.
- Organize by feature/domain (e.g., `src/agent/`, `src/context/`,
  `src/hooks/`), not by file type.
- The `@/` path alias MUST be used for imports that cross directory
  boundaries; avoid deep relative paths like `../../../`.

**Rationale**: Small, immutable, feature‑scoped modules are what make a
tool‑calling agent with 23+ tools, multi‑provider LLM support, and a
persistent auth state machine comprehensible and safely modifiable.

### V. Boundary Validation & Explicit Errors

Every value crossing a trust boundary MUST be validated, and every error MUST
be handled explicitly.

- User input, Google API responses, LLM tool arguments, and JSON files loaded
  from `DATA_DIR` are all untrusted boundaries and MUST be validated before
  use.
- Errors MUST NOT be silently swallowed. Server‑side errors MUST log full
  context; user‑facing errors MUST render a readable message in the UI.
- LLM tool calls MUST fail closed: on validation error, return a structured
  error to the model so it can retry or apologize, rather than executing a
  degraded side‑effect.
- `child_process` / `execFile` calls (notably to the `gws` CLI) MUST NEVER
  use a shell and MUST pass arguments as arrays. Access tokens are passed
  via environment variables, not command‑line arguments.

**Rationale**: The agent surface is large and adversarial inputs can come
from email bodies, document contents, and LLM hallucinations. Fail‑fast
validation is how we keep the blast radius bounded.

## Technical Constraints & Security

**Stack (locked)**: TypeScript on Node.js 20+, React 19, Express, Vite 6,
Tailwind CSS v4, Framer Motion (`motion`), Lucide React, Tauri v2 with the
shell plugin, Vitest + `@vitest/coverage-v8`. Introducing a new runtime,
framework, or test runner requires a constitutional amendment.

**Auth**: Primary path is the `gws` CLI (`gws auth login` →
`gws auth export --unmasked` → `.gws-credentials.json` in `DATA_DIR`). ADC
fallback is dev‑only. Module‑level `authClient` / `authMethod` variables MUST
remain the single source of truth for server auth state.

**Persistence**: All state is JSON files in `DATA_DIR`, written atomically.
No database. Per‑account scoping MUST use `getScopedDataPath()`; do not
invent parallel path schemes.

**LLM providers**: All LLM calls go through `createLLMClient()`
(`src/agent/llm-client.ts`). Adding a provider means extending that factory,
not creating a parallel client in a feature module.

**Security gates (pre‑commit)**:
- No hardcoded secrets, tokens, or client IDs.
- No `console.log` debug statements in merged code.
- No new `exec`/`spawn` call with `shell: true`.
- No new endpoint without input validation and error handling.
- Write tools route through the approval pipeline.

## Development Workflow & Quality Gates

**Before coding**: For any non‑trivial feature, a plan MUST be produced and
saved under `docs/designs/` or `specs/<feature>/` (per Spec Kit workflow)
and reviewed before implementation begins.

**Local pipeline** (must pass before PR):
1. `make typecheck` — TypeScript strict, zero errors. There is no separate
   linter; `tsc --noEmit` is the type gate.
2. `npm test` — all Vitest suites green.
3. `npm run test:coverage` — ≥ 80% coverage on changed code.
4. `make build` — production build succeeds.
5. For Tauri‑affecting changes: `npm run tauri build` succeeds locally.

**Code review**:
- Every change MUST be reviewed against this constitution. CRITICAL and HIGH
  findings block merge.
- Security‑sensitive changes (auth, tool execution, file I/O, outbound
  network, cryptography) MUST trigger a dedicated security review pass.
- Changes to `server.ts`, `src/agent/`, or the auth flow are considered
  security‑sensitive by default.

**Commits & PRs**: Conventional Commits format (`feat:`, `fix:`, `refactor:`,
`docs:`, `test:`, `chore:`, `perf:`, `ci:`). PR descriptions MUST include a
test plan. Hooks MUST NOT be bypassed (`--no-verify` forbidden) without
explicit maintainer approval recorded in the PR.

**Complexity budget**: Any deviation from Principles I–V (e.g., a file over
800 lines, a mutation‑based hot path, a missing test) MUST be justified in
the PR description under a "Complexity Justification" heading, including why
a compliant alternative was rejected.

## Governance

This constitution supersedes ad‑hoc conventions, individual preferences, and
prior informal guidance. Where `CLAUDE.md` or other docs conflict with this
file, this file wins and the other document MUST be updated.

**Amendment procedure**:
1. Open a PR that edits `.specify/memory/constitution.md` with the proposed
   change and a Sync Impact Report (see the HTML comment at the top of this
   file for the required format).
2. Update dependent templates in `.specify/templates/` and any runtime
   guidance (`CLAUDE.md`, `README.md`, `docs/`) in the same PR.
3. Bump `CONSTITUTION_VERSION` using semantic versioning:
   - **MAJOR**: Removing or redefining a principle in a backward‑incompatible
     way, or removing a governance rule.
   - **MINOR**: Adding a new principle or materially expanding existing
     guidance.
   - **PATCH**: Clarifications, wording fixes, non‑semantic refinements.
4. Update `LAST_AMENDED_DATE` to the merge date (ISO `YYYY-MM-DD`). Leave
   `RATIFICATION_DATE` untouched unless re‑ratifying.
5. Merge requires maintainer approval.

**Compliance review**: PR reviewers MUST explicitly confirm constitution
compliance in their review. The Spec Kit `plan` and `tasks` flows MUST run
the Constitution Check gate before implementation begins.

**Runtime guidance**: Day‑to‑day development guidance lives in `CLAUDE.md`
at the repo root. That file is operational; this file is foundational.

**Version**: 1.0.0 | **Ratified**: 2026-04-11 | **Last Amended**: 2026-04-11
