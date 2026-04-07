# TODOS

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
