/**
 * Integration tests for the dynamic tool system connecting to the
 * existing tool infrastructure (TOOL_DEFINITIONS, executeTool, chat.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DynamicToolDef } from '../dynamic-tool-types';
import { toToolFunctionDef } from '../dynamic-tool-types';
import {
  resetRegistry,
  setFileIO,
  registerDynamicTool,
  getDynamicTools,
  removeDynamicTool,
  type FileIO,
} from '../dynamic-tool-registry';
import {
  getAllToolDefinitions,
  getCreateToolDefinition,
  isDynamicWriteTool,
  dynamicToolLabel,
} from '../dynamic-tool-bridge';

function createMockFileIO(): FileIO {
  return {
    exists: vi.fn(() => false),
    read: vi.fn(() => ''),
    write: vi.fn(),
    getFilePath: () => '/mock/.dynamic-tools.json',
  };
}

beforeEach(() => {
  setFileIO(createMockFileIO());
  resetRegistry();
});

// ── getAllToolDefinitions ─────────────────────────────────────────────

describe('getAllToolDefinitions', () => {
  it('should include static TOOL_DEFINITIONS when no dynamic tools exist', () => {
    const all = getAllToolDefinitions();
    // Should have the static tools plus the create_tool meta-tool
    const names = all.map((t) => t.function.name);
    expect(names).toContain('search_drive');
    expect(names).toContain('list_tasks');
    expect(names).toContain('create_tool');
  });

  it('should include registered dynamic tools', () => {
    const tool: DynamicToolDef = {
      name: 'my_custom_tool',
      description: 'Custom tool',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    };
    registerDynamicTool(tool);

    const all = getAllToolDefinitions();
    const names = all.map((t) => t.function.name);

    expect(names).toContain('my_custom_tool');
  });

  it('should include create_tool meta-tool definition', () => {
    const all = getAllToolDefinitions();
    const createTool = all.find((t) => t.function.name === 'create_tool');

    expect(createTool).toBeDefined();
    expect(createTool?.function.description).toBeTruthy();
    expect(createTool?.function.parameters).toHaveProperty('properties');
  });
});

// ── getCreateToolDefinition ──────────────────────────────────────────

describe('getCreateToolDefinition', () => {
  it('should return a valid OpenAI tool function definition', () => {
    const def = getCreateToolDefinition();

    expect(def.type).toBe('function');
    expect(def.function.name).toBe('create_tool');
    expect(def.function.parameters).toBeDefined();
  });

  it('should have required parameters: name, description, steps', () => {
    const def = getCreateToolDefinition();
    const required = (def.function.parameters as any).required;

    expect(required).toContain('name');
    expect(required).toContain('description');
    expect(required).toContain('steps');
  });
});

// ── isDynamicWriteTool ───────────────────────────────────────────────

describe('isDynamicWriteTool', () => {
  it('should return true for a dynamic write tool', () => {
    registerDynamicTool({
      name: 'write_tool',
      description: 'Write tool',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'sheets_create', args: {} }],
      isWriteTool: true,
      createdAt: '2026-03-17T00:00:00Z',
    });

    expect(isDynamicWriteTool('write_tool')).toBe(true);
  });

  it('should return false for a dynamic read tool', () => {
    registerDynamicTool({
      name: 'read_tool',
      description: 'Read tool',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    });

    expect(isDynamicWriteTool('read_tool')).toBe(false);
  });

  it('should return false for non-existent tool', () => {
    expect(isDynamicWriteTool('nonexistent')).toBe(false);
  });
});

// ── dynamicToolLabel ─────────────────────────────────────────────────

describe('dynamicToolLabel', () => {
  it('should return the tool label if set', () => {
    registerDynamicTool({
      name: 'labeled_tool',
      description: 'desc',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
      label: 'My Custom Label',
    });

    expect(dynamicToolLabel('labeled_tool')).toBe('My Custom Label');
  });

  it('should return a formatted name if no label is set', () => {
    registerDynamicTool({
      name: 'expense_tracker',
      description: 'desc',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
    });

    // Should convert underscores to spaces and capitalize
    const label = dynamicToolLabel('expense_tracker');
    expect(label).toBeTruthy();
    expect(label).not.toContain('_');
  });

  it('should return null for non-existent tool', () => {
    expect(dynamicToolLabel('nonexistent')).toBeNull();
  });
});
