import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
const observerModule = () => import('../observer.js');
const settingsModule = () => import('../settings.js');
const dispatchModule = () => import('../../tool-dispatch.js');
const composerModule = () => import('../../tool-composer.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-sched-'));
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

describe('synthesizer ↔ tool-dispatch integration', () => {
  it('records source: "scheduler" when executeTool is called with source="scheduler"', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    const { executeTool } = await dispatchModule();
    // Use a name that hits the unknown-tool default branch — keeps the test
    // hermetic (no gws subprocess, no Google API).
    await executeTool('__synthesizer_probe_unknown__', { x: 1 }, undefined, 'scheduler');

    const { _flushPendingForTests } = await observerModule();
    await _flushPendingForTests();

    const logFile = path.join(tmpDir, '.tool-invocation-log.default.json');
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].name).toBe('__synthesizer_probe_unknown__');
    expect(parsed.entries[0].source).toBe('scheduler');
  });

  it('records source: "chat" by default', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    const { executeTool } = await dispatchModule();
    await executeTool('__synthesizer_probe_unknown__', { x: 2 });

    const { _flushPendingForTests } = await observerModule();
    await _flushPendingForTests();

    const logFile = path.join(tmpDir, '.tool-invocation-log.default.json');
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].source).toBe('chat');
  });

  it('threads source through tool-composer.executeDynamicTool to the synthesizer hook', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    // Drive the actual scheduler→composer→dispatch path. The step's action
    // resolves through the composer's allowed-action whitelist, then calls
    // the inner executeTool with the threaded source. Without auth, the
    // executeGws path fails fast — but the observer hook fires regardless,
    // which is exactly what we are verifying.
    const { executeDynamicTool } = await composerModule();
    await executeDynamicTool(
      {
        name: '__synthesizer_test_workflow__',
        description: 'integration test',
        parameters: { type: 'object', properties: {} },
        steps: [{ action: 'list_tasks', args: {} }],
      },
      {},
      undefined,
      { source: 'scheduler' },
    );

    const { _flushPendingForTests } = await observerModule();
    await _flushPendingForTests();

    const logFile = path.join(tmpDir, '.tool-invocation-log.default.json');
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    expect(parsed.entries.length).toBeGreaterThanOrEqual(1);
    const stepEntry = parsed.entries.find((e: { name: string }) => e.name === 'list_tasks');
    expect(stepEntry, 'composer should have invoked the inner executeTool').toBeDefined();
    expect(stepEntry.source).toBe('scheduler');
  });

  it('defaults source to "chat" when executeDynamicTool is called without options', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    const { executeDynamicTool } = await composerModule();
    await executeDynamicTool(
      {
        name: '__synthesizer_test_workflow_default__',
        description: 'integration test',
        parameters: { type: 'object', properties: {} },
        steps: [{ action: 'list_tasks', args: {} }],
      },
      {},
    );

    const { _flushPendingForTests } = await observerModule();
    await _flushPendingForTests();

    const logFile = path.join(tmpDir, '.tool-invocation-log.default.json');
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    const stepEntry = parsed.entries.find((e: { name: string }) => e.name === 'list_tasks');
    expect(stepEntry).toBeDefined();
    expect(stepEntry.source).toBe('chat');
  });
});
