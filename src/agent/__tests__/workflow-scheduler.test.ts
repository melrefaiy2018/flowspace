import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DynamicToolDef } from '../dynamic-tool-types.js';

vi.mock('../dynamic-tool-registry.js', async () => {
  const actual = await vi.importActual('../dynamic-tool-registry.js');
  let tools: any[] = [];
  return {
    ...actual,
    getDynamicTools: () => tools,
    getDynamicTool: (name: string) => tools.find((t: any) => t.name === name),
    _setTools: (t: any[]) => { tools = t; },
  };
});

vi.mock('../tool-composer.js', () => ({
  executeDynamicTool: vi.fn().mockResolvedValue({ success: true, output: 'ok', stepResults: [] }),
}));

vi.mock('../workflow-trigger-state.js', () => ({
  isProcessed: vi.fn().mockResolvedValue(false),
  markProcessed: vi.fn().mockResolvedValue(undefined),
  setLastPollAt: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  clearFailureForMessage: vi.fn().mockResolvedValue(undefined),
}));

import { startWorkflowScheduler, stopWorkflowScheduler, runTriggerCycle, executeForMessage } from '../workflow-scheduler.js';
// @ts-expect-error _setTools is injected by vi.mock above
import { getDynamicTools, _setTools } from '../dynamic-tool-registry.js';
import { executeDynamicTool } from '../tool-composer.js';
import { isProcessed, markProcessed, setLastPollAt, recordFailure, clearFailureForMessage } from '../workflow-trigger-state.js';

const makeTool = (name: string, trigger: any): DynamicToolDef => ({
  name,
  description: `Test ${name}`,
  parameters: { type: 'object', properties: {} },
  steps: [{ action: 'apply_label_to_threads', args: { threadIds: '{{input.threadId}}' } }],
  trigger,
});

describe('workflow-scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopWorkflowScheduler();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopWorkflowScheduler();
    vi.useRealTimers();
  });

  it('registers one interval for an enabled trigger', () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    const gmailSearch = vi.fn().mockResolvedValue([]);
    startWorkflowScheduler({ gmailSearch, now: () => Date.now() });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('registers ZERO intervals when trigger.enabled is false', () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: false, filter: 'subject:test', intervalMinutes: 2 })]);
    const gmailSearch = vi.fn().mockResolvedValue([]);
    startWorkflowScheduler({ gmailSearch, now: () => Date.now() });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runTriggerCycle queries Gmail with filter', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    const gmailSearch = vi.fn().mockResolvedValue([
      { threadId: 't1', messageId: 'm1' },
    ]);
    startWorkflowScheduler({ gmailSearch, now: () => 1000 });
    await runTriggerCycle('wf1');
    expect(gmailSearch).toHaveBeenCalledWith(expect.stringContaining('subject:test'));
  });

  it('filters out already-processed message IDs', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const gmailSearch = vi.fn().mockResolvedValue([
      { threadId: 't1', messageId: 'm1' },
    ]);
    startWorkflowScheduler({ gmailSearch, now: () => 1000 });
    await runTriggerCycle('wf1');
    expect(executeDynamicTool).not.toHaveBeenCalled();
  });

  it('calls executeDynamicTool with autoApprove for new messages', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const gmailSearch = vi.fn().mockResolvedValue([
      { threadId: 't1', messageId: 'm1' },
    ]);
    startWorkflowScheduler({ gmailSearch, now: () => 1000 });
    await runTriggerCycle('wf1');
    expect(executeDynamicTool).toHaveBeenCalledWith(
      expect.anything(),
      { threadId: 't1', messageId: 'm1', query: 'subject:test' },
      undefined,
      { autoApprove: true },
    );
    expect(markProcessed).toHaveBeenCalledWith('wf1', ['m1']);
  });

  it('records failure when executeDynamicTool throws and still marks processed', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (executeDynamicTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Gmail API quota exceeded'));
    const gmailSearch = vi.fn().mockResolvedValue([
      { threadId: 't1', messageId: 'm1' },
    ]);
    startWorkflowScheduler({ gmailSearch, now: () => 1000 });
    await runTriggerCycle('wf1');
    expect(recordFailure).toHaveBeenCalledWith('wf1', expect.objectContaining({ error: 'Gmail API quota exceeded', messageId: 'm1' }));
    expect(markProcessed).toHaveBeenCalledWith('wf1', ['m1']);
  });

  it('records failure when executeDynamicTool returns success:false', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (executeDynamicTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, output: 'step 2 failed' });
    const gmailSearch = vi.fn().mockResolvedValue([
      { threadId: 't1', messageId: 'm1' },
    ]);
    startWorkflowScheduler({ gmailSearch, now: () => 1000 });
    await runTriggerCycle('wf1');
    expect(recordFailure).toHaveBeenCalled();
    expect(markProcessed).toHaveBeenCalledWith('wf1', ['m1']);
  });

  it('stopWorkflowScheduler clears all intervals', () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    const gmailSearch = vi.fn().mockResolvedValue([]);
    startWorkflowScheduler({ gmailSearch, now: () => Date.now() });
    expect(vi.getTimerCount()).toBe(1);
    stopWorkflowScheduler();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('error inside cycle is caught and does not propagate', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    const gmailSearch = vi.fn().mockRejectedValue(new Error('unexpected'));
    startWorkflowScheduler({ gmailSearch, now: () => 1000 });
    await expect(runTriggerCycle('wf1')).resolves.toBeUndefined();
  });

  it('executeForMessage clears failure on success when option is set', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    (executeDynamicTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, output: 'ok', stepResults: [] });
    const result = await executeForMessage('wf1', 'm1', 't1', { clearFailureOnSuccess: true });
    expect(result.success).toBe(true);
    expect(clearFailureForMessage).toHaveBeenCalledWith('wf1', 'm1');
  });

  it('executeForMessage does NOT clear failures on success when option is absent (scheduler path)', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    (executeDynamicTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, output: 'ok', stepResults: [] });
    const result = await executeForMessage('wf1', 'm1', 't1');
    expect(result.success).toBe(true);
    expect(clearFailureForMessage).not.toHaveBeenCalled();
  });

  it('executeForMessage does NOT clear failure when workflow fails, even with option set', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    (executeDynamicTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('still broken'));
    const result = await executeForMessage('wf1', 'm1', 't1', { clearFailureOnSuccess: true });
    expect(result.success).toBe(false);
    expect(clearFailureForMessage).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalled();
  });

  it('skips cycle when no auth (auth-like error)', async () => {
    _setTools([makeTool('wf1', { type: 'email_received', enabled: true, filter: 'subject:test', intervalMinutes: 2 })]);
    const gmailSearch = vi.fn().mockRejectedValue(new Error('auth token expired'));
    startWorkflowScheduler({ gmailSearch, now: () => 1000 });
    await runTriggerCycle('wf1');
    expect(executeDynamicTool).not.toHaveBeenCalled();
  });
});
