import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeDynamicTool } from '../tool-composer.js';
import type { DynamicToolDef } from '../dynamic-tool-types.js';

vi.mock('../tools.js', () => ({
  isWriteTool: (action: string) => {
    const writeActions = new Set([
      'apply_label_to_threads', 'archive_email_threads', 'send_email',
      'trash_email_threads', 'docs_write', 'drive_upload',
    ]);
    return writeActions.has(action);
  },
  buildApprovalRequest: (action: string, args: Record<string, string>) => ({
    toolName: action,
    description: `Approval for ${action}`,
    args,
  }),
  executeTool: vi.fn().mockResolvedValue('{"ok": true}'),
}));

const makeTool = (action: string): DynamicToolDef => ({
  name: 'test_tool',
  description: 'A test tool',
  parameters: { type: 'object', properties: {} },
  steps: [{ action, args: { threadIds: '{{input.threadId}}', labelName: 'TestLabel' } }],
  isWriteTool: true,
});

describe('executeDynamicTool autoApprove option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-approves safe write action apply_label_to_threads', async () => {
    const tool = makeTool('apply_label_to_threads');
    const result = await executeDynamicTool(tool, { threadId: 't1' }, undefined, { autoApprove: true });
    expect(result).not.toHaveProperty('approval');
    if ('success' in result) {
      expect(result.success).toBe(true);
    }
  });

  it('does NOT auto-approve destructive action send_email', async () => {
    const tool: DynamicToolDef = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'send_email', args: { to: 'x@y.com', body: 'hi' } }],
      isWriteTool: true,
    };
    const result = await executeDynamicTool(tool, {}, undefined, { autoApprove: true });
    expect(result).toHaveProperty('approval');
    expect(result).toHaveProperty('type', 'approval_required');
  });

  it('requires approval for safe write action WITHOUT autoApprove flag', async () => {
    const tool = makeTool('apply_label_to_threads');
    const result = await executeDynamicTool(tool, { threadId: 't1' });
    expect(result).toHaveProperty('approval');
    expect(result).toHaveProperty('type', 'approval_required');
  });
});
