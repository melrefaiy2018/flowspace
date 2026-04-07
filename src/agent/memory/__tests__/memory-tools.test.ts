import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryFileIO } from '../memory-store';
import { loadMemories, getMemories, resetMemoryStore, setMemoryFileIO, createMemory } from '../memory-store';
import { retrieveMemories } from '../memory-retriever';

function createMockFileIO(): MemoryFileIO & { written: string | null; seed: (data: string) => void } {
  const state = { content: null as string | null, written: null as string | null };
  return {
    get written() { return state.written; },
    exists: vi.fn(() => state.content !== null),
    read: vi.fn(() => state.content ?? ''),
    write: vi.fn((_path: string, data: string) => { state.content = data; state.written = data; }),
    rename: vi.fn(),
    getFilePath: () => '/mock/.memory/test-user.json',
    seed(data: string) { state.content = data; },
  } as MemoryFileIO & { written: string | null; seed: (data: string) => void };
}

let mockIO: ReturnType<typeof createMockFileIO>;

beforeEach(() => {
  mockIO = createMockFileIO();
  setMemoryFileIO(mockIO, 'test-user');
  resetMemoryStore();
});

describe('save_memory functionality', () => {
  it('should save a new memory', () => {
    loadMemories();
    
    const result = createMemory({
      category: 'fact',
      content: 'User prefers bullet points for standups',
      tags: ['standup', 'format', 'preference'],
      metadata: {},
      source: { type: 'explicit_user' },
    });

    expect(result.id).toBeTruthy();
    expect(result.category).toBe('fact');
    expect(result.content).toBe('User prefers bullet points for standups');
    expect(result.tags).toContain('standup');

    const memories = getMemories();
    expect(memories).toHaveLength(1);
  });

  it('should save with all categories', () => {
    loadMemories();

    const categories = ['resource', 'workflow', 'preference', 'fact'] as const;
    
    for (const category of categories) {
      createMemory({
        category,
        content: `Test ${category}`,
        tags: [category],
        metadata: {},
        source: { type: 'explicit_user' },
      });
    }

    const memories = getMemories();
    expect(memories).toHaveLength(4);
  });

  it('should save with resourceIds', () => {
    loadMemories();

    const result = createMemory({
      category: 'resource',
      content: 'Job Applications spreadsheet',
      tags: ['spreadsheet'],
      metadata: { spreadsheetId: 'abc123' },
      resourceIds: ['abc123'],
      source: { type: 'auto_extraction', toolName: 'sheets_create' },
    });

    expect(result.resourceIds).toEqual(['abc123']);
  });
});

describe('search_memory functionality', () => {
  beforeEach(() => {
    loadMemories();
  });

  it('should return matching memories', () => {
    createMemory({
      category: 'resource',
      content: 'Job Applications spreadsheet',
      tags: ['spreadsheet', 'job', 'applications'],
      metadata: { spreadsheetId: 'abc123' },
      resourceIds: ['abc123'],
      source: { type: 'auto_extraction' },
    });

    createMemory({
      category: 'workflow',
      content: 'Email triage process',
      tags: ['email', 'workflow'],
      metadata: {},
      source: { type: 'explicit_user' },
    });

    const memories = [...getMemories()];
    const results = retrieveMemories('job applications', memories);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.content).toContain('Job Applications');
  });

  it('should return empty array for no matches', () => {
    createMemory({
      category: 'fact',
      content: 'Weekly standup is Monday 10am',
      tags: ['standup', 'calendar'],
      metadata: {},
      source: { type: 'explicit_user' },
    });

    const memories = [...getMemories()];
    const results = retrieveMemories('recipe cooking dinner', memories);

    expect(results).toEqual([]);
  });

  it('should handle empty query gracefully', () => {
    createMemory({
      category: 'fact',
      content: 'Test memory',
      tags: ['test'],
      metadata: {},
      source: { type: 'explicit_user' },
    });

    const memories = [...getMemories()];
    const results = retrieveMemories('', memories);

    expect(Array.isArray(results)).toBe(true);
  });
});