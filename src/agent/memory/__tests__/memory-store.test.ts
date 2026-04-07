import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryEntry, MemoryFile } from '../memory-types';
import {
  loadMemories,
  getMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  mergeMemory,
  resetMemoryStore,
  setMemoryFileIO,
  type MemoryFileIO,
} from '../memory-store';

function createMockFileIO(): MemoryFileIO & { written: string | null; seed: (data: string) => void } {
  const state = { content: null as string | null, written: null as string | null };
  return {
    get written() { return state.written; },
    exists: vi.fn(() => state.content !== null),
    read: vi.fn(() => state.content ?? ''),
    write: vi.fn((_path: string, data: string) => { state.content = data; state.written = data; }),
    rename: vi.fn((_oldPath: string, _newPath: string) => {} ),
    getFilePath: () => '/mock/.memory/test-user.json',
    seed(data: string) { state.content = data; },
  } as MemoryFileIO & { written: string | null; seed: (data: string) => void };
}

const sampleEntry: MemoryEntry = {
  id: 'mem-001',
  category: 'resource',
  content: 'Job Applications spreadsheet',
  tags: ['spreadsheet', 'job', 'applications'],
  metadata: { spreadsheetId: 'abc123', url: 'https://docs.google.com/...' },
  resourceIds: ['abc123'],
  source: { type: 'auto_extraction', toolName: 'sheets_create' },
  createdAt: '2026-03-17T00:00:00Z',
  updatedAt: '2026-03-17T00:00:00Z',
  lastAccessedAt: '2026-03-17T00:00:00Z',
  accessCount: 0,
};

const sampleEntry2: MemoryEntry = {
  id: 'mem-002',
  category: 'workflow',
  content: 'User tracks job applications by searching emails',
  tags: ['workflow', 'job', 'email'],
  metadata: {},
  source: { type: 'explicit_user' },
  createdAt: '2026-03-17T01:00:00Z',
  updatedAt: '2026-03-17T01:00:00Z',
  lastAccessedAt: '2026-03-17T01:00:00Z',
  accessCount: 0,
};

let mockIO: ReturnType<typeof createMockFileIO>;

beforeEach(() => {
  mockIO = createMockFileIO();
  setMemoryFileIO(mockIO, 'test-user');
  resetMemoryStore();
});

describe('loadMemories', () => {
  it('should return empty array when no file exists', () => {
    const memories = loadMemories();
    expect(memories).toEqual([]);
  });

  it('should load memories from a valid file', () => {
    const fileData: MemoryFile = { version: 1, entries: [sampleEntry] };
    mockIO.seed(JSON.stringify(fileData));

    const memories = loadMemories();

    expect(memories).toHaveLength(1);
    expect(memories[0].id).toBe('mem-001');
  });

  it('should return empty array for corrupted JSON', () => {
    mockIO.seed('not valid json {{{');

    const memories = loadMemories();
    expect(memories).toEqual([]);
  });

  it('should return empty array for wrong version', () => {
    mockIO.seed(JSON.stringify({ version: 99, entries: [sampleEntry] }));

    const memories = loadMemories();
    expect(memories).toEqual([]);
  });

  it('should skip invalid entries', () => {
    mockIO.seed(JSON.stringify({
      version: 1,
      entries: [
        sampleEntry,
        { invalid: true },
        null,
        sampleEntry2,
      ],
    }));

    const memories = loadMemories();

    expect(memories).toHaveLength(2);
    expect(memories[0].id).toBe('mem-001');
    expect(memories[1].id).toBe('mem-002');
  });
});

describe('getMemories', () => {
  it('should return all loaded memories', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry, sampleEntry2] }));
    loadMemories();

    const memories = getMemories();
    expect(memories).toHaveLength(2);
  });

  it('should return empty array when nothing loaded', () => {
    expect(getMemories()).toEqual([]);
  });
});

describe('getMemory', () => {
  it('should return a memory by id', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry] }));
    loadMemories();

    const memory = getMemory('mem-001');
    expect(memory?.id).toBe('mem-001');
  });

  it('should return undefined for non-existent memory', () => {
    expect(getMemory('nonexistent')).toBeUndefined();
  });
});

describe('createMemory', () => {
  it('should create a new memory with generated id and timestamps', () => {
    const result = createMemory({
      category: 'resource',
      content: 'Test memory',
      tags: ['test'],
      metadata: { key: 'value' },
      source: { type: 'explicit_user' },
    });

    expect(result.id).toBeTruthy();
    expect(result.id).toMatch(/^mem-/);
    expect(result.createdAt).toBeTruthy();
    expect(result.updatedAt).toBeTruthy();
    expect(result.lastAccessedAt).toBeTruthy();
    expect(result.accessCount).toBe(0);
    expect(result.content).toBe('Test memory');
  });

  it('should persist the new memory to disk', () => {
    createMemory({
      category: 'resource',
      content: 'Persisted memory',
      tags: ['persist'],
      metadata: {},
      source: { type: 'auto_extraction' },
    });

    const written = JSON.parse(mockIO.written!);
    expect(written.entries).toHaveLength(1);
    expect(written.version).toBe(1);
  });

  it('should enforce 500 entry limit with LRU eviction', () => {
    // Create 500 entries
    for (let i = 0; i < 500; i++) {
      createMemory({
        category: 'fact',
        content: `Memory ${i}`,
        tags: [`tag${i}`],
        metadata: {},
        source: { type: 'explicit_user' },
      });
    }

    expect(getMemories()).toHaveLength(500);

    // Create one more - should evict oldest (least recently accessed)
    createMemory({
      category: 'fact',
      content: 'Memory 500',
      tags: ['new'],
      metadata: {},
      source: { type: 'explicit_user' },
    });

    const memories = getMemories();
    expect(memories).toHaveLength(500);
    // The first memory 'Memory 0' should be evicted
    expect(memories.find(m => m.content === 'Memory 0')).toBeUndefined();
    expect(memories.find(m => m.content === 'Memory 500')).toBeTruthy();
  });
});

describe('updateMemory', () => {
  it('should update an existing memory', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry] }));
    loadMemories();

    const result = updateMemory('mem-001', { content: 'Updated content' });

    expect(result?.content).toBe('Updated content');
    expect(result?.updatedAt).not.toBe('2026-03-17T00:00:00Z');
  });

  it('should return null for non-existent memory', () => {
    const result = updateMemory('nonexistent', { content: 'x' });
    expect(result).toBeNull();
  });

  it('should persist updated memory to disk', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry] }));
    loadMemories();

    updateMemory('mem-001', { content: 'Updated' });

    const written = JSON.parse(mockIO.written!);
    expect(written.entries[0].content).toBe('Updated');
  });
});

describe('deleteMemory', () => {
  it('should remove a memory by id', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry, sampleEntry2] }));
    loadMemories();

    const result = deleteMemory('mem-001');

    expect(result).toBe(true);
    expect(getMemories()).toHaveLength(1);
    expect(getMemories()[0].id).toBe('mem-002');
  });

  it('should return false for non-existent memory', () => {
    const result = deleteMemory('nonexistent');
    expect(result).toBe(false);
  });

  it('should persist deletion to disk', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry] }));
    loadMemories();

    deleteMemory('mem-001');

    const written = JSON.parse(mockIO.written!);
    expect(written.entries).toHaveLength(0);
  });
});

describe('mergeMemory', () => {
  it('should create new memory if resourceId does not exist', () => {
    const result = mergeMemory({
      category: 'resource',
      content: 'New spreadsheet',
      tags: ['spreadsheet'],
      metadata: { spreadsheetId: 'new-123' },
      resourceIds: ['new-123'],
      source: { type: 'auto_extraction', toolName: 'sheets_create' },
    });

    expect(result.id).toBeTruthy();
    expect(result.resourceIds).toEqual(['new-123']);
  });

  it('should merge with existing memory by resourceId', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [
      {
        ...sampleEntry,
        content: 'Old spreadsheet',
        tags: ['spreadsheet', 'job'],
        metadata: { spreadsheetId: 'abc123', columns: ['A', 'B'] },
      },
    ] }));
    loadMemories();

    const result = mergeMemory({
      category: 'resource',
      content: 'Updated spreadsheet',
      tags: ['spreadsheet', 'applications'],
      metadata: { spreadsheetId: 'abc123', url: 'https://new-url' },
      resourceIds: ['abc123'],
      source: { type: 'auto_extraction', toolName: 'sheets_append' },
    });

    expect(result.id).toBe('mem-001');
    expect(result.content).toBe('Updated spreadsheet');
    expect(result.tags).toContain('job');
    expect(result.tags).toContain('applications');
    expect(result.metadata.url).toBe('https://new-url');
    expect(result.metadata.columns).toEqual(['A', 'B']);
  });

  it('should persist merged memory', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry] }));
    loadMemories();

    mergeMemory({
      category: 'resource',
      content: 'Updated',
      tags: ['test'],
      metadata: {},
      resourceIds: ['abc123'],
      source: { type: 'auto_extraction' },
    });

    const written = JSON.parse(mockIO.written!);
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].content).toBe('Updated');
  });
});

describe('atomic writes', () => {
  it('should use .tmp file and rename for atomic writes', () => {
    createMemory({
      category: 'fact',
      content: 'Test',
      tags: [],
      metadata: {},
      source: { type: 'explicit_user' },
    });

    expect(mockIO.write).toHaveBeenCalled();
    expect(mockIO.rename).toHaveBeenCalled();
  });
});

describe('access tracking', () => {
  it('should track lastAccessedAt and accessCount separately', () => {
    mockIO.seed(JSON.stringify({ version: 1, entries: [sampleEntry] }));
    loadMemories();

    updateMemory('mem-001', { accessCount: 5, lastAccessedAt: '2026-03-17T05:00:00Z' });

    const memory = getMemory('mem-001');
    expect(memory?.accessCount).toBe(5);
    expect(memory?.lastAccessedAt).toBe('2026-03-17T05:00:00Z');
  });
});