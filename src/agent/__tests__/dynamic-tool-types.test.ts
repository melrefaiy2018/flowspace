import { describe, it, expect } from 'vitest';
import { toToolFunctionDef } from '../dynamic-tool-types';
import type { DynamicToolDef } from '../dynamic-tool-types';

describe('toToolFunctionDef', () => {
  it('should convert a DynamicToolDef to OpenAI ToolFunctionDef format', () => {
    const def: DynamicToolDef = {
      name: 'expense_tracker',
      description: 'Create an expense tracking spreadsheet',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Spreadsheet title' },
        },
        required: ['title'],
      },
      steps: [
        { action: 'sheets_create', args: { title: '{{input.title}}' } },
      ],
      isWriteTool: true,
      createdAt: '2026-03-17T00:00:00Z',
    };

    const result = toToolFunctionDef(def);

    expect(result).toEqual({
      type: 'function',
      function: {
        name: 'expense_tracker',
        description: 'Create an expense tracking spreadsheet',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Spreadsheet title' },
          },
          required: ['title'],
        },
      },
    });
  });

  it('should not include steps, isWriteTool, or createdAt in the output', () => {
    const def: DynamicToolDef = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'list_tasks', args: {} }],
      isWriteTool: false,
      createdAt: '2026-03-17T00:00:00Z',
      label: 'Test Tool',
    };

    const result = toToolFunctionDef(def);

    expect(result).not.toHaveProperty('steps');
    expect(result).not.toHaveProperty('isWriteTool');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('label');
    expect(result.function).not.toHaveProperty('steps');
  });
});
