import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DynamicToolDef } from '../dynamic-tool-types';
import {
  loadDynamicTools,
  getDynamicTools,
  getDynamicTool,
  hasDynamicTool,
  registerDynamicTool,
  removeDynamicTool,
  updateDynamicTool,
  resetRegistry,
  setFileIO,
  type FileIO,
} from '../dynamic-tool-registry';

// ── In-memory file mock ──────────────────────────────────────────────

function createMockFileIO(): FileIO & { written: string | null } {
  const state = { content: null as string | null, written: null as string | null };
  return {
    get written() { return state.written; },
    exists: vi.fn(() => state.content !== null),
    read: vi.fn(() => state.content ?? ''),
    write: vi.fn((_path: string, data: string) => { state.content = data; state.written = data; }),
    getFilePath: () => '/mock/.dynamic-tools.json',
    // Utility to pre-seed file content for tests
    seed(data: string) { state.content = data; },
  } as FileIO & { written: string | null; seed: (data: string) => void };
}

const sampleTool: DynamicToolDef = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: { type: 'object', properties: {} },
  steps: [{ action: 'list_tasks', args: {} }],
  isWriteTool: false,
  createdAt: '2026-03-17T00:00:00Z',
};

const sampleTool2: DynamicToolDef = {
  name: 'another_tool',
  description: 'Another tool',
  parameters: { type: 'object', properties: {} },
  steps: [{ action: 'search_drive', args: { query: 'test' } }],
  isWriteTool: false,
  createdAt: '2026-03-17T01:00:00Z',
};

let mockIO: ReturnType<typeof createMockFileIO>;

beforeEach(() => {
  mockIO = createMockFileIO();
  setFileIO(mockIO);
  resetRegistry();
});

describe('loadDynamicTools', () => {
  it('should return empty array when no file exists', () => {
    const tools = loadDynamicTools();
    expect(tools).toEqual([]);
  });

  it('should load tools from a valid file', () => {
    (mockIO as any).seed(JSON.stringify({ version: 1, tools: [sampleTool] }));

    const tools = loadDynamicTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test_tool');
  });

  it('should skip invalid entries in the file', () => {
    (mockIO as any).seed(JSON.stringify({
      version: 1,
      tools: [
        sampleTool,
        { invalid: true },
        null,
      ],
    }));

    const tools = loadDynamicTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test_tool');
  });

  it('should return empty array for corrupted JSON', () => {
    (mockIO as any).seed('not valid json {{{');

    const tools = loadDynamicTools();

    expect(tools).toEqual([]);
  });

  it('should return empty array for wrong version', () => {
    (mockIO as any).seed(JSON.stringify({ version: 99, tools: [sampleTool] }));

    const tools = loadDynamicTools();

    expect(tools).toEqual([]);
  });
});

describe('getDynamicTools', () => {
  it('should return all registered tools', () => {
    (mockIO as any).seed(JSON.stringify({ version: 1, tools: [sampleTool, sampleTool2] }));
    loadDynamicTools();

    const tools = getDynamicTools();

    expect(tools).toHaveLength(2);
  });

  it('should return empty array when nothing is loaded', () => {
    expect(getDynamicTools()).toEqual([]);
  });
});

describe('getDynamicTool', () => {
  it('should return a tool by name', () => {
    (mockIO as any).seed(JSON.stringify({ version: 1, tools: [sampleTool] }));
    loadDynamicTools();

    const tool = getDynamicTool('test_tool');

    expect(tool?.name).toBe('test_tool');
  });

  it('should return undefined for non-existent tool', () => {
    expect(getDynamicTool('nonexistent')).toBeUndefined();
  });
});

describe('hasDynamicTool', () => {
  it('should return true for registered tool', () => {
    registerDynamicTool(sampleTool);
    expect(hasDynamicTool('test_tool')).toBe(true);
  });

  it('should return false for non-existent tool', () => {
    expect(hasDynamicTool('nonexistent')).toBe(false);
  });
});

describe('registerDynamicTool', () => {
  it('should register a new tool and persist to disk', () => {
    const result = registerDynamicTool(sampleTool);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('test_tool');
    expect(getDynamicTools()).toHaveLength(1);
    expect(mockIO.write).toHaveBeenCalledOnce();
  });

  it('should set createdAt if not provided', () => {
    const toolWithoutDate = { ...sampleTool, createdAt: '' };
    const result = registerDynamicTool(toolWithoutDate);

    expect(result?.createdAt).toBeTruthy();
    expect(result?.createdAt).not.toBe('');
  });

  it('should reject duplicate tool names', () => {
    registerDynamicTool(sampleTool);
    const result = registerDynamicTool(sampleTool);

    expect(result).toBeNull();
    expect(getDynamicTools()).toHaveLength(1);
  });

  it('should persist all tools including existing ones', () => {
    registerDynamicTool(sampleTool);
    registerDynamicTool(sampleTool2);

    const written = JSON.parse(mockIO.written!);

    expect(written.tools).toHaveLength(2);
    expect(written.version).toBe(1);
  });
});

describe('removeDynamicTool', () => {
  it('should remove a tool by name and persist', () => {
    registerDynamicTool(sampleTool);

    const result = removeDynamicTool('test_tool');

    expect(result).toBe(true);
    expect(getDynamicTools()).toHaveLength(0);
    expect(mockIO.write).toHaveBeenCalledTimes(2); // register + remove
  });

  it('should return false for non-existent tool', () => {
    const result = removeDynamicTool('nonexistent');
    expect(result).toBe(false);
  });
});

describe('updateDynamicTool', () => {
  it('should update an existing tool and persist', () => {
    registerDynamicTool(sampleTool);

    const result = updateDynamicTool('test_tool', { description: 'Updated description' });

    expect(result?.description).toBe('Updated description');
    expect(result?.name).toBe('test_tool');
    expect(result?.createdAt).toBe('2026-03-17T00:00:00Z');
  });

  it('should return null for non-existent tool', () => {
    const result = updateDynamicTool('nonexistent', { description: 'x' });
    expect(result).toBeNull();
  });

  it('should not change other registered tools', () => {
    registerDynamicTool(sampleTool);
    registerDynamicTool(sampleTool2);

    updateDynamicTool('test_tool', { description: 'Changed' });

    const other = getDynamicTool('another_tool');
    expect(other?.description).toBe('Another tool');
  });
});
