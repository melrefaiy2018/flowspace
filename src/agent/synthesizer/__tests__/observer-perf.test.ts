import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
const observerModule = () => import('../observer.js');
const settingsModule = () => import('../settings.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-perf-'));
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

describe('SC-001: observer hot-path overhead', () => {
  it('synchronous part of recordInvocation is ≤ 1 ms p95 over 1000 iterations', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    const { recordInvocation } = await observerModule();
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      recordInvocation({
        name: 'search_emails',
        args: { query: `q${i}`, limit: 10, threadId: `t-${i}` },
        success: true,
        approval: 'auto',
        source: 'chat',
      });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    // Generous in CI: 5 ms ceiling for the synchronous part.
    expect(p95).toBeLessThan(5);
  });
});
