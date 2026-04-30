import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
const observerModule = () => import('../observer.js');
const settingsModule = () => import('../settings.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-flag-'));
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

async function readLogEntries(): Promise<unknown[]> {
  const fp = path.join(tmpDir, '.tool-invocation-log.default.json');
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, 'utf-8')).entries;
}

describe('observer flag flips', () => {
  it('on→off stops new appends within one dispatch (SC-005)', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    const { recordInvocation, _flushPendingForTests } = await observerModule();
    recordInvocation({ name: 'first', args: {}, success: true, approval: 'auto', source: 'chat' });
    await _flushPendingForTests();
    expect((await readLogEntries()).length).toBe(1);

    await updateSettings({ enabled: false });
    recordInvocation({ name: 'second', args: {}, success: true, approval: 'auto', source: 'chat' });
    await _flushPendingForTests();
    expect((await readLogEntries()).length).toBe(1);
  });

  it('off→on resumes appends within one dispatch', async () => {
    const { updateSettings } = await settingsModule();
    // Default is disabled; do an initial recording to confirm no-op.
    const { recordInvocation, _flushPendingForTests } = await observerModule();
    recordInvocation({ name: 'first', args: {}, success: true, approval: 'auto', source: 'chat' });
    await _flushPendingForTests();
    expect((await readLogEntries()).length).toBe(0);

    await updateSettings({ enabled: true });
    recordInvocation({ name: 'second', args: {}, success: true, approval: 'auto', source: 'chat' });
    await _flushPendingForTests();
    const entries = await readLogEntries();
    expect(entries.length).toBe(1);
    expect((entries[0] as { name: string }).name).toBe('second');
  });
});
