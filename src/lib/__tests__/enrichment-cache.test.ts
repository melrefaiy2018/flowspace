import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadEnrichmentCache,
  saveEnrichmentCache,
  getEnrichment,
  putEnrichment,
  invalidateEnrichmentForThread,
} from '../enrichment-cache.js';
import type { ThreadEnrichment } from '../../shared/gmail-enrichment-types.js';

let tmpDir: string;
let scopedPathFn: (kind: string, key?: string) => string;

const makeEnrichment = (threadId: string, overrides: Partial<ThreadEnrichment> = {}): ThreadEnrichment => ({
  threadId,
  priority: 'high',
  recommendedAction: 'draft_reply',
  whyItMatters: 'Test enrichment',
  effortMinutes: '5',
  bucket: 'needs_reply',
  ...overrides,
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-cache-test-'));
  scopedPathFn = (kind: string, key?: string) => path.join(tmpDir, `.${kind}.${key ?? 'default'}.json`);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('enrichment-cache', () => {
  it('cold read returns empty cache', () => {
    const cache = loadEnrichmentCache('default', scopedPathFn);
    expect(cache.entries).toEqual({});
  });

  it('write + read roundtrip', () => {
    const enrichment = makeEnrichment('thread1');
    putEnrichment('default', 'thread1', 'msg1', enrichment, scopedPathFn);

    const result = getEnrichment('default', 'thread1', 'msg1', scopedPathFn);
    expect(result).toEqual(enrichment);
  });

  it('uses tmp-file + rename atomic write pattern', () => {
    const enrichment = makeEnrichment('thread1');
    putEnrichment('default', 'thread1', 'msg1', enrichment, scopedPathFn);

    const cachePath = scopedPathFn('gmail-enrichment', 'default');
    expect(fs.existsSync(cachePath)).toBe(true);
    expect(fs.existsSync(cachePath + '.tmp')).toBe(false);

    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(raw.version).toBe(2);
    expect(raw.entries['thread1:msg1']).toBeDefined();
  });

  it('24h TTL expiry returns null for expired entries', () => {
    const cachePath = scopedPathFn('gmail-enrichment', 'default');
    const now = new Date();
    const expired = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    const cache = {
      version: 2,
      updatedAt: now.toISOString(),
      entries: {
        'thread1:msg1': {
          enrichment: makeEnrichment('thread1'),
          cachedAt: expired.toISOString(),
          expiresAt: new Date(expired.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    };
    fs.writeFileSync(cachePath, JSON.stringify(cache));

    const result = getEnrichment('default', 'thread1', 'msg1', scopedPathFn);
    expect(result).toBeNull();
  });

  it('invalidateEnrichmentForThread removes entries by thread id prefix', () => {
    putEnrichment('default', 'thread1', 'msg1', makeEnrichment('thread1'), scopedPathFn);
    putEnrichment('default', 'thread1', 'msg2', makeEnrichment('thread1', { effortMinutes: '1' }), scopedPathFn);
    putEnrichment('default', 'thread2', 'msg1', makeEnrichment('thread2'), scopedPathFn);

    invalidateEnrichmentForThread('default', 'thread1', scopedPathFn);

    expect(getEnrichment('default', 'thread1', 'msg1', scopedPathFn)).toBeNull();
    expect(getEnrichment('default', 'thread1', 'msg2', scopedPathFn)).toBeNull();
    expect(getEnrichment('default', 'thread2', 'msg1', scopedPathFn)).not.toBeNull();
  });

  it('version mismatch on version: 1 discards file and starts fresh', () => {
    const cachePath = scopedPathFn('gmail-enrichment', 'default');
    fs.writeFileSync(cachePath, JSON.stringify({ version: 1, updatedAt: '', entries: { 'x:y': {} } }));

    const cache = loadEnrichmentCache('default', scopedPathFn);
    expect(cache.entries).toEqual({});
    expect(cache.version).toBe(2);
  });
});
