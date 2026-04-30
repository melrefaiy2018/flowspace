# FlowSpace Harness Exploration and Enhancement Plan

## Goal

Create a focused exploration and design plan so the agent can understand the current FlowSpace harness deeply, identify the architectural limits that reduce agent quality, and propose a stronger harness design that follows the principle that memory, context, tools, approvals, and persistence belong to the harness core.

This work is not just about code cleanup. It is about improving agent response quality, continuity, trust, portability, and future proactive behavior.

---

## Core design principle

Treat the harness as the full runtime system around the model.

The harness owns:

* context assembly
* memory retrieval and persistence
* tool exposure and execution
* approval gating
* session continuity
* proactive artifact handoff
* state transitions between read, think, propose, approve, and execute

Do not treat memory as a plugin.
Do not treat approval as a UI detail.
Do not treat proactive work as a side workflow.

---

## Primary outcome

By the end of this exploration, produce:

1. a precise harness map
2. a runtime flow map
3. a list of harness contracts
4. a list of pain points and risks
5. a staged enhancement plan
6. a recommendation for the next implementation slice that gives the biggest improvement to agent quality with the least disruption

---

## What the agent must understand first

The current FlowSpace harness appears to be split across frontend and backend.

Backend responsibilities likely include:

* LLM call orchestration
* tool execution
* write approval gating
* server side memory storage and retrieval
* provider configuration
* streaming events

Frontend responsibilities likely include:

* conversation identity
* local message history
* thread brief persistence
* event linked conversations
* approval UI
* chat resume behavior
* action to chat transitions

The first task is to validate exactly where those boundaries are in the real code.

---

## Exploration objectives

### Objective 1: Map the current harness boundary

Answer these questions with code level grounding:

* What is the true entry point of the agent runtime
* Where is context assembled before model invocation
* Where does memory enter the prompt
* Where are tool definitions merged and normalized
* Where are write tools classified
* Where does approval pause execution
* Where is post approval execution resumed
* What state is frontend only
* What state is backend only
* What state is duplicated or bridged between the two

### Objective 2: Understand context ownership

Trace every source of model context:

* system prompt
* persona
* thread brief
* retrieved memories
* prior messages
* tool results
* dynamic tool definitions
* event linked conversation state
* proactive artifacts such as meeting prep drafts

For each one, identify:

* source of truth
* lifetime
* who writes it
* who reads it
* when it is truncated, summarized, or dropped

### Objective 3: Understand memory as a harness function

Inspect the full memory lifecycle:

* how memories are retrieved
* how memories are ranked
* how memories are injected
* how memories are extracted from tool results
* how memories are persisted per user
* how stale memories are handled
* how memory usage is tracked or not tracked
* what the server can know that the frontend cannot know
* what the frontend can know that the server cannot know

Then assess whether the current memory system is a coherent runtime contract or just a working collection of coupled utilities.

### Objective 4: Understand tool runtime design

Inspect:

* static tool registry
* dynamic tool registry
* meta tools such as tool creation
* dispatch logic
* result normalization
* error shaping
* read versus write separation
* interaction with the approval system
* interaction with memory extraction

Identify whether the tool layer is scalable or whether it is acting as a monolith that hides multiple responsibilities.

### Objective 5: Understand approval as a first class runtime

Map the exact approval lifecycle:

* tool call emitted by model
* harness inspects tool intent
* harness decides write or not
* approval payload built
* response streamed to frontend
* user edits or confirms
* approval returned to backend
* tool executes
* results feed back into state and memory

Inspect whether approval logic is too tightly embedded into chat orchestration, and whether it should become an explicit runtime contract.

### Objective 6: Understand proactive to reactive handoff

Study how proactive artifacts are supposed to become chat context.

Examples:

* meeting prep draft approved into chat
* event linked conversation resume
* future draft queues or prep artifacts

Define the general handoff contract, not only the current meeting prep case.

---

## Required code areas to inspect

Inspect these files and any closely related modules.

### Backend

* `server.ts`
* `src/agent/chat.ts`
* `src/agent/tools.ts`
* `src/agent/llm-client.ts`
* `src/agent/llm-settings.ts`
* `src/agent/dynamic-tool-bridge.ts`
* `src/agent/dynamic-tool-registry.ts`
* `src/agent/tool-composer.ts`
* `src/agent/memory/memory-store.ts`
* `src/agent/memory/memory-extractor.ts`
* `src/agent/memory/memory-retriever.ts`
* any draft queue or horizon scanner files if present
* any JSON persistence utility

### Frontend

* `src/context/ChatContext.tsx`
* `src/shared/chat.ts`
* `src/components/HomeDashboard.tsx`
* `src/components/DraftQueue.tsx` if present
* `src/hooks/useDrafts.ts` if present
* any conversation model or localStorage helpers
* any approval UI components

---

## Deliverable format for the exploration

The agent should produce the following sections in order.

### 1. Harness map

A clear map of the current architecture with these buckets:

* Context Runtime
* Tool Runtime
* Approval Runtime
* Memory Runtime
* Session Runtime
* Proactive Runtime
* Persistence Layer
* Frontend Bridge

For each bucket, list:

* files
* responsibilities
* inputs
* outputs
* dependencies
* current owner of truth

### 2. Runtime flow map

Describe these flows step by step in words.

#### Reactive chat flow

User input to final answer, including memory injection and tool loop.

#### Write approval flow

Tool proposal to user approval to execution to post execution update.

#### Memory lifecycle flow

Extraction to storage to retrieval to prompt injection.

#### Session continuity flow

Conversation identity, thread brief, event resume, local storage, and server continuity.

#### Proactive artifact flow

Scan or prep creation to storage to UI surfacing to chat handoff.

### 3. Harness contracts

Define the interfaces that the system should conceptually have even if they do not exist yet.

At minimum define:

* ContextAssembler
* ToolRuntime
* ApprovalRuntime
* MemoryRuntime
* SessionRuntime
* ProactiveArtifactRuntime
* PersistenceStore contract
* StreamEvent contract

For each contract, specify:

* purpose
* required inputs
* outputs
* invariants
* failure behavior

### 4. Current pain points

Identify concrete problems such as:

* over centralization
* hidden coupling
* split ownership between frontend and backend
* duplicate state
* poor portability
* fragile context assembly
* unstructured proactive handoff
* tool runtime monolith
* memory contract not explicit enough
* approval logic mixed with orchestration

Each pain point should include:

* what it is
* where it appears
* why it hurts agent quality or maintainability
* severity level

### 5. Enhancement options

Propose three levels of change.

#### Option A: low risk improvement

Small refactors that improve clarity and agent response quality without changing behavior.

#### Option B: medium refactor

Extract internal runtimes and formalize contracts while preserving external UX.

#### Option C: deeper harness redesign

Rebalance ownership across frontend and backend, unify session state model, and prepare for stronger proactive behavior.

For each option, include:

* expected benefit
* implementation cost
* migration risk
* effect on agent quality
* effect on future memory and proactive work

### 6. Recommended path

Pick the best option and justify it.
Then provide a staged plan with small implementation slices.
Each slice should be independently reviewable and testable.

---

## Key evaluation questions

The agent must explicitly answer these questions.

### Context

* Who truly owns context assembly today
* Is thread brief a real context contract or a patch over split ownership
* What context is currently invisible to the backend harness
* What context is currently invisible to the frontend

### Memory

* Is memory retrieval strong enough to influence response quality reliably
* Does memory extraction capture the right kinds of facts and resources
* Is memory coupled too tightly to chat orchestration
* Does memory need a clearer runtime boundary

### Tools

* Is the tool runtime modular enough to support growth
* Are static, dynamic, and meta tools unified cleanly
* Are tool results normalized consistently enough for memory and prompting

### Approval

* Is approval a clean pause and resume runtime or mixed into chat flow logic
* Can the system support richer approval patterns later without rewriting the core loop

### Session continuity

* Should more state move server side
* Should some conversation state remain client side for responsiveness
* What is the correct source of truth for session continuity

### Proactive work

* What is the reusable contract for a proactive artifact entering chat
* Can the harness support more proactive artifact types without special casing each one

---

## Constraints for the design proposal

The proposed harness enhancement must preserve these properties:

* strong user approval before writes
* data ownership and portability
* compatibility with current tool based architecture
* support for memory growth over time
* support for model provider flexibility
* clear boundary between reasoning and execution
* ability to support proactive workflows later

Do not optimize for clever architecture at the expense of trust or shipping velocity.

---

## Likely design direction to investigate

The code may benefit from a harness structure like this:

### Context Runtime

Owns system prompt composition, thread brief integration, memory context, and prompt budget policy.

### Tool Runtime

Owns tool registration, dispatch, normalization, and result shaping.

### Approval Runtime

Owns write classification, approval payloads, pause and resume semantics, and post approval execution.

### Memory Runtime

Owns retrieval, extraction, persistence, stale handling, and usage tracking.

### Session Runtime

Owns conversation identity, event linked resume, thread brief persistence, and client server synchronization rules.

### Proactive Artifact Runtime

Owns how draft outputs, prep artifacts, and future proactive objects are surfaced, stored, approved, and turned into chat context.

This does not require classes. It requires explicit ownership.

---

## Clarifications to resolve during exploration

If anything below is ambiguous in the code, surface it clearly.

* whether `threadBrief` is the primary continuity mechanism or only one of several
* whether approval events and post approval execution are symmetric and reusable
* whether proactive drafts already have a generic artifact model
* whether memory access tracking is real or only partial
* whether the frontend can inspect memory in a first class way
* whether the backend can reconstruct enough conversation context without frontend help
* whether dynamic tools and static tools are exposed through one coherent interface

Do not guess. Mark unknowns explicitly.

---

## Standard for success

This exploration is successful only if it leads to a harness plan that improves agent responses in practical terms.

That means the final proposal should make it easier for the agent to:

* maintain continuity across turns and sessions
* use memory more reliably
* reason over tools with less hidden coupling
* pause safely for approvals
* resume work cleanly after approval
* accept proactive artifacts as first class context
* remain portable and open rather than locked into provider specific behavior

---

## Final instruction to the agent

Do not start by redesigning everything.
Start by making the current harness legible.
Then identify the smallest structural changes that would improve response quality the most.
Only after that should you propose larger architectural moves.
