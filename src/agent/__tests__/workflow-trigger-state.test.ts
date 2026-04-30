import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;

const stateModule = () => import('../workflow-trigger-state.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-trigger-state-'));
  process.env.FLOWSPACE_DATA_DIR = tmpDir;
  const mod = await stateModule();
  mod._resetCacheForTests();
});

afterEach(async () => {
  const mod = await stateModule();
  mod._resetCacheForTests();
  delete process.env.FLOWSPACE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('workflow-trigger-state', () => {
  it('returns default state when file does not exist', async () => {
    const { loadTriggerState } = await stateModule();
    const state = await loadTriggerState();
    expect(state).toEqual({
      version: 1,
      processedIds: {},
      lastPollAt: {},
      failures: {},
    });
  });

  it('returns parsed state when file exists and is valid', async () => {
    const { saveTriggerState, loadTriggerState } = await stateModule();
    const state = {
      version: 1 as const,
      processedIds: { wf1: ['id1'] },
      lastPollAt: { wf1: 1234 },
      failures: {},
    };
    await saveTriggerState(state);
    const loaded = await loadTriggerState();
    expect(loaded.processedIds.wf1).toEqual(['id1']);
  });

  it('returns default state when file exists but JSON is malformed', async () => {
    const filePath = path.join(tmpDir, '.workflow-trigger-state.json');
    fs.writeFileSync(filePath, 'not valid json{');
    const { loadTriggerState, _resetCacheForTests } = await stateModule();
    _resetCacheForTests();
    const state = await loadTriggerState();
    expect(state.version).toBe(1);
    expect(state.processedIds).toEqual({});
  });

  it('returns default state when file exists but version is not 1', async () => {
    const filePath = path.join(tmpDir, '.workflow-trigger-state.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: 2, processedIds: {}, lastPollAt: {}, failures: {} }));
    const { loadTriggerState, _resetCacheForTests } = await stateModule();
    _resetCacheForTests();
    const state = await loadTriggerState();
    expect(state.version).toBe(1);
    expect(state.processedIds).toEqual({});
  });

  it('markProcessed appends IDs and caps at 500', async () => {
    const { markProcessed, loadTriggerState } = await stateModule();
    await markProcessed('wf1', ['id1', 'id2']);
    await markProcessed('wf1', ['id3']);
    const state = await loadTriggerState();
    expect(state.processedIds.wf1).toEqual(['id1', 'id2', 'id3']);
  });

  it('markProcessed caps array at 500 entries', async () => {
    const { markProcessed, loadTriggerState, _resetCacheForTests } = await stateModule();
    const ids = Array.from({ length: 600 }, (_, i) => `id_${i}`);
    await markProcessed('wf1', ids);
    _resetCacheForTests();
    const state = await loadTriggerState();
    expect(state.processedIds.wf1!.length).toBe(500);
    expect(state.processedIds.wf1![0]).toBe('id_100');
    expect(state.processedIds.wf1![499]).toBe('id_599');
  });

  it('isProcessed returns true for known IDs, false for unknown', async () => {
    const { markProcessed, isProcessed } = await stateModule();
    await markProcessed('wf1', ['id1', 'id2']);
    expect(await isProcessed('wf1', 'id1')).toBe(true);
    expect(await isProcessed('wf1', 'id2')).toBe(true);
    expect(await isProcessed('wf1', 'id99')).toBe(false);
  });

  it('recordFailure appends to failures and caps at 20', async () => {
    const { recordFailure, loadTriggerState, _resetCacheForTests } = await stateModule();
    for (let i = 0; i < 25; i++) {
      await recordFailure('wf1', { messageId: `m${i}`, failedAt: i, error: `err${i}` });
    }
    _resetCacheForTests();
    const state = await loadTriggerState();
    expect(state.failures.wf1!.length).toBe(20);
    expect(state.failures.wf1![0].messageId).toBe('m5');
    expect(state.failures.wf1![19].messageId).toBe('m24');
  });

  it('clearFailures empties failures for a workflow', async () => {
    const { recordFailure, clearFailures, loadTriggerState, _resetCacheForTests } = await stateModule();
    await recordFailure('wf1', { messageId: 'm1', failedAt: 1, error: 'boom' });
    await clearFailures('wf1');
    _resetCacheForTests();
    const state = await loadTriggerState();
    expect(state.failures.wf1).toEqual([]);
  });

  it('clearFailureForMessage removes only failures matching messageId', async () => {
    const { recordFailure, clearFailureForMessage, loadTriggerState, _resetCacheForTests } = await stateModule();
    await recordFailure('wf1', { messageId: 'm1', failedAt: 1, error: 'e1' });
    await recordFailure('wf1', { messageId: 'm2', failedAt: 2, error: 'e2' });
    await recordFailure('wf1', { messageId: 'm1', failedAt: 3, error: 'e1-again' });
    await clearFailureForMessage('wf1', 'm1');
    _resetCacheForTests();
    const state = await loadTriggerState();
    expect(state.failures.wf1!.length).toBe(1);
    expect(state.failures.wf1![0].messageId).toBe('m2');
  });

  it('clearFailureForMessage is a no-op when messageId is not present', async () => {
    const { recordFailure, clearFailureForMessage, loadTriggerState, _resetCacheForTests } = await stateModule();
    await recordFailure('wf1', { messageId: 'm1', failedAt: 1, error: 'e1' });
    await clearFailureForMessage('wf1', 'm99');
    _resetCacheForTests();
    const state = await loadTriggerState();
    expect(state.failures.wf1!.length).toBe(1);
  });

  it('saveTriggerState writes atomically (tmp file then rename)', async () => {
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile');
    const renameSpy = vi.spyOn(fs.promises, 'rename');
    const { saveTriggerState } = await stateModule();
    await saveTriggerState({
      version: 1,
      processedIds: {},
      lastPollAt: {},
      failures: {},
    });
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('.workflow-trigger-state.json.tmp'),
      expect.any(String),
      'utf-8',
    );
    expect(renameSpy).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      expect.not.stringContaining('.tmp'),
    );
    writeFileSpy.mockRestore();
    renameSpy.mockRestore();
  });
});
