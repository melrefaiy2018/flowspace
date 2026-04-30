/**
 * Embedding computation and storage for memory retrieval.
 *
 * Embeddings are stored in a SEPARATE file from the main memory store:
 *   .memory/{userHash}.embeddings.json
 *
 * This keeps the main memory file fast (<15ms writes) while embeddings
 * are loaded on-demand at retrieval time and written in batches.
 *
 * Only OpenAI and OpenRouter providers support embeddings. All others
 * fall back to keyword-only retrieval with no error.
 */

import { getActiveProviderConfig } from '../llm-settings.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Types ────────────────────────────────────────────────────────────────────

interface EmbeddingFile {
  version: 1;
  model: string;
  entries: Record<string, number[]>;
}

// ── Module-level state ───────────────────────────────────────────────────────

let embeddingFilePath: string | null = null;
let embeddingCache: Record<string, number[]> = {};
let isDirty = false;
let batchMode = false;
let pendingWrite = false;

// ── Provider capability ──────────────────────────────────────────────────────

/**
 * Returns true when the active LLM provider supports the embeddings API.
 * Only OpenAI and OpenRouter are supported; all others fall back to
 * keyword-only retrieval.
 */
export function supportsEmbeddings(): boolean {
  const config = getActiveProviderConfig();
  if (!config) return false;
  return config.provider === 'openai' || config.provider === 'openrouter';
}

/**
 * Returns the embedding model identifier for the active provider, or null
 * if embeddings are not supported.
 */
export function getEmbeddingModel(): string | null {
  const config = getActiveProviderConfig();
  if (!config) return null;
  if (config.provider === 'openai' || config.provider === 'openrouter') {
    return 'text-embedding-3-small';
  }
  return null;
}

// ── Math ─────────────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 * Returns 0 if either vector has zero magnitude or is empty.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Embedding computation ────────────────────────────────────────────────────

/**
 * Compute an embedding for the given text using the active provider's API.
 *
 * Returns null when:
 * - The provider doesn't support embeddings (no error)
 * - Any network, API, or parse error occurs (no throw)
 */
export async function computeEmbedding(text: string): Promise<number[] | null> {
  if (!supportsEmbeddings()) return null;

  const config = getActiveProviderConfig();
  if (!config) return null;

  const baseURL = config.baseURL || 'https://api.openai.com/v1';
  const url = `${baseURL}/embeddings`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      console.warn(`[embeddings] API returned ${response.status}`);
      return null;
    }

    const json = await response.json() as unknown;
    const data = (json as { data?: Array<{ embedding?: number[] }> })?.data;
    if (!Array.isArray(data) || !Array.isArray(data[0]?.embedding)) {
      console.warn('[embeddings] Unexpected API response shape');
      return null;
    }

    return data[0].embedding as number[];
  } catch (err) {
    console.warn('[embeddings] computeEmbedding failed:', (err as Error).message);
    return null;
  }
}

// ── File I/O ─────────────────────────────────────────────────────────────────

/**
 * Resolve the embedding file path for a user hash.
 * Same directory as the main memory file (.memory/).
 */
function resolveEmbeddingPath(userHash: string): string {
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1';
  const dataDir = isProduction
    ? path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace')
    : path.resolve(__dirname, '..', '..', '..');
  return path.join(dataDir, '.memory', `${userHash}.embeddings.json`);
}

/**
 * Set the embedding file path for the current user.
 * Must be called before loadEmbeddings() / saveEmbedding().
 */
export function initEmbeddingStore(userHash: string): void {
  embeddingFilePath = resolveEmbeddingPath(userHash);
  embeddingCache = {};
  isDirty = false;
  batchMode = false;
  pendingWrite = false;
}

/**
 * Load embeddings from disk into the module cache.
 *
 * Returns {} when:
 * - The file does not exist (fresh user, no embeddings yet)
 * - The stored model differs from the current model (provider switched)
 * - The file is corrupt
 *
 * Provider switch detection: when the stored model key differs from
 * getEmbeddingModel(), all cached embeddings are invalid and will be
 * lazily recomputed as memories are retrieved.
 */
export function loadEmbeddings(): Record<string, number[]> {
  if (!embeddingFilePath) return {};

  if (!fs.existsSync(embeddingFilePath)) {
    embeddingCache = {};
    return embeddingCache;
  }

  try {
    const raw = fs.readFileSync(embeddingFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as EmbeddingFile;

    if (parsed?.version !== 1 || typeof parsed?.model !== 'string') {
      embeddingCache = {};
      return embeddingCache;
    }

    const currentModel = getEmbeddingModel();
    if (parsed.model !== currentModel) {
      console.log(
        `[embeddings] Model changed from ${parsed.model} to ${currentModel ?? 'none'}, invalidating cached embeddings`,
      );
      embeddingCache = {};
      return embeddingCache;
    }

    embeddingCache = { ...parsed.entries };
    return embeddingCache;
  } catch {
    embeddingCache = {};
    return embeddingCache;
  }
}

/**
 * Add or update an embedding in the in-memory cache and mark as dirty.
 * Does NOT immediately write to disk — call flushEmbeddings() or
 * use batch mode for deferred writes.
 */
export function saveEmbedding(memoryId: string, embedding: number[]): void {
  embeddingCache = { ...embeddingCache, [memoryId]: embedding };
  isDirty = true;

  if (!batchMode) {
    flushEmbeddings();
  } else {
    pendingWrite = true;
  }
}

/**
 * Write the current embedding cache to disk if dirty.
 * Uses atomic write (temp + rename) to prevent corruption.
 * Writes COMPACT JSON (no pretty-print) to minimize file size.
 */
export function flushEmbeddings(): void {
  if (!isDirty || !embeddingFilePath) return;

  const model = getEmbeddingModel();
  if (!model) return;

  const dir = path.dirname(embeddingFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const data: EmbeddingFile = {
    version: 1,
    model,
    entries: { ...embeddingCache },
  };

  const tmpPath = embeddingFilePath + '.tmp';
  // Compact JSON — no pretty-print (file can be ~9MB at 500 entries with 1536-dim vectors)
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
  fs.renameSync(tmpPath, embeddingFilePath);
  isDirty = false;
}

/**
 * Invalidate all embeddings — clears the in-memory cache and marks as dirty
 * so the next flush removes stale data.
 * Used when the provider/model changes.
 */
export function invalidateEmbeddings(): void {
  embeddingCache = {};
  isDirty = true;
  // Reset file state (flush with empty entries or simply clear the dirty flag
  // since we reset the cache; next loadEmbeddings will return {} from file miss)
  isDirty = false;
}

// ── Batch mode ───────────────────────────────────────────────────────────────

/**
 * Begin a write batch — subsequent saveEmbedding() calls accumulate in the
 * in-memory cache without triggering disk writes.
 * Call flushEmbeddingBatch() to commit all changes in a single write.
 */
export function beginEmbeddingBatch(): void {
  batchMode = true;
  pendingWrite = false;
}

/**
 * Flush the accumulated embedding batch — writes all changes to disk in one
 * atomic operation and exits batch mode.
 */
export function flushEmbeddingBatch(): void {
  batchMode = false;
  if (pendingWrite || isDirty) {
    flushEmbeddings();
    pendingWrite = false;
  }
}
