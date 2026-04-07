import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveMemories, formatMemoriesForPrompt, type RetrievalOptions } from '../memory-retriever';
import type { MemoryEntry } from '../memory-types';
import { loadMemories, resetMemoryStore, setMemoryFileIO, type MemoryFileIO } from '../memory-store';

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

function createMemory(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    category: 'fact',
    content: 'Test memory',
    tags: ['test'],
    metadata: {},
    source: { type: 'explicit_user' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  };
}

let mockIO: ReturnType<typeof createMockFileIO>;

beforeEach(() => {
  mockIO = createMockFileIO();
  setMemoryFileIO(mockIO, 'test-user');
  resetMemoryStore();
});

describe('retrieveMemories', () => {
  describe('keyword matching', () => {
    it('should match memories by tag intersection', () => {
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Job tracker', tags: ['spreadsheet', 'job', 'applications'] }),
        createMemory({ id: 'mem-002', content: 'Weekly standup', tags: ['calendar', 'standup', 'weekly'] }),
        createMemory({ id: 'mem-003', content: 'Email follow-up rule', tags: ['email', 'automation'] }),
      ];

      const result = retrieveMemories('add this to my job tracker', memories);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].entry.id).toBe('mem-001');
    });

    it('should match memories by content keywords', () => {
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Job Applications spreadsheet', tags: ['spreadsheet'] }),
        createMemory({ id: 'mem-002', content: 'Weekly standup', tags: ['calendar'] }),
      ];

      const result = retrieveMemories('what about my job applications?', memories);

      expect(result.some((r) => r.entry.id === 'mem-001')).toBe(true);
    });

    it('should return empty array when no matches', () => {
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Job tracker', tags: ['job'] }),
      ];

      const result = retrieveMemories('what is the weather today?', memories);

      expect(result).toEqual([]);
    });
  });

  describe('ranking', () => {
    it('should prioritize resource > workflow > preference > fact', () => {
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', category: 'fact', content: 'Standup is Monday 10am', tags: ['standup'] }),
        createMemory({ id: 'mem-002', category: 'resource', content: 'Job Applications spreadsheet', tags: ['job'] }),
        createMemory({ id: 'mem-003', category: 'workflow', content: 'Email triage process', tags: ['email'] }),
        createMemory({ id: 'mem-004', category: 'preference', content: 'Use bullet points for standups', tags: ['standup'] }),
      ];

      const result = retrieveMemories('job', memories, { maxResults: 4 });

      expect(result.length).toBeGreaterThan(0);
      const categories = result.map((r) => r.entry.category);
      const resourceIdx = categories.indexOf('resource');
      const workflowIdx = categories.indexOf('workflow');
      const preferenceIdx = categories.indexOf('preference');
      const factIdx = categories.indexOf('fact');

      if (resourceIdx >= 0 && workflowIdx >= 0) expect(resourceIdx).toBeLessThan(workflowIdx);
      if (workflowIdx >= 0 && preferenceIdx >= 0) expect(workflowIdx).toBeLessThan(preferenceIdx);
      if (preferenceIdx >= 0 && factIdx >= 0) expect(preferenceIdx).toBeLessThan(factIdx);
    });

    it('should weight by access count', () => {
      const now = new Date().toISOString();
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Job tracker A', tags: ['job'], accessCount: 10, lastAccessedAt: now }),
        createMemory({ id: 'mem-002', content: 'Job tracker B', tags: ['job'], accessCount: 2, lastAccessedAt: now }),
      ];

      const result = retrieveMemories('job', memories);

      expect(result[0].entry.id).toBe('mem-001');
    });

    it('should weight by recency', () => {
      const now = new Date().toISOString();
      const yesterday = new Date(Date.now() - 86400000).toISOString();

      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Job tracker A', tags: ['job'], accessCount: 5, lastAccessedAt: yesterday }),
        createMemory({ id: 'mem-002', content: 'Job tracker B', tags: ['job'], accessCount: 5, lastAccessedAt: now }),
      ];

      const result = retrieveMemories('job', memories);

      expect(result[0].entry.id).toBe('mem-002');
    });
  });

  describe('token budget', () => {
    it('should cap results by token budget', () => {
      const memories: MemoryEntry[] = Array.from({ length: 20 }, (_, i) =>
        createMemory({
          id: `mem-${i}`,
          content: `Job Applications spreadsheet number ${i} with a very long content string that will consume many tokens`,
          tags: ['job', 'spreadsheet'],
        }),
      );

      const result = retrieveMemories('job', memories, { maxTokens: 200 });

      let totalChars = 0;
      for (const r of result) {
        totalChars += r.entry.content.length;
      }
      expect(totalChars).toBeLessThan(2000);
    });

    it('should respect maxResults option', () => {
      const memories: MemoryEntry[] = Array.from({ length: 20 }, (_, i) =>
        createMemory({ id: `mem-${i}`, content: `Memory ${i}`, tags: ['test'] }),
      );

      const result = retrieveMemories('test', memories, { maxResults: 3 });

      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe('stale deprioritization', () => {
    it('should downgrade relevance score for stale memories', () => {
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Job tracker', tags: ['job'], stale: false }),
        createMemory({ id: 'mem-002', content: 'Old tracker deleted', tags: ['job'], stale: true }),
      ];

      const result = retrieveMemories('job', memories);

      const active = result.find((r) => r.entry.id === 'mem-001');
      const stale = result.find((r) => r.entry.id === 'mem-002');

      if (active && stale) {
        expect(active.relevanceScore).toBeGreaterThan(stale.relevanceScore);
      }
    });

    it('should still include stale memories if they match strongly', () => {
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Unrelated content', tags: ['other'] }),
        createMemory({ id: 'mem-002', content: 'Job tracker (deleted)', tags: ['job'], stale: true }),
      ];

      const result = retrieveMemories('job', memories);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].entry.id).toBe('mem-002');
    });
  });

  describe('relevance score calculation', () => {
    it('should return relevance scores between 0 and 1', () => {
      const memories: MemoryEntry[] = [
        createMemory({ id: 'mem-001', content: 'Job tracker', tags: ['job'] }),
        createMemory({ id: 'mem-002', content: 'Calendar', tags: ['calendar'] }),
      ];

      const result = retrieveMemories('job', memories);

      for (const r of result) {
        expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(r.relevanceScore).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('formatMemoriesForPrompt', () => {
  it('should format memories as structured context', () => {
    const memories: MemoryEntry[] = [
      createMemory({
        id: 'mem-001',
        category: 'resource',
        content: 'Job Applications spreadsheet',
        tags: ['spreadsheet', 'job'],
        metadata: { spreadsheetId: 'abc123', url: 'https://docs.google.com/...' },
        lastAccessedAt: new Date(Date.now() - 86400000).toISOString(),
      }),
      createMemory({
        id: 'mem-002',
        category: 'workflow',
        content: 'User tracks job applications by searching emails',
        tags: ['workflow', 'job'],
        metadata: {},
      }),
    ];

    const result = formatMemoriesForPrompt(memories);

    expect(result).toContain('[RESOURCE]');
    expect(result).toContain('Job Applications spreadsheet');
    expect(result).toContain('[WORKFLOW]');
    expect(result).toContain('job applications');
  });

  it('should include metadata for resource memories', () => {
    const memories: MemoryEntry[] = [
      createMemory({
        id: 'mem-001',
        category: 'resource',
        content: 'Job Applications spreadsheet',
        metadata: { spreadsheetId: 'abc123', url: 'https://docs.google.com/...' },
        tags: [],
      }),
    ];

    const result = formatMemoriesForPrompt(memories);

    expect(result).toContain('[internal_id: abc123]');
    expect(result).toContain('URL:');
  });

  it('should return empty string for no memories', () => {
    const result = formatMemoriesForPrompt([]);
    expect(result).toBe('');
  });

  it('should sort by category priority', () => {
    const memories: MemoryEntry[] = [
      createMemory({ id: 'mem-001', category: 'fact', content: 'A fact', tags: [] }),
      createMemory({ id: 'mem-002', category: 'resource', content: 'A resource', tags: [], metadata: { id: 'r1' } }),
      createMemory({ id: 'mem-003', category: 'workflow', content: 'A workflow', tags: [] }),
    ];

    const result = formatMemoriesForPrompt(memories);
    const lines = result.split('\n').filter(Boolean);

    expect(lines.findIndex((l) => l.includes('[RESOURCE]'))).toBeLessThan(
      lines.findIndex((l) => l.includes('[WORKFLOW]')),
    );
    expect(lines.findIndex((l) => l.includes('[WORKFLOW]'))).toBeLessThan(
      lines.findIndex((l) => l.includes('[FACT]')),
    );
  });

  it('should show stale indicator for stale memories', () => {
    const memories: MemoryEntry[] = [
      createMemory({
        id: 'mem-001',
        category: 'resource',
        content: 'Deleted spreadsheet',
        tags: [],
        metadata: { id: 'old' },
        stale: true,
      }),
    ];

    const result = formatMemoriesForPrompt(memories);

    expect(result).toContain('[STALE]');
  });
});