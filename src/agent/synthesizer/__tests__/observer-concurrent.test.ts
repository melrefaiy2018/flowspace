import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
const observerModule = () => import('../observer.js');
const settingsModule = () => import('../settings.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-conc-'));
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

describe('SC-004: invocation log under concurrent writes', () => {
  it('1000 interleaved appends produce a valid file with no corruption', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true, logCapEntries: 10000 });

    const { recordInvocation, _flushPendingForTests } = await observerModule();
    for (let i = 0; i < 1000; i++) {
      const source: 'chat' | 'scheduler' = i % 2 === 0 ? 'chat' : 'scheduler';
      recordInvocation({
        name: source === 'chat' ? 'search_emails' : 'apply_label_to_threads',
        args: { i, q: `value-${i}` },
        success: true,
        approval: 'auto',
        source,
      });
    }
    await _flushPendingForTests();

    const fp = path.join(tmpDir, '.tool-invocation-log.default.json');
    const raw = fs.readFileSync(fp, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();

    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries.length).toBe(1000);

    const filesAfter = fs.readdirSync(tmpDir);
    expect(filesAfter.find((f) => f.endsWith('.tmp'))).toBeUndefined();
  });
});
