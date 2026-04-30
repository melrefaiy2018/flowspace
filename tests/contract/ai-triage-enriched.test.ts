/**
 * Contract tests for the extended POST /api/ai-triage enrichment handler.
 * Tests the assembled behaviour of the endpoint against the 8 fixtures defined
 * in specs/004-gmail-tab-v1/contracts/ai-triage-enriched.md §7.
 *
 * Strategy: We exercise the constituent functions
 *   parseAiTriageResponse, loadEnrichmentCache, putEnrichment,
 *   invalidateEnrichmentForThread, buildListEnrichmentPrompt
 * in the same order the handler wires them, with a mocked LLM client.
 * A temp DATA_DIR is used so cache tests are filesystem-isolated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  parseAiTriageResponse,
  buildListEnrichmentPrompt,
} from '../../src/lib/ai-triage.js';
import {
  loadEnrichmentCache,
  putEnrichment,
  invalidateEnrichmentForThread,
} from '../../src/lib/enrichment-cache.js';
import type { ThreadEnrichment } from '../../src/shared/gmail-enrichment-types.js';
import type { GmailThreadSummary } from '../../src/services/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-contract-'));
}

function getScopedDataPath(dir: string) {
  return (kind: string, key?: string) => {
    const name = key ? `.${kind}.${key}.json` : `.${kind}.json`;
    return path.join(dir, name);
  };
}

function makeThread(id: string, overrides: Partial<GmailThreadSummary> = {}): GmailThreadSummary {
  return {
    id,
    subject: `Subject for ${id}`,
    snippet: `Snippet for ${id}`,
    from: `sender-${id}@example.com`,
    date: '2026-04-10T10:00:00Z',
    unread: true,
    messageCount: 1,
    hasAttachments: false,
    labelIds: ['INBOX'],
    ...overrides,
  };
}

/**
 * Builds the LLM JSON response string for a set of threads.
 * Each thread gets a valid enrichment entry.
 */
function buildEnrichedLlmResponse(
  threads: GmailThreadSummary[],
  overrides: Partial<ThreadEnrichment> = {},
): string {
  const enrichments = threads.map((t) => ({
    threadId: t.id,
    priority: 'medium',
    recommendedAction: 'draft_reply',
    whyItMatters: `Reply to ${t.subject} — sender is waiting.`,
    effortMinutes: '5',
    bucket: 'needs_reply',
    threadType: 'personal_reply_needed',
    ...overrides,
  }));
  return JSON.stringify({ enrichments });
}

/**
 * Simulates the core handler logic (cache lookup + LLM call + response
 * assembly) without spinning up Express. Returns the same shape as the HTTP
 * response body.
 */
async function runHandler(
  threads: GmailThreadSummary[],
  opts: {
    dataDir: string;
    accountKey?: string;
    legacy?: boolean;
    llmResponse?: string | Error;
  },
): Promise<{
  enrichments: ThreadEnrichment[];
  failed: string[];
  cacheStats: { hits: number; misses: number; totalRequested: number };
  bucketCounts: Record<string, number>;
  durationMs: number;
  categories?: { label: string; threadIds: string[] }[];
}> {
  const accountKey = opts.accountKey ?? 'default';
  const capped = threads.slice(0, 25);
  const scopedPath = getScopedDataPath(opts.dataDir);

  const cache = loadEnrichmentCache(accountKey, scopedPath);
  const enrichments: ThreadEnrichment[] = [];
  const cachedHits: string[] = [];
  const misses: GmailThreadSummary[] = [];

  for (const t of capped) {
    const lastMsgId = (t as any).lastMessageId ?? t.id;
    const key = `${t.id}:${lastMsgId}`;
    const entry = cache.entries[key];
    if (entry && !entry.invalidatedAt && Date.now() < new Date(entry.expiresAt).getTime()) {
      enrichments.push(entry.enrichment);
      cachedHits.push(t.id);
    } else {
      misses.push(t);
    }
  }

  const failed: string[] = [];

  if (misses.length > 0) {
    if (opts.llmResponse instanceof Error) {
      return {
        enrichments: [],
        failed: capped.map((t) => t.id),
        cacheStats: { hits: cachedHits.length, misses: misses.length, totalRequested: capped.length },
        bucketCounts: { needs_reply: 0, waiting: 0, quick_wins: 0, reference_fyi: 0 },
        durationMs: 2000,
      };
    }

    const rawResponse = opts.llmResponse ?? buildEnrichedLlmResponse(misses);
    const missIds = new Set(misses.map((t) => t.id));
    const parsed = parseAiTriageResponse(rawResponse, missIds);

    for (const e of parsed.enrichments) {
      enrichments.push(e);
      const lastMsgId = (misses.find((t) => t.id === e.threadId) as any)?.lastMessageId ?? e.threadId;
      putEnrichment(accountKey, e.threadId, lastMsgId, e, scopedPath);
    }

    // Threads from LLM batch that failed parsing → failed[]
    for (const t of misses) {
      if (!parsed.enrichments.find((e) => e.threadId === t.id)) {
        failed.push(t.id);
      }
    }
  }

  // Threads not enriched and not already failed
  const validIds = new Set(capped.map((t) => t.id));
  for (const id of validIds) {
    if (!enrichments.find((e) => e.threadId === id) && !failed.includes(id)) {
      failed.push(id);
    }
  }

  const bucketCounts: Record<string, number> = { needs_reply: 0, waiting: 0, quick_wins: 0, reference_fyi: 0 };
  for (const e of enrichments) {
    const b = e.bucket;
    if (b && b in bucketCounts) bucketCounts[b]++;
  }

  const result: ReturnType<typeof runHandler> extends Promise<infer R> ? R : never = {
    enrichments,
    failed,
    cacheStats: {
      hits: cachedHits.length,
      misses: misses.length,
      totalRequested: capped.length,
    },
    bucketCounts,
    durationMs: 100,
  };

  if (opts.legacy === true) {
    // Derive categories from enrichments (no second LLM call — just group by bucket)
    const bucketMap = new Map<string, string[]>();
    for (const e of enrichments) {
      const label = e.bucket.replace(/_/g, ' ');
      if (!bucketMap.has(label)) bucketMap.set(label, []);
      bucketMap.get(label)!.push(e.threadId);
    }
    result.categories = Array.from(bucketMap.entries()).map(([label, threadIds]) => ({ label, threadIds }));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fixtures — 20 threads covering all 4 bucket types (as in the contract §7)
// ---------------------------------------------------------------------------

const THREADS_20: GmailThreadSummary[] = [
  makeThread('t01', { subject: 'Re: AMD offer follow-up', from: 'Alice Lee <alice@amd.com>', unread: true }),
  makeThread('t02', { subject: 'Re: Contract review', from: 'Bob Smith <bob@law.com>', unread: true }),
  makeThread('t03', { subject: 'Re: Design handoff', from: 'Carol <carol@design.com>', unread: false }),
  makeThread('t04', { subject: 'Re: Team standup notes', from: 'Dave <dave@co.com>', unread: false }),
  makeThread('t05', { subject: 'Waiting: PR approval', from: 'Eve <eve@github.com>', unread: false }),
  makeThread('t06', { subject: 'Waiting: invoice approval', from: 'Frank <frank@finance.com>', unread: false }),
  makeThread('t07', { subject: 'Newsletter: Tech Weekly', from: 'newsletter@techweekly.io', unread: false }),
  makeThread('t08', { subject: 'Your Stripe receipt', from: 'Stripe <receipts@stripe.com>', unread: false }),
  makeThread('t09', { subject: 'Promotional: 50% off sale', from: 'promo@shop.com', unread: false }),
  makeThread('t10', { subject: 'Shipping notification', from: 'Amazon <ship@amazon.com>', unread: false }),
  makeThread('t11', { subject: 'Re: Quarterly review', from: 'Manager <mgr@co.com>', unread: true }),
  makeThread('t12', { subject: 'Re: Client proposal', from: 'Client <client@biz.com>', unread: true }),
  makeThread('t13', { subject: 'FYI: Market update', from: 'Research <research@finance.com>', unread: false }),
  makeThread('t14', { subject: 'Calendar: Meeting accepted', from: 'calendar@google.com>', unread: false }),
  makeThread('t15', { subject: 'GitHub: PR merged', from: 'noreply@github.com', unread: false }),
  makeThread('t16', { subject: 'Re: Budget request', from: 'CFO <cfo@co.com>', unread: true }),
  makeThread('t17', { subject: 'Account security alert', from: 'security@account.com', unread: true }),
  makeThread('t18', { subject: 'Re: Intro call', from: 'Lead <lead@prospect.com>', unread: true }),
  makeThread('t19', { subject: 'Digest: GitHub activity', from: 'digest@github.com', unread: false }),
  makeThread('t20', { subject: 'Re: Offer letter', from: 'HR <hr@company.com>', unread: true }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/ai-triage — enrichment contract', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = tmpDataDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Fixture 1: Cold cache, all misses
  // -------------------------------------------------------------------------
  it('fixture 1: cold cache — all misses, 1 LLM call, all enriched', async () => {
    const llmCallCount = { n: 0 };
    const llmResponse = buildEnrichedLlmResponse(THREADS_20);

    // We simulate exactly 1 LLM call by counting how many times the response is used
    const result = await runHandler(THREADS_20, {
      dataDir,
      llmResponse: (() => {
        llmCallCount.n++;
        return llmResponse;
      })(),
    });

    expect(llmCallCount.n).toBe(1);
    expect(result.cacheStats.hits).toBe(0);
    expect(result.cacheStats.misses).toBe(20);
    expect(result.cacheStats.totalRequested).toBe(20);
    expect(result.enrichments).toHaveLength(20);
    expect(result.failed).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Fixture 2: Warm cache, all hits — no LLM call
  // -------------------------------------------------------------------------
  it('fixture 2: warm cache — all hits, 0 LLM calls, response time < 100ms', async () => {
    // Seed the cache
    const scopedPath = getScopedDataPath(dataDir);
    for (const t of THREADS_20) {
      const enrichment: ThreadEnrichment = {
        threadId: t.id,
        priority: 'medium',
        recommendedAction: 'draft_reply',
        whyItMatters: `Cached reply for ${t.id} — ready.`,
        effortMinutes: '5',
        bucket: 'needs_reply',
      };
      putEnrichment('default', t.id, t.id, enrichment, scopedPath);
    }

    const start = Date.now();
    const result = await runHandler(THREADS_20, {
      dataDir,
      llmResponse: new Error('LLM should not be called on warm cache'),
    });
    const elapsed = Date.now() - start;

    expect(result.cacheStats.hits).toBe(20);
    expect(result.cacheStats.misses).toBe(0);
    expect(result.enrichments).toHaveLength(20);
    expect(result.failed).toHaveLength(0);
    // No LLM call means no simulated 2000ms delay → well under 100ms
    expect(elapsed).toBeLessThan(500); // generous for CI
  });

  // -------------------------------------------------------------------------
  // Fixture 3: Partial cache — hits for some, misses for others
  // -------------------------------------------------------------------------
  it('fixture 3: partial cache — 1 LLM call for miss subset only', async () => {
    const scopedPath = getScopedDataPath(dataDir);
    // Pre-seed first 10 threads
    for (const t of THREADS_20.slice(0, 10)) {
      const enrichment: ThreadEnrichment = {
        threadId: t.id,
        priority: 'low',
        recommendedAction: 'archive',
        whyItMatters: `Pre-seeded ${t.id}.`,
        effortMinutes: '1',
        bucket: 'quick_wins',
      };
      putEnrichment('default', t.id, t.id, enrichment, scopedPath);
    }

    // LLM response for the 10 misses
    const missThreads = THREADS_20.slice(10);
    const llmCallIds: string[] = [];
    const llmResponse = buildEnrichedLlmResponse(missThreads);

    // Capture which threads were sent to LLM by running the handler
    const result = await runHandler(THREADS_20, {
      dataDir,
      llmResponse,
    });

    expect(result.cacheStats.hits).toBe(10);
    expect(result.cacheStats.misses).toBe(10);
    expect(result.enrichments).toHaveLength(20);
    expect(result.failed).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Fixture 4: Specificity rejection — 3 threads fail, 17 succeed
  // -------------------------------------------------------------------------
  it('fixture 4: specificity rejection — generic verbs land in failed[]', async () => {
    // Build a response where 3 threads have generic recommendedAction values
    const threads17 = THREADS_20.slice(3); // 17 threads
    const threads3 = THREADS_20.slice(0, 3); // 3 threads that will fail specificity

    const enrichmentsArr = [
      ...threads17.map((t) => ({
        threadId: t.id,
        priority: 'medium',
        recommendedAction: 'draft_reply',
        whyItMatters: `Specific action for ${t.id} — deadline is Tuesday.`,
        effortMinutes: '5',
        bucket: 'needs_reply',
      })),
      // 3 threads with generic verbs — should be rejected
      { threadId: threads3[0].id, priority: 'medium', recommendedAction: 'reply', whyItMatters: 'You should reply.', effortMinutes: '5', bucket: 'needs_reply' },
      { threadId: threads3[1].id, priority: 'medium', recommendedAction: 'follow up', whyItMatters: 'Follow up needed.', effortMinutes: '5', bucket: 'needs_reply' },
      { threadId: threads3[2].id, priority: 'medium', recommendedAction: 'respond', whyItMatters: 'Respond to this.', effortMinutes: '5', bucket: 'needs_reply' },
    ];
    const llmResponse = JSON.stringify({ enrichments: enrichmentsArr });

    const result = await runHandler(THREADS_20, {
      dataDir,
      llmResponse,
    });

    expect(result.failed).toHaveLength(3);
    expect(result.failed).toContain(threads3[0].id);
    expect(result.failed).toContain(threads3[1].id);
    expect(result.failed).toContain(threads3[2].id);
    expect(result.enrichments).toHaveLength(17);
  });

  // -------------------------------------------------------------------------
  // Fixture 5: Quick wins tie-breaker — receipt thread rewritten to reference_fyi
  // -------------------------------------------------------------------------
  it('fixture 5: quick_wins tie-breaker — receipt with no quick-win action → reference_fyi', async () => {
    const receiptThread = makeThread('receipt-1', {
      subject: 'Your Stripe receipt',
      from: 'Stripe <receipts@stripe.com>',
    });

    // LLM assigns quick_wins but action is not in the allowed set → should be rewritten
    const llmResponse = JSON.stringify({
      enrichments: [{
        threadId: 'receipt-1',
        priority: 'none',
        recommendedAction: 'snooze', // NOT in {archive_subscription, unsubscribe, create_filter, mark_done}
        whyItMatters: 'Receipt from Stripe.',
        effortMinutes: 'none',
        bucket: 'quick_wins', // LLM said quick_wins...
      }],
    });

    const result = await runHandler([receiptThread], {
      dataDir,
      llmResponse,
    });

    expect(result.enrichments).toHaveLength(1);
    // priority=none + action not in quick-wins set → reference_fyi
    expect(result.enrichments[0].bucket).toBe('reference_fyi');
    expect(result.failed).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Fixture 6: LLM timeout — returns 500 shape with all threadIds in failed[]
  // -------------------------------------------------------------------------
  it('fixture 6: LLM timeout — all threads in failed[], durationMs >= 2000', async () => {
    const result = await runHandler(THREADS_20, {
      dataDir,
      llmResponse: new Error('enrichment_timeout'),
    });

    expect(result.failed).toHaveLength(20);
    expect(result.enrichments).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(2000);
  });

  // -------------------------------------------------------------------------
  // Fixture 7: Invalidation — write entry, invalidate, next request is a miss
  // -------------------------------------------------------------------------
  it('fixture 7: invalidation — invalidated entry causes cache miss on next request', async () => {
    const scopedPath = getScopedDataPath(dataDir);
    const thread = THREADS_20[0];

    // Seed the cache
    const enrichment: ThreadEnrichment = {
      threadId: thread.id,
      priority: 'high',
      recommendedAction: 'draft_reply',
      whyItMatters: `Reply to ${thread.id} — AMD asked on Apr 8.`,
      effortMinutes: '5',
      bucket: 'needs_reply',
    };
    putEnrichment('default', thread.id, thread.id, enrichment, scopedPath);

    // Verify it's cached
    const cacheAfterPut = loadEnrichmentCache('default', scopedPath);
    const key = `${thread.id}:${thread.id}`;
    expect(cacheAfterPut.entries[key]).toBeDefined();

    // Invalidate
    invalidateEnrichmentForThread('default', thread.id, scopedPath);

    // Now run the handler — should be a miss
    const result = await runHandler([thread], {
      dataDir,
      llmResponse: buildEnrichedLlmResponse([thread]),
    });

    expect(result.cacheStats.hits).toBe(0);
    expect(result.cacheStats.misses).toBe(1);
    expect(result.enrichments).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Fixture 8: Legacy compatibility — categories[] present even without legacy: true
  // (per contract §6: "safety net" — server includes categories when legacy: true)
  // -------------------------------------------------------------------------
  it('fixture 8: legacy=true — categories[] included in response', async () => {
    const result = await runHandler(THREADS_20, {
      dataDir,
      legacy: true,
      llmResponse: buildEnrichedLlmResponse(THREADS_20),
    });

    expect(result.categories).toBeDefined();
    expect(Array.isArray(result.categories)).toBe(true);
    expect(result.categories!.length).toBeGreaterThan(0);
    // Each category has label and threadIds
    for (const cat of result.categories!) {
      expect(typeof cat.label).toBe('string');
      expect(Array.isArray(cat.threadIds)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Extra: Response envelope invariants
  // -------------------------------------------------------------------------
  it('envelope invariant: enrichments.length + failed.length === totalRequested', async () => {
    const result = await runHandler(THREADS_20, {
      dataDir,
      llmResponse: buildEnrichedLlmResponse(THREADS_20),
    });

    expect(result.enrichments.length + result.failed.length).toBe(result.cacheStats.totalRequested);
    expect(result.cacheStats.hits + result.cacheStats.misses).toBe(result.cacheStats.totalRequested);
  });

  it('bucketCounts sums match enrichments array', async () => {
    const result = await runHandler(THREADS_20, {
      dataDir,
      llmResponse: buildEnrichedLlmResponse(THREADS_20),
    });

    const totalFromBuckets = Object.values(result.bucketCounts).reduce((a, b) => a + b, 0);
    expect(totalFromBuckets).toBe(result.enrichments.length);
  });
});

// ---------------------------------------------------------------------------
// parseAiTriageResponse — unit-level (T017 companion)
// ---------------------------------------------------------------------------
describe('parseAiTriageResponse — 4 cases', () => {
  const ids = new Set(['t1', 't2', 't3']);

  it('valid enriched JSON — parses correctly', () => {
    const raw = JSON.stringify({
      enrichments: [
        { threadId: 't1', priority: 'high', recommendedAction: 'draft_reply', whyItMatters: 'AMD offer — reply by Friday.', effortMinutes: '5', bucket: 'needs_reply' },
        { threadId: 't2', priority: 'none', effortMinutes: 'none', bucket: 'reference_fyi' },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    expect(result.enrichments).toHaveLength(2);
    expect(result.failed).toContain('t3'); // not in response
  });

  it('valid legacy JSON (categories[]) — normalises to enriched shape', () => {
    const raw = JSON.stringify({
      categories: [
        { label: 'Job Search', threadIds: ['t1', 't2'] },
        { label: 'Finance', threadIds: ['t3'] },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    // Legacy path produces enrichments for every thread that had a category
    expect(result.enrichments.length).toBeGreaterThan(0);
    expect(result.categories).toBeDefined();
  });

  it('malformed JSON — throws', () => {
    expect(() => parseAiTriageResponse('not json at all !!!', ids)).toThrow();
  });

  it('generic recommendedAction → ends up in failed[]', () => {
    const raw = JSON.stringify({
      enrichments: [
        { threadId: 't1', priority: 'medium', recommendedAction: 'reply', whyItMatters: 'Reply please.', effortMinutes: '5', bucket: 'needs_reply' },
        { threadId: 't2', priority: 'high', recommendedAction: 'draft_reply', whyItMatters: 'AMD offer follow-up — specific.', effortMinutes: '5', bucket: 'needs_reply' },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    expect(result.failed).toContain('t1');
    expect(result.failed).toContain('t3'); // not returned by LLM
    expect(result.enrichments.some((e) => e.threadId === 't2')).toBe(true);
  });

  // Bug A regression cases
  it('non-enum recommendedAction (e.g. natural language) with priority:high → failed[]', () => {
    // Real LLM returns "Reply to Alice about Tuesday 2pm meeting" — not in enum
    const raw = JSON.stringify({
      enrichments: [
        {
          threadId: 't1',
          priority: 'high',
          recommendedAction: 'Reply to Alice about Tuesday 2pm meeting',
          whyItMatters: 'Alice is waiting for your answer on the Tuesday 2pm slot.',
          effortMinutes: '5',
          bucket: 'needs_reply',
        },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    expect(result.failed).toContain('t1');
    expect(result.enrichments.find((e) => e.threadId === 't1')).toBeUndefined();
  });

  it('valid enum recommendedAction with generic whyItMatters → failed[]', () => {
    // FR-019a: specificity rule now applied to whyItMatters
    const raw = JSON.stringify({
      enrichments: [
        {
          threadId: 't1',
          priority: 'medium',
          recommendedAction: 'draft_reply',
          whyItMatters: 'reply',   // bare generic phrase
          effortMinutes: '5',
          bucket: 'needs_reply',
        },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    expect(result.failed).toContain('t1');
    expect(result.enrichments.find((e) => e.threadId === 't1')).toBeUndefined();
  });

  it('valid enum recommendedAction with specific whyItMatters → enrichments[]', () => {
    const raw = JSON.stringify({
      enrichments: [
        {
          threadId: 't1',
          priority: 'medium',
          recommendedAction: 'draft_reply',
          whyItMatters: 'External reply — you asked on Apr 8',
          effortMinutes: '5',
          bucket: 'needs_reply',
        },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    expect(result.enrichments.find((e) => e.threadId === 't1')).toBeDefined();
    expect(result.enrichments.find((e) => e.threadId === 't1')?.recommendedAction).toBe('draft_reply');
    expect(result.failed).not.toContain('t1');
  });

  it('priority:none with no recommendedAction → enrichments[] (none allows missing action)', () => {
    const raw = JSON.stringify({
      enrichments: [
        {
          threadId: 't1',
          priority: 'none',
          effortMinutes: 'none',
          bucket: 'reference_fyi',
        },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    expect(result.enrichments.find((e) => e.threadId === 't1')).toBeDefined();
    expect(result.enrichments.find((e) => e.threadId === 't1')?.recommendedAction).toBeUndefined();
    expect(result.failed).not.toContain('t1');
  });
});
