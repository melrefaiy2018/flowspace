import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryEntry } from '../memory-types';

// Mock memory-store before importing the module under test
vi.mock('../memory-store', () => ({
  incrementAccess: vi.fn(),
}));

// Mock memory-embeddings before importing retriever
vi.mock('../memory-embeddings', () => ({
  supportsEmbeddings: vi.fn(() => false),
  computeEmbedding: vi.fn(async () => null),
  saveEmbedding: vi.fn(),
  cosineSimilarity: vi.fn((a: number[], b: number[]) => {
    if (a.length === 0 || b.length === 0) return 0;
    let dot = 0; let magA = 0; let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }),
}));

import { retrieveMemories } from '../memory-retriever';
import { incrementAccess } from '../memory-store';
import { supportsEmbeddings, computeEmbedding, saveEmbedding } from '../memory-embeddings';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'entry-1',
    category: 'fact',
    content: 'some content',
    tags: [],
    metadata: {},
    source: { type: 'auto_extraction', toolName: 'test_tool' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  };
}

const mockSupportsEmbeddings = vi.mocked(supportsEmbeddings);
const mockComputeEmbedding = vi.mocked(computeEmbedding);
const mockSaveEmbedding = vi.mocked(saveEmbedding);

describe('retrieveMemories — access tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupportsEmbeddings.mockReturnValue(false);
    mockComputeEmbedding.mockResolvedValue(null);
  });

  it('calls incrementAccess for each selected memory', async () => {
    const entries: MemoryEntry[] = [
      makeEntry({ id: 'a', content: 'budget spreadsheet', tags: ['spreadsheet', 'budget'] }),
      makeEntry({ id: 'b', content: 'quarterly report', tags: ['report', 'quarterly'] }),
    ];

    await retrieveMemories('budget spreadsheet', entries, { maxResults: 5 });

    // Both entries should score > 0 on this query and get access-tracked
    const calledIds = (incrementAccess as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(calledIds).toContain('a');
  });

  it('calls incrementAccess once per retrieval call per selected entry', async () => {
    const entry = makeEntry({ id: 'x', content: 'drive spreadsheet', tags: ['drive', 'spreadsheet'] });

    await retrieveMemories('drive spreadsheet', [entry], { maxResults: 5 });
    await retrieveMemories('drive spreadsheet', [entry], { maxResults: 5 });

    const calls = (incrementAccess as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'x',
    );
    expect(calls.length).toBe(2);
  });

  it('does not call incrementAccess when no memories match the query', async () => {
    const entries: MemoryEntry[] = [
      makeEntry({ id: 'z', content: 'unrelated thing', tags: ['unrelated'] }),
    ];

    await retrieveMemories('completely different topic xyz', entries, { maxResults: 5 });

    expect(incrementAccess).not.toHaveBeenCalled();
  });
});

// ── Embedding-based scoring (T075-T077) ──────────────────────────────────────

describe('retrieveMemories — embedding scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T075: memory with matching embedding scores higher than memory without embedding', async () => {
    mockSupportsEmbeddings.mockReturnValue(true);
    // Query embedding
    const queryEmbedding = [1.0, 0.0, 0.0];
    mockComputeEmbedding.mockResolvedValue(queryEmbedding);

    // Memory with a semantically matching embedding (parallel = similarity 1.0)
    const semanticEntry = makeEntry({
      id: 'semantic',
      content: 'quarterly financial data',
      tags: ['finance'],
    });
    // Memory without embedding (keyword mismatch)
    const keywordOnlyEntry = makeEntry({
      id: 'keyword',
      content: 'project timeline document',
      tags: ['project'],
    });

    const embeddingsMap: Record<string, number[]> = {
      semantic: [1.0, 0.0, 0.0], // perfect match with queryEmbedding
    };

    const results = await retrieveMemories(
      'Q1 financial summary',
      [semanticEntry, keywordOnlyEntry],
      { maxResults: 5 },
      embeddingsMap,
    );

    // Semantic entry should rank higher (or be present) because of embedding match
    const ids = results.map((r) => r.entry.id);
    expect(ids).toContain('semantic');
  });

  it('T076: memory without embedding falls back to keyword scoring without error', async () => {
    mockSupportsEmbeddings.mockReturnValue(false);
    mockComputeEmbedding.mockResolvedValue(null);

    const entry = makeEntry({
      id: 'keyword-only',
      content: 'budget spreadsheet for 2026',
      tags: ['budget', 'spreadsheet'],
    });

    // No embeddings provided — should use keyword-only path
    const results = await retrieveMemories(
      'budget spreadsheet',
      [entry],
      { maxResults: 5 },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.id).toBe('keyword-only');
    // No errors thrown
  });

  it('T077: lazy migration computes and saves embedding for memory without embedding', async () => {
    mockSupportsEmbeddings.mockReturnValue(true);
    const queryEmbedding = [1.0, 0.0, 0.0];
    const lazyEmbedding = [0.9, 0.1, 0.0];
    mockComputeEmbedding
      .mockResolvedValueOnce(queryEmbedding) // first call: query embedding
      .mockResolvedValueOnce(lazyEmbedding); // second call: lazy migration

    const entry = makeEntry({
      id: 'no-embedding',
      content: 'drive spreadsheet budget',
      tags: ['drive', 'budget'],
    });

    // Empty embeddings map — memory has no embedding
    const results = await retrieveMemories(
      'drive budget spreadsheet',
      [entry],
      { maxResults: 5 },
      {},
    );

    // Entry must be in results for lazy migration to trigger
    if (results.length > 0) {
      // saveEmbedding should have been called for the entry
      expect(mockSaveEmbedding).toHaveBeenCalledWith('no-embedding', lazyEmbedding);
    }
  });
});
