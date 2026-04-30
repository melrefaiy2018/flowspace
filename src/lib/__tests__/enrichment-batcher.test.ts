import { describe, it, expect, vi } from 'vitest';
import { chunkThreads, batchEnrichments, type EnrichmentFetcher, type BatchProgress } from '../enrichment-batcher';
import type { GmailThreadSummary } from '../../services/api';
import type { ThreadEnrichment, EnrichedThreadsResponse } from '../../shared/gmail-enrichment-types';

const makeThread = (id: string): GmailThreadSummary => ({
  id,
  subject: `subject-${id}`,
  snippet: `snippet-${id}`,
  from: `from-${id}@example.com`,
  date: '2026-04-11T00:00:00Z',
  unread: true,
  messageCount: 1,
  hasAttachments: false,
  labelIds: ['INBOX'],
});

const makeEnrichment = (threadId: string): ThreadEnrichment => ({
  threadId,
  priority: 'high',
  recommendedAction: 'draft_reply',
  whyItMatters: `Why for ${threadId}`,
  effortMinutes: '5',
  bucket: 'needs_reply',
});

const makeResponse = (threadIds: string[]): EnrichedThreadsResponse => ({
  enrichments: threadIds.map(makeEnrichment),
  failed: [],
  cacheStats: { hits: 0, misses: threadIds.length, totalRequested: threadIds.length },
  bucketCounts: { needs_reply: threadIds.length, waiting: 0, quick_wins: 0, reference_fyi: 0 },
  durationMs: 100,
});

describe('chunkThreads', () => {
  it('splits 25 threads into 9 batches of 3 (last batch size 1)', () => {
    const threads = Array.from({ length: 25 }, (_, i) => makeThread(`t${i}`));
    const chunks = chunkThreads(threads, 3);
    expect(chunks).toHaveLength(9);
    expect(chunks[0]).toHaveLength(3);
    expect(chunks[7]).toHaveLength(3);
    expect(chunks[8]).toHaveLength(1); // remainder
  });

  it('splits 4 threads into 2 batches (3+1) when batchSize is 3', () => {
    const threads = [makeThread('a'), makeThread('b'), makeThread('c'), makeThread('d')];
    const chunks = chunkThreads(threads, 3);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(chunks[1].map((t) => t.id)).toEqual(['d']);
  });

  it('splits 1 thread into 1 batch', () => {
    const chunks = chunkThreads([makeThread('only')], 3);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });

  it('returns empty array when given empty input', () => {
    expect(chunkThreads([], 3)).toEqual([]);
  });

  it('throws when batchSize is zero or negative', () => {
    expect(() => chunkThreads([makeThread('a')], 0)).toThrow();
    expect(() => chunkThreads([makeThread('a')], -1)).toThrow();
  });
});

describe('batchEnrichments', () => {
  it('invokes fetcher once per batch and calls onProgress after each', async () => {
    const threads = Array.from({ length: 7 }, (_, i) => makeThread(`t${i}`));
    const fetcher: EnrichmentFetcher = vi.fn(async (batch) => makeResponse(batch.map((t) => t.id)));
    const progressEvents: BatchProgress[] = [];

    const result = await batchEnrichments(threads, 3, fetcher, (p) => progressEvents.push(p));

    // 7 threads, batchSize 3 → chunks of [3, 3, 1]
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(progressEvents).toHaveLength(3);
    expect(result.enrichments).toHaveLength(7);
    expect(result.failed).toHaveLength(0);
    expect(result.completedBatches).toBe(3);
    expect(result.totalBatches).toBe(3);
  });

  it('reports progressive completed counts', async () => {
    const threads = Array.from({ length: 7 }, (_, i) => makeThread(`t${i}`));
    const fetcher: EnrichmentFetcher = async (batch) => makeResponse(batch.map((t) => t.id));
    const progressEvents: BatchProgress[] = [];

    await batchEnrichments(threads, 3, fetcher, (p) => progressEvents.push(p));

    expect(progressEvents[0].completed).toBe(3);
    expect(progressEvents[1].completed).toBe(6);
    expect(progressEvents[2].completed).toBe(7); // clamped to total
    expect(progressEvents.every((p) => p.total === 7)).toBe(true);
  });

  it('surfaces per-batch enrichments in onProgress', async () => {
    const threads = [makeThread('a'), makeThread('b'), makeThread('c'), makeThread('d')];
    const fetcher: EnrichmentFetcher = async (batch) => makeResponse(batch.map((t) => t.id));
    const progressEvents: BatchProgress[] = [];

    await batchEnrichments(threads, 2, fetcher, (p) => progressEvents.push(p));

    expect(progressEvents[0].batchEnrichments.map((e) => e.threadId)).toEqual(['a', 'b']);
    expect(progressEvents[1].batchEnrichments.map((e) => e.threadId)).toEqual(['c', 'd']);
  });

  it('continues remaining batches when one fails and surfaces failed ids', async () => {
    const threads = [makeThread('a'), makeThread('b'), makeThread('c'), makeThread('d')];
    // Fail on the second batch only
    let callCount = 0;
    const fetcher: EnrichmentFetcher = async (batch) => {
      callCount += 1;
      if (callCount === 2) throw new Error('batch 2 boom');
      return makeResponse(batch.map((t) => t.id));
    };
    const progressEvents: BatchProgress[] = [];

    const result = await batchEnrichments(threads, 2, fetcher, (p) => progressEvents.push(p));

    expect(result.enrichments.map((e) => e.threadId)).toEqual(['a', 'b']);
    expect(result.failed).toEqual(['c', 'd']);
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[1].batchFailed).toEqual(['c', 'd']);
  });

  it('surfaces server-side failed ids from the response envelope', async () => {
    const threads = [makeThread('a'), makeThread('b'), makeThread('c')];
    const fetcher: EnrichmentFetcher = async (batch) => ({
      enrichments: [makeEnrichment(batch[0].id)],
      failed: batch.slice(1).map((t) => t.id),
      cacheStats: { hits: 0, misses: batch.length, totalRequested: batch.length },
      bucketCounts: { needs_reply: 1, waiting: 0, quick_wins: 0, reference_fyi: 0 },
      durationMs: 100,
    });
    const progressEvents: BatchProgress[] = [];

    const result = await batchEnrichments(threads, 3, fetcher, (p) => progressEvents.push(p));

    expect(result.enrichments.map((e) => e.threadId)).toEqual(['a']);
    expect(result.failed).toEqual(['b', 'c']);
  });

  it('stops firing new batches when AbortSignal is aborted between batches', async () => {
    const threads = Array.from({ length: 6 }, (_, i) => makeThread(`t${i}`));
    const controller = new AbortController();
    let callCount = 0;
    const fetcher: EnrichmentFetcher = async (batch) => {
      callCount += 1;
      // Abort after the first batch completes
      if (callCount === 1) controller.abort();
      return makeResponse(batch.map((t) => t.id));
    };
    const progressEvents: BatchProgress[] = [];

    await batchEnrichments(threads, 2, fetcher, (p) => progressEvents.push(p), controller.signal);

    // First batch fired and reported progress, but the next two are skipped
    expect(callCount).toBe(1);
    expect(progressEvents).toHaveLength(1);
  });

  it('handles empty input (no batches fired)', async () => {
    const fetcher: EnrichmentFetcher = vi.fn();
    const onProgress = vi.fn();
    const result = await batchEnrichments([], 3, fetcher, onProgress);

    expect(fetcher).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(result.enrichments).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.completedBatches).toBe(0);
    expect(result.totalBatches).toBe(0);
  });
});
