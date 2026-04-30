import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
const logModule = () => import('../invocation-log.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-log-'));
  process.env.FLOWSPACE_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.FLOWSPACE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function inv(overrides: Partial<{ name: string; ts: string; id: string }> = {}) {
  return {
    id: overrides.id ?? `id-${Math.random()}`,
    name: overrides.name ?? 'a',
    argsHash: 'abcdef0123456789',
    timestamp: overrides.ts ?? new Date().toISOString(),
    success: true,
    approval: 'auto' as const,
    source: 'chat' as const,
  };
}

describe('invocation-log', () => {
  it('returns empty when file is missing', async () => {
    const { loadLog } = await logModule();
    expect(await loadLog()).toEqual([]);
  });

  it('appends atomically (no .tmp file remains)', async () => {
    const { appendEntry, _flushPendingForTests } = await logModule();
    await appendEntry(inv(), { logCapEntries: 100, logRetentionDays: 30 });
    await _flushPendingForTests();
    const files = fs.readdirSync(tmpDir);
    expect(files).toContain('.tool-invocation-log.default.json');
    expect(files.find((f) => f.endsWith('.tmp'))).toBeUndefined();
  });

  it('evicts entries beyond logCapEntries (FIFO by insertion)', async () => {
    const { appendEntry, loadLog, _flushPendingForTests } = await logModule();
    for (let i = 0; i < 5; i++) {
      await appendEntry(inv({ id: `id-${i}`, name: String(i) }), {
        logCapEntries: 3,
        logRetentionDays: 30,
      });
    }
    await _flushPendingForTests();
    const entries = await loadLog();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name)).toEqual(['2', '3', '4']);
  });

  it('evicts entries older than logRetentionDays', async () => {
    const { appendEntry, loadLog, _flushPendingForTests } = await logModule();
    const old = inv({ ts: new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString(), name: 'old' });
    const fresh = inv({ ts: new Date().toISOString(), name: 'fresh' });
    await appendEntry(old, { logCapEntries: 100, logRetentionDays: 30 });
    await appendEntry(fresh, { logCapEntries: 100, logRetentionDays: 30 });
    await _flushPendingForTests();
    const entries = await loadLog();
    expect(entries.map((e) => e.name)).toEqual(['fresh']);
  });

  it('falls back to empty when file is malformed JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, '.tool-invocation-log.default.json'), 'not json');
    const { loadLog } = await logModule();
    expect(await loadLog()).toEqual([]);
  });

  it('falls back to empty when file has wrong version', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.tool-invocation-log.default.json'),
      JSON.stringify({ version: 99, entries: [] }),
    );
    const { loadLog } = await logModule();
    expect(await loadLog()).toEqual([]);
  });

  it('scopes the file per accountKey', async () => {
    const { appendEntry, loadLog, _flushPendingForTests } = await logModule();
    await appendEntry(inv({ name: 'A' }), { logCapEntries: 100, logRetentionDays: 30, accountKey: 'alice' });
    await appendEntry(inv({ name: 'B' }), { logCapEntries: 100, logRetentionDays: 30, accountKey: 'bob' });
    await _flushPendingForTests();
    expect((await loadLog('alice')).map((e) => e.name)).toEqual(['A']);
    expect((await loadLog('bob')).map((e) => e.name)).toEqual(['B']);
  });

  it('clearLog empties the file and reports count', async () => {
    const { appendEntry, clearLog, loadLog, _flushPendingForTests } = await logModule();
    await appendEntry(inv(), { logCapEntries: 100, logRetentionDays: 30 });
    await appendEntry(inv(), { logCapEntries: 100, logRetentionDays: 30 });
    await _flushPendingForTests();
    const removed = await clearLog();
    expect(removed).toBe(2);
    expect(await loadLog()).toEqual([]);
  });

  it('clearLog serializes with in-flight appendEntry (no race)', async () => {
    const { appendEntry, clearLog, loadLog } = await logModule();
    // Kick off many appends without awaiting; immediately invoke clear.
    // If clear runs while an append is mid-write, the append could
    // resurrect cleared entries. Serialization on writeLock prevents that.
    const appends: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      appends.push(appendEntry(inv({ id: `id-${i}` }), { logCapEntries: 100, logRetentionDays: 30 }));
    }
    const cleared = await clearLog();
    await Promise.all(appends);
    // After clear lands, we expect 0 entries OR exactly the entries that
    // appended after clear (none did — clear was scheduled after all 20
    // appends were enqueued, so it runs last on the same lock). The
    // critical invariant is that the file is consistent.
    const after = await loadLog();
    expect(after.length === 0 || after.length === 20 - cleared).toBe(true);
  });
});
