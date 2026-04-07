/**
 * Dynamic Tool Bridge
 *
 * Connects the dynamic tool system to the existing static tool
 * infrastructure. Provides merged tool definitions, the create_tool
 * meta-tool, and lookup helpers for chat.ts and tools.ts.
 */

import type { ToolFunctionDef } from './llm-types.js';
import { TOOL_DEFINITIONS } from './tools.js';
import { getDynamicTools, getDynamicTool } from './dynamic-tool-registry.js';
import { toToolFunctionDef } from './dynamic-tool-types.js';

// ── create_tool meta-tool definition ─────────────────────────────────

export function getCreateToolDefinition(): ToolFunctionDef {
  return {
    type: 'function',
    function: {
      name: 'create_tool',
      description: [
        'Create a new reusable tool by composing existing tools into a multi-step workflow.',
        'Use this when the user asks for something that no single existing tool can do,',
        'but can be achieved by chaining multiple existing tools together.',
        'The new tool will be saved and available for future use.',
        'Each step must reference an existing tool name as its action.',
        'Use {{input.paramName}} to reference tool input and {{steps.N.fieldPath}} to reference previous step results.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Unique tool name (lowercase, underscores allowed, e.g. "expense_tracker")',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of what this tool does',
          },
          parameters: {
            type: 'string',
            description: 'JSON string of the tool\'s input parameter schema (JSON Schema format)',
          },
          steps: {
            type: 'string',
            description: 'JSON string of the steps array. Each step: { "action": "existing_tool_name", "args": { "key": "value or {{template}}" }, "outputKey": "optional_name" }',
          },
          is_write_tool: {
            type: 'boolean',
            description: 'Whether this tool performs write operations that need user approval (default: false)',
          },
          label: {
            type: 'string',
            description: 'Optional human-readable label for UI display',
          },
        },
        required: ['name', 'description', 'steps'],
      },
    },
  };
}

// ── Merged tool definitions ──────────────────────────────────────────

/**
 * Get all tool definitions: static + dynamic + create_tool meta-tool.
 * This is what gets sent to the LLM in each chat request.
 */
export function getAllToolDefinitions(): readonly ToolFunctionDef[] {
  const dynamicDefs = getDynamicTools().map(toToolFunctionDef);
  return [...TOOL_DEFINITIONS, getCreateToolDefinition(), ...dynamicDefs];
}

// ── Dynamic tool helpers ─────────────────────────────────────────────

/** Check if a tool name is a dynamic write tool. */
export function isDynamicWriteTool(name: string): boolean {
  const tool = getDynamicTool(name);
  return tool?.isWriteTool === true;
}

/**
 * Get a UI label for a dynamic tool.
 * Returns the explicit label, or a formatted version of the name, or null.
 */
export function dynamicToolLabel(name: string): string | null {
  const tool = getDynamicTool(name);
  if (!tool) return null;
  if (tool.label) return tool.label;
  // Convert underscores to spaces and capitalize first letter of each word
  return tool.name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
