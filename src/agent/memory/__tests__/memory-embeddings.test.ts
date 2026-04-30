import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock('../../llm-settings.js', () => ({
  getActiveProviderConfig: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { getActiveProviderConfig } from '../../llm-settings.js';
import fs from 'fs';

// Import module under test AFTER mocks are set up
import {
  cosineSimilarity,
  supportsEmbeddings,
  getEmbeddingModel,
  computeEmbedding,
  initEmbeddingStore,
  loadEmbeddings,
  saveEmbedding,
  flushEmbeddings,
  invalidateEmbeddings,
  beginEmbeddingBatch,
  flushEmbeddingBatch,
} from '../memory-embeddings.js';

const mockGetActiveProviderConfig = vi.mocked(getActiveProviderConfig);
const mockFs = vi.mocked(fs);

// ── Helper factories ─────────────────────────────────────────────────────────

function makeOpenAIConfig() {
  return {
    provider: 'openai' as const,
    apiKey: 'sk-test-key',
    model: 'gpt-4o',
    baseURL: undefined,
  };
}

function makeAnthropicConfig() {
  return {
    provider: 'anthropic' as const,
    apiKey: 'sk-ant-key',
    model: 'claude-3-5-sonnet-20241022',
    baseURL: undefined,
  };
}

function makeOpenRouterConfig() {
  return {
    provider: 'openrouter' as const,
    apiKey: 'sk-or-key',
    model: 'openai/gpt-4o',
    baseURL: 'https://openrouter.ai/api/v1',
  };
}

// ── cosineSimilarity ─────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });

  it('returns 1 for parallel vectors (same direction, different magnitude)', () => {
    const result = cosineSimilarity([2, 0], [4, 0]);
    expect(result).toBeCloseTo(1);
  });

  it('returns -1 for opposite vectors', () => {
    const result = cosineSimilarity([1, 0], [-1, 0]);
    expect(result).toBeCloseTo(-1);
  });

  it('returns 0 for zero-length first vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 for zero-length second vector', () => {
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it('returns correct similarity for non-trivial vectors', () => {
    // [1, 1] and [1, 0] => cos(45°) ≈ 0.707
    const result = cosineSimilarity([1, 1], [1, 0]);
    expect(result).toBeCloseTo(0.707, 2);
  });

  it('handles empty vectors by returning 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

// ── supportsEmbeddings ───────────────────────────────────────────────────────

describe('supportsEmbeddings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true for openai provider', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    expect(supportsEmbeddings()).toBe(true);
  });

  it('returns true for openrouter provider', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenRouterConfig());
    expect(supportsEmbeddings()).toBe(true);
  });

  it('returns false for anthropic provider', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeAnthropicConfig());
    expect(supportsEmbeddings()).toBe(false);
  });

  it('returns false for claude-code provider', () => {
    mockGetActiveProviderConfig.mockReturnValue({
      provider: 'claude-code',
      apiKey: '',
      model: 'claude-3-5-sonnet-20241022',
    });
    expect(supportsEmbeddings()).toBe(false);
  });

  it('returns false for lmstudio provider', () => {
    mockGetActiveProviderConfig.mockReturnValue({
      provider: 'lmstudio',
      apiKey: '',
      model: 'local-model',
      baseURL: 'http://localhost:1234/v1',
    });
    expect(supportsEmbeddings()).toBe(false);
  });

  it('returns false when no config is available', () => {
    mockGetActiveProviderConfig.mockReturnValue(null);
    expect(supportsEmbeddings()).toBe(false);
  });
});

// ── getEmbeddingModel ────────────────────────────────────────────────────────

describe('getEmbeddingModel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns text-embedding-3-small for openai', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    expect(getEmbeddingModel()).toBe('text-embedding-3-small');
  });

  it('returns text-embedding-3-small for openrouter', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenRouterConfig());
    expect(getEmbeddingModel()).toBe('text-embedding-3-small');
  });

  it('returns null for anthropic', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeAnthropicConfig());
    expect(getEmbeddingModel()).toBeNull();
  });

  it('returns null when no config', () => {
    mockGetActiveProviderConfig.mockReturnValue(null);
    expect(getEmbeddingModel()).toBeNull();
  });
});

// ── computeEmbedding ─────────────────────────────────────────────────────────

describe('computeEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns vector of expected dimension when provider supports embeddings', async () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());

    const mockEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await computeEmbedding('test text');

    expect(result).toEqual(mockEmbedding);
    expect(result).toHaveLength(1536);
    expect(mockFetch).toHaveBeenCalledOnce();
    const callArg = mockFetch.mock.calls[0];
    expect(callArg[0]).toContain('/embeddings');
    expect(JSON.parse(callArg[1].body)).toMatchObject({
      model: 'text-embedding-3-small',
      input: 'test text',
    });
  });

  it('returns null when provider does not support embeddings', async () => {
    mockGetActiveProviderConfig.mockReturnValue(makeAnthropicConfig());
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await computeEmbedding('test text');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null on network failure without throwing', async () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await computeEmbedding('test text');

    expect(result).toBeNull();
  });

  it('returns null on non-OK HTTP response without throwing', async () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await computeEmbedding('test text');

    expect(result).toBeNull();
  });

  it('returns null on malformed API response without throwing', async () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'structure' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await computeEmbedding('test text');

    expect(result).toBeNull();
  });

  it('uses openrouter baseURL when configured', async () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenRouterConfig());

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await computeEmbedding('hello');

    expect(mockFetch.mock.calls[0][0]).toContain('openrouter.ai');
  });
});

// ── loadEmbeddings / saveEmbedding / flushEmbeddings ─────────────────────────

describe('embedding file I/O', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset embedding store state by calling init with a test hash
    initEmbeddingStore('testhash123');
  });

  it('loadEmbeddings returns empty object when file does not exist', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    mockFs.existsSync.mockReturnValue(false);

    const result = loadEmbeddings();

    expect(result).toEqual({});
  });

  it('loadEmbeddings returns parsed entries when file exists and model matches', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    const stored = {
      version: 1,
      model: 'text-embedding-3-small',
      entries: { 'mem-1': [0.1, 0.2, 0.3] },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(stored));

    const result = loadEmbeddings();

    expect(result).toEqual({ 'mem-1': [0.1, 0.2, 0.3] });
  });

  it('loadEmbeddings returns empty object when model differs (provider switched)', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    const stored = {
      version: 1,
      model: 'text-embedding-ada-002', // old model
      entries: { 'mem-1': [0.1, 0.2, 0.3] },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(stored));

    const result = loadEmbeddings();

    expect(result).toEqual({});
  });

  it('saveEmbedding writes to separate embeddings file via flushEmbeddings', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    mockFs.existsSync.mockReturnValue(false);

    // Initialize with no existing file
    loadEmbeddings();

    saveEmbedding('mem-1', [0.1, 0.2, 0.3]);
    flushEmbeddings();

    // Should have written the embedding file (not the main memory file)
    expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
    const writtenPath = mockFs.writeFileSync.mock.calls[0][0] as string;
    expect(writtenPath).toContain('embeddings');
    const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.entries['mem-1']).toEqual([0.1, 0.2, 0.3]);
    expect(writtenData.model).toBe('text-embedding-3-small');
    expect(writtenData.version).toBe(1);
  });

  it('saveEmbedding does NOT write to the main memory file', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    mockFs.existsSync.mockReturnValue(false);
    loadEmbeddings();

    saveEmbedding('mem-1', [0.1, 0.2, 0.3]);
    flushEmbeddings();

    // Path must contain "embeddings" and not be the main memory json
    const writtenPath = mockFs.writeFileSync.mock.calls[0][0] as string;
    expect(writtenPath).not.toMatch(/^.*\.memory\/testhash123\.json$/);
    expect(writtenPath).toContain('embeddings');
  });

  it('flushEmbeddings uses compact JSON (no pretty-print)', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    mockFs.existsSync.mockReturnValue(false);
    loadEmbeddings();

    saveEmbedding('mem-1', [0.1, 0.2]);
    flushEmbeddings();

    const writtenData = mockFs.writeFileSync.mock.calls[0][1] as string;
    // Compact JSON has no newlines or indentation
    expect(writtenData).not.toContain('\n');
    expect(writtenData).not.toContain('  ');
  });
});

// ── invalidateEmbeddings ─────────────────────────────────────────────────────

describe('invalidateEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initEmbeddingStore('testhash123');
  });

  it('clears all embeddings when model changes', () => {
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    // Load with some entries
    const stored = {
      version: 1,
      model: 'text-embedding-3-small',
      entries: { 'mem-1': [0.1, 0.2, 0.3], 'mem-2': [0.4, 0.5, 0.6] },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(stored));
    loadEmbeddings();

    // Simulate model change
    invalidateEmbeddings();

    // After invalidation, loadEmbeddings should return empty
    mockFs.existsSync.mockReturnValue(false);
    const result = loadEmbeddings();
    expect(result).toEqual({});
  });
});

// ── beginEmbeddingBatch / flushEmbeddingBatch ────────────────────────────────

describe('embedding batch mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initEmbeddingStore('testhash123');
    mockGetActiveProviderConfig.mockReturnValue(makeOpenAIConfig());
    mockFs.existsSync.mockReturnValue(false);
    loadEmbeddings();
  });

  it('suppresses writes during batch mode', () => {
    beginEmbeddingBatch();
    saveEmbedding('mem-1', [0.1, 0.2, 0.3]);
    saveEmbedding('mem-2', [0.4, 0.5, 0.6]);

    // No writes should have happened yet
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('flushEmbeddingBatch writes all accumulated changes in one call', () => {
    beginEmbeddingBatch();
    saveEmbedding('mem-1', [0.1, 0.2, 0.3]);
    saveEmbedding('mem-2', [0.4, 0.5, 0.6]);
    flushEmbeddingBatch();

    // Exactly one write call
    expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
    const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.entries['mem-1']).toEqual([0.1, 0.2, 0.3]);
    expect(writtenData.entries['mem-2']).toEqual([0.4, 0.5, 0.6]);
  });
});
