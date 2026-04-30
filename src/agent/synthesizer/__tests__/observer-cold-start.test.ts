import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DEFAULT_SYNTHESIS_SETTINGS } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-cold-'));
  process.env.FLOWSPACE_DATA_DIR = tmpDir;
  // Pre-seed an enabled settings file on disk before any synthesizer
  // module is imported. This simulates a process restart where the user
  // had enabled the flag in a prior session.
  fs.writeFileSync(
    path.join(tmpDir, '.synthesizer-settings.default.json'),
    JSON.stringify({ version: 1, settings: { ...DEFAULT_SYNTHESIS_SETTINGS, enabled: true } }),
  );
});

afterEach(() => {
  delete process.env.FLOWSPACE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('observer cold-start race (first-dispatch-after-restart)', () => {
  it('records the very first dispatch when flag was enabled on disk', async () => {
    // vi.resetModules ensures we get a fresh module graph for this test —
    // simulating a brand-new process where settings hydration is still
    // pending when the first dispatch fires.
    const { default: vi } = { default: (await import('vitest')).vi };
    vi.resetModules();

    const observer = await import('../observer.js');
    observer.recordInvocation({
      name: 'first_dispatch_after_restart',
      args: { foo: 'bar' },
      success: true,
      approval: 'auto',
      source: 'chat',
    });
    await observer._flushPendingForTests();

    const logFile = path.join(tmpDir, '.tool-invocation-log.default.json');
    expect(fs.existsSync(logFile), 'log file must exist after first dispatch').toBe(true);
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].name).toBe('first_dispatch_after_restart');
  });
});
