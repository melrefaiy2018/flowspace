import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DynamicToolDef } from '../dynamic-tool-types';

// Mock executeTool from tools.ts so we don't call real Google APIs
vi.mock('../tools.js', () => ({
  executeTool: vi.fn(),
}));

// Import after mock setup
import { validateDynamicTool, executeDynamicTool, interpolate } from '../tool-composer';
import { executeTool } from '../tools.js';

const mockedExecuteTool = vi.mocked(executeTool);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── validateDynamicTool ──────────────────────────────────────────────

describe('validateDynamicTool', () => {
  const baseTool: DynamicToolDef = {
    name: 'valid_tool',
    description: 'A valid tool',
    parameters: { type: 'object', properties: {} },
    steps: [{ action: 'list_tasks', args: {} }],
    isWriteTool: false,
    createdAt: '2026-03-17T00:00:00Z',
  };

  it('should return null for a valid tool', () => {
    expect(validateDynamicTool(baseTool)).toBeNull();
  });

  it('should reject empty name', () => {
    const tool = { ...baseTool, name: '' };
    expect(validateDynamicTool(tool)).toContain('name');
  });

  it('should reject names with uppercase letters', () => {
    const tool = { ...baseTool, name: 'MyTool' };
    expect(validateDynamicTool(tool)).toContain('lowercase');
  });

  it('should reject names starting with a number', () => {
    const tool = { ...baseTool, name: '1tool' };
    expect(validateDynamicTool(tool)).not.toBeNull();
  });

  it('should reject names with special characters', () => {
    const tool = { ...baseTool, name: 'my-tool' };
    expect(validateDynamicTool(tool)).not.toBeNull();
  });

  it('should accept names with underscores', () => {
    const tool = { ...baseTool, name: 'my_custom_tool' };
    expect(validateDynamicTool(tool)).toBeNull();
  });

  it('should reject tools with zero steps', () => {
    const tool = { ...baseTool, steps: [] };
    expect(validateDynamicTool(tool)).toContain('at least one step');
  });

  it('should reject tools with more than 10 steps', () => {
    const steps = Array.from({ length: 11 }, () => ({ action: 'list_tasks', args: {} }));
    const tool = { ...baseTool, steps };
    expect(validateDynamicTool(tool)).toContain('10');
  });

  it('should reject steps referencing unknown actions', () => {
    const tool = { ...baseTool, steps: [{ action: 'nonexistent_tool', args: {} }] };
    const error = validateDynamicTool(tool);
    expect(error).toContain('unknown action');
    expect(error).toContain('nonexistent_tool');
  });

  it('should accept all known static tool actions', () => {
    const knownTools = [
      'search_drive', 'list_drive_files', 'create_drive_folder',
      'send_email', 'search_emails', 'read_email',
      'create_calendar_event', 'list_calendar_events',
      'create_task', 'list_tasks', 'sheets_create', 'sheets_read',
    ];
    for (const action of knownTools) {
      const tool = { ...baseTool, steps: [{ action, args: {} }] };
      expect(validateDynamicTool(tool)).toBeNull();
    }
  });
});

// ── interpolate ──────────────────────────────────────────────────────

describe('interpolate', () => {
  it('should resolve {{input.paramName}} from input context', () => {
    const result = interpolate('Hello {{input.name}}!', {
      input: { name: 'World' },
      steps: [],
    });
    expect(result).toBe('Hello World!');
  });

  it('should resolve multiple input references', () => {
    const result = interpolate('{{input.first}} {{input.last}}', {
      input: { first: 'John', last: 'Doe' },
      steps: [],
    });
    expect(result).toBe('John Doe');
  });

  it('should resolve {{steps.N.field}} from step results', () => {
    const result = interpolate('ID: {{steps.0.spreadsheetId}}', {
      input: {},
      steps: [{ spreadsheetId: 'abc123' }],
    });
    expect(result).toBe('ID: abc123');
  });

  it('should resolve nested step fields via dot path', () => {
    const result = interpolate('Title: {{steps.0.properties.title}}', {
      input: {},
      steps: [{ properties: { title: 'My Sheet' } }],
    });
    expect(result).toBe('Title: My Sheet');
  });

  it('should resolve references to later steps', () => {
    const result = interpolate('{{steps.1.id}}', {
      input: {},
      steps: [{ id: 'first' }, { id: 'second' }],
    });
    expect(result).toBe('second');
  });

  it('should return empty string for missing input fields', () => {
    const result = interpolate('{{input.missing}}', {
      input: {},
      steps: [],
    });
    expect(result).toBe('');
  });

  it('should return empty string for out-of-bounds step index', () => {
    const result = interpolate('{{steps.5.id}}', {
      input: {},
      steps: [],
    });
    expect(result).toBe('');
  });

  it('should return empty string for null step result', () => {
    const result = interpolate('{{steps.0.id}}', {
      input: {},
      steps: [null],
    });
    expect(result).toBe('');
  });

  it('should leave non-template text unchanged', () => {
    const result = interpolate('plain text', {
      input: {},
      steps: [],
    });
    expect(result).toBe('plain text');
  });

  it('should handle mixed templates and static text', () => {
    const result = interpolate('Sheet "{{input.title}}" created with id={{steps.0.id}}', {
      input: { title: 'Budget' },
      steps: [{ id: 'xyz' }],
    });
    expect(result).toBe('Sheet "Budget" created with id=xyz');
  });

  it('should handle unknown template prefixes as empty', () => {
    const result = interpolate('{{unknown.foo}}', {
      input: {},
      steps: [],
    });
    expect(result).toBe('');
  });
});

// ── executeDynamicTool ───────────────────────────────────────────────

describe('executeDynamicTool', () => {
  it('should execute a single-step tool and return its output', async () => {
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ items: [{ title: 'Task 1' }] }));

    const tool: DynamicToolDef = {
      name: 'list_my_tasks',
      description: 'List tasks',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    };

    const result = await executeDynamicTool(tool, {});

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].action).toBe('list_tasks');
    expect(result.stepResults[0].success).toBe(true);
    expect(mockedExecuteTool).toHaveBeenCalledWith('list_tasks', {}, undefined);
  });

  it('should interpolate input args into step arguments', async () => {
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ spreadsheetId: 'new123' }));

    const tool: DynamicToolDef = {
      name: 'create_sheet',
      description: 'Create a sheet',
      parameters: { type: 'object', properties: { title: { type: 'string' } } },
      steps: [
        { action: 'sheets_create', args: { title: '{{input.title}}' }, outputKey: 'sheet' },
      ],
      isWriteTool: true,
      createdAt: '2026-03-17T00:00:00Z',
    };

    await executeDynamicTool(tool, { title: 'Expenses Q1' });

    expect(mockedExecuteTool).toHaveBeenCalledWith(
      'sheets_create',
      { title: 'Expenses Q1' },
      undefined,
    );
  });

  it('should chain step outputs via {{steps.N.field}} references', async () => {
    // Step 0: create spreadsheet → returns { spreadsheetId: 'abc' }
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ spreadsheetId: 'abc', properties: { title: 'Test' } }));
    // Step 1: append data to that spreadsheet
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ updatedCells: 3 }));

    const tool: DynamicToolDef = {
      name: 'create_and_populate',
      description: 'Create and populate a sheet',
      parameters: { type: 'object', properties: { title: { type: 'string' } } },
      steps: [
        { action: 'sheets_create', args: { title: '{{input.title}}' }, outputKey: 'created' },
        { action: 'sheets_append', args: { spreadsheet_id: '{{steps.0.spreadsheetId}}', values: '[["A","B"]]' } },
      ],
      isWriteTool: true,
      createdAt: '2026-03-17T00:00:00Z',
    };

    const result = await executeDynamicTool(tool, { title: 'Test' });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(mockedExecuteTool).toHaveBeenNthCalledWith(
      2,
      'sheets_append',
      { spreadsheet_id: 'abc', values: '[["A","B"]]' },
      undefined,
    );
  });

  it('should stop and report failure when a step returns an error', async () => {
    mockedExecuteTool.mockResolvedValueOnce('Error: File not found');

    const tool: DynamicToolDef = {
      name: 'failing_tool',
      description: 'Will fail',
      parameters: { type: 'object', properties: {} },
      steps: [
        { action: 'search_drive', args: { query: 'missing' } },
        { action: 'list_tasks', args: {} }, // should not be reached
      ],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    };

    const result = await executeDynamicTool(tool, {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Step 1');
    expect(result.output).toContain('search_drive');
    expect(result.stepResults).toHaveLength(1);
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
  });

  it('should handle step execution throwing an exception', async () => {
    mockedExecuteTool.mockRejectedValueOnce(new Error('Network timeout'));

    const tool: DynamicToolDef = {
      name: 'throws_tool',
      description: 'Will throw',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    };

    const result = await executeDynamicTool(tool, {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Network timeout');
    expect(result.stepResults[0].success).toBe(false);
  });

  it('should abort early when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const tool: DynamicToolDef = {
      name: 'aborted_tool',
      description: 'Will be aborted',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    };

    const result = await executeDynamicTool(tool, {}, controller.signal);

    expect(result.success).toBe(false);
    expect(result.output).toContain('aborted');
    expect(mockedExecuteTool).not.toHaveBeenCalled();
  });

  it('should return last step output as final output on success', async () => {
    mockedExecuteTool.mockResolvedValueOnce('step1 output');
    mockedExecuteTool.mockResolvedValueOnce('final output');

    const tool: DynamicToolDef = {
      name: 'multi_step',
      description: 'Two steps',
      parameters: { type: 'object', properties: {} },
      steps: [
        { action: 'list_tasks', args: {} },
        { action: 'list_drive_files', args: {} },
      ],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    };

    const result = await executeDynamicTool(tool, {});

    expect(result.success).toBe(true);
    expect(result.output).toBe('final output');
  });
});
