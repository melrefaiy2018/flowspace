import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMemoryFileIO,
  resetMemoryStore,
  mergeMemory,
  beginBatch,
  flushBatch,
  isMemoryInitialized,
} from '../memory-store.js';
import type { MemoryFileIO } from '../memory-store.js';

function makeMockIO(): MemoryFileIO & { writeSpy: ReturnType<typeof vi.fn> } {
  const writeSpy = vi.fn();
  const store: Record<string, string> = {};
  return {
    writeSpy,
    exists: (p: string) => p in store,
    read: (p: string) => store[p] ?? '{}',
    write: (p: string, data: string) => {
      writeSpy(p, data);
      store[p] = data;
    },
    rename: (oldP: string, newP: string) => {
      if (oldP in store) {
        store[newP] = store[oldP];
        delete store[oldP];
      }
    },
    getFilePath: () => '/tmp/test-memory.json',
  };
}

function makeInput(suffix = '') {
  return {
    category: 'fact' as const,
    content: `test memory ${suffix}`,
    tags: ['test'],
    metadata: {},
    source: { type: 'auto_extraction' as const, toolName: 'test' },
  };
}

describe('memory-store batch mode', () => {
  beforeEach(() => {
    resetMemoryStore();
  });

  it('beginBatch + multiple mergeMemory calls → 0 actual disk writes; flushBatch → 1 write with all entries', () => {
    const mockIO = makeMockIO();
    setMemoryFileIO(mockIO, 'testhash');

    beginBatch();
    mergeMemory(makeInput('a'));
    mergeMemory(makeInput('b'));
    mergeMemory(makeInput('c'));

    // No writes yet (only .tmp + rename writes happen, but in batch mode we skip)
    expect(mockIO.writeSpy).not.toHaveBeenCalled();

    flushBatch();

    // After flush, exactly one write should have occurred (atomic: tmp write + rename)
    expect(mockIO.writeSpy).toHaveBeenCalledTimes(1);

    // The written content should contain all three entries
    const [_writtenPath, writtenData] = mockIO.writeSpy.mock.calls[0];
    const parsed = JSON.parse(writtenData as string);
    expect(parsed.entries).toHaveLength(3);
    const contents = parsed.entries.map((e: any) => e.content);
    expect(contents).toContain('test memory a');
    expect(contents).toContain('test memory b');
    expect(contents).toContain('test memory c');
  });

  it('without batch mode, each mergeMemory triggers a write', () => {
    const mockIO = makeMockIO();
    setMemoryFileIO(mockIO, 'testhash');

    mergeMemory(makeInput('a'));
    mergeMemory(makeInput('b'));

    // Each merge should write (1 per merge: write tmp file, then rename)
    expect(mockIO.writeSpy).toHaveBeenCalledTimes(2);
  });

  it('flushBatch with no pending writes is a no-op', () => {
    const mockIO = makeMockIO();
    setMemoryFileIO(mockIO, 'testhash');

    beginBatch();
    flushBatch(); // no operations happened between begin/flush

    expect(mockIO.writeSpy).not.toHaveBeenCalled();
  });

  it('after flushBatch, batch mode is off and subsequent writes are immediate', () => {
    const mockIO = makeMockIO();
    setMemoryFileIO(mockIO, 'testhash');

    beginBatch();
    mergeMemory(makeInput('a'));
    flushBatch();

    const writeCountAfterFlush = mockIO.writeSpy.mock.calls.length;

    // Should write immediately now (batch mode off)
    mergeMemory(makeInput('b'));
    expect(mockIO.writeSpy.mock.calls.length).toBe(writeCountAfterFlush + 1);
  });

  it('batch mode with error path: data is still persisted via flushBatch in finally', () => {
    const mockIO = makeMockIO();
    setMemoryFileIO(mockIO, 'testhash');

    let flushed = false;
    try {
      beginBatch();
      mergeMemory(makeInput('before-error'));
      throw new Error('simulated error');
    } catch {
      // Expected
    } finally {
      flushBatch();
      flushed = true;
    }

    expect(flushed).toBe(true);
    expect(mockIO.writeSpy).toHaveBeenCalledTimes(1);
  });

  it('beginBatch resets pendingWrite flag', () => {
    const mockIO = makeMockIO();
    setMemoryFileIO(mockIO, 'testhash');

    // First batch with writes
    beginBatch();
    mergeMemory(makeInput('x'));
    flushBatch();

    const countAfterFirstFlush = mockIO.writeSpy.mock.calls.length;

    // Second batch with no writes
    beginBatch();
    flushBatch();

    // Should not have written again
    expect(mockIO.writeSpy.mock.calls.length).toBe(countAfterFirstFlush);
  });
});
