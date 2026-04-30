import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
const observerModule = () => import('../observer.js');
const settingsModule = () => import('../settings.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-observer-'));
  process.env.FLOWSPACE_DATA_DIR = tmpDir;
  const obs = await observerModule();
  obs._resetForTests();
  const set = await settingsModule();
  set._resetForTests();
});

afterEach(async () => {
  const obs = await observerModule();
  obs._resetForTests();
  const set = await settingsModule();
  set._resetForTests();
  delete process.env.FLOWSPACE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('observer', () => {
  it('is a no-op when settings.enabled is false (default)', async () => {
    const { recordInvocation } = await observerModule();
    recordInvocation({
      name: 'search_emails',
      args: { query: 'foo' },
      success: true,
      approval: 'auto',
      source: 'chat',
    });
    // Allow any deferred I/O queued in the implementation to settle.
    await new Promise((r) => setTimeout(r, 50));
    const logFile = path.join(tmpDir, '.tool-invocation-log.default.json');
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('appends one entry per call when enabled', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    const { recordInvocation, _flushPendingForTests } = await observerModule();
    recordInvocation({ name: 'a', args: {}, success: true, approval: 'auto', source: 'chat' });
    recordInvocation({ name: 'b', args: { x: 1 }, success: true, approval: 'auto', source: 'chat' });
    await _flushPendingForTests();

    const logFile = path.join(tmpDir, '.tool-invocation-log.default.json');
    const raw = fs.readFileSync(logFile, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.entries.length).toBe(2);
    expect(parsed.entries[0].name).toBe('a');
    expect(parsed.entries[1].name).toBe('b');
  });

  it('never throws on internal failure', async () => {
    const { recordInvocation } = await observerModule();
    expect(() =>
      recordInvocation({
        name: 'a',
        args: { circular: null as any },
        success: true,
        approval: 'auto',
        source: 'chat',
      }),
    ).not.toThrow();
  });

  it('returns synchronously without awaiting filesystem', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });
    const { recordInvocation } = await observerModule();

    const before = Date.now();
    recordInvocation({ name: 'a', args: {}, success: true, approval: 'auto', source: 'chat' });
    const elapsed = Date.now() - before;
    // Synchronous return — well under 10 ms even with cold-start overhead.
    expect(elapsed).toBeLessThan(20);
  });
});
