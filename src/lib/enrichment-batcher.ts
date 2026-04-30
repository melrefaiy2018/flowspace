/**
 * enrichment-batcher
 *
 * Splits a large list of Gmail threads into small batches and runs them
 * sequentially through the enrichment API. The goal is to give the user
 * visible progress on slow local LLMs (LM Studio on a 120b model can take
 * 2+ minutes on a single 25-thread call) rather than waiting for one
 * monolithic response.
 *
 * The batcher is pure — it takes a fetcher function rather than importing
 * `api` directly — so it can be unit tested with a mock. The hook wires
 * it to `api.getThreadEnrichments`.
 */
import type { GmailThreadSummary } from '../services/api.js';
import type { ThreadEnrichment, EnrichedThreadsResponse } from '../shared/gmail-enrichment-types.js';

export type EnrichmentFetcher = (threads: GmailThreadSummary[]) => Promise<EnrichedThreadsResponse>;

export interface BatchProgress {
  completed: number;
  total: number;
  batchEnrichments: ThreadEnrichment[];
  batchFailed: string[];
}

export interface BatchResult {
  enrichments: ThreadEnrichment[];
  failed: string[];
  completedBatches: number;
  totalBatches: number;
  /**
   * The message from the most recent batch-level exception, if any.
   * Preserved so the hook can show the underlying error (e.g.
   * 'enrichment_timeout') in the fallback banner instead of a generic
   * 'all failed' message.
   */
  lastError?: string;
}

/** Split threads into fixed-size chunks. Last chunk may be smaller. */
export function chunkThreads<T>(threads: readonly T[], batchSize: number): T[][] {
  if (batchSize <= 0) throw new Error('batchSize must be positive');
  const chunks: T[][] = [];
  for (let i = 0; i < threads.length; i += batchSize) {
    chunks.push(threads.slice(i, i + batchSize));
  }
  return chunks;
}

/**
 * Run the enrichment fetcher sequentially on batches of `batchSize` threads.
 * Calls `onProgress` after each batch completes (success OR failure).
 *
 * On per-batch failure, the failed thread ids are surfaced in the progress
 * callback and the aggregate result. Remaining batches continue — one bad
 * batch does NOT abort the whole run. If every batch fails, the caller
 * can detect that from the final `enrichments.length === 0`.
 *
 * Honors `AbortSignal`: if the signal is aborted between batches, the
 * pending batches are not fired and the function resolves with whatever
 * was collected so far (not rejected). Aborting mid-fetch relies on the
 * fetcher itself respecting the signal.
 */
export async function batchEnrichments(
  threads: readonly GmailThreadSummary[],
  batchSize: number,
  fetcher: EnrichmentFetcher,
  onProgress: (progress: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchResult> {
  const chunks = chunkThreads(threads, batchSize);
  const enrichments: ThreadEnrichment[] = [];
  const failed: string[] = [];
  let completedBatches = 0;
  let lastError: string | undefined;

  for (const chunk of chunks) {
    if (signal?.aborted) break;

    let batchEnrichments: ThreadEnrichment[] = [];
    let batchFailed: string[] = [];

    try {
      const res = await fetcher(chunk);
      batchEnrichments = res.enrichments;
      batchFailed = res.failed;
      enrichments.push(...res.enrichments);
      failed.push(...res.failed);
    } catch (err) {
      // Whole batch failed — mark every thread id in this chunk as failed.
      batchFailed = chunk.map((t) => t.id);
      failed.push(...batchFailed);
      lastError = err instanceof Error ? err.message : String(err);
    }

    completedBatches += 1;

    onProgress({
      completed: completedBatches * batchSize > threads.length ? threads.length : completedBatches * batchSize,
      total: threads.length,
      batchEnrichments,
      batchFailed,
    });
  }

  return {
    enrichments,
    failed,
    completedBatches,
    totalBatches: chunks.length,
    ...(lastError ? { lastError } : {}),
  };
}
