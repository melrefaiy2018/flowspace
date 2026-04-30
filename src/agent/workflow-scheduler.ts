import { getDynamicTools, getDynamicTool } from './dynamic-tool-registry.js';
import { executeDynamicTool } from './tool-composer.js';
import {
  isProcessed,
  markProcessed,
  setLastPollAt,
  recordFailure,
  clearFailureForMessage,
} from './workflow-trigger-state.js';

export interface SchedulerDeps {
  gmailSearch: (query: string) => Promise<Array<{ threadId: string; messageId: string }>>;
  now: () => number;
}

const intervals = new Map<string, NodeJS.Timeout>();
let currentDeps: SchedulerDeps | null = null;

export function startWorkflowScheduler(deps: SchedulerDeps): void {
  currentDeps = deps;
  stopWorkflowScheduler();
  const tools = getDynamicTools();
  for (const tool of tools) {
    if (tool.trigger?.enabled === true && tool.trigger.type === 'email_received') {
      const intervalMs = (tool.trigger.intervalMinutes ?? 2) * 60_000;
      const handle = setInterval(() => {
        runTriggerCycle(tool.name).catch((err) =>
          console.error('[scheduler] cycle error', tool.name, err),
        );
      }, intervalMs);
      intervals.set(tool.name, handle);
      console.log('[scheduler] registered', tool.name, 'every', intervalMs, 'ms');
    }
  }
}

export function stopWorkflowScheduler(): void {
  for (const handle of intervals.values()) {
    clearInterval(handle);
  }
  intervals.clear();
}

export async function restartWorkflowScheduler(deps?: SchedulerDeps): Promise<void> {
  const d = deps ?? currentDeps;
  if (!d) throw new Error('No scheduler deps available');
  stopWorkflowScheduler();
  startWorkflowScheduler(d);
}

export async function executeForMessage(
  workflowName: string,
  messageId: string,
  threadId: string,
  options?: { clearFailureOnSuccess?: boolean },
): Promise<{ success: boolean; error?: string }> {
  const tool = getDynamicTool(workflowName);
  if (!tool) return { success: false, error: 'Workflow not found' };
  try {
    const result = await executeDynamicTool(
      tool,
      { threadId, messageId, query: tool.trigger?.filter ?? '' },
      undefined,
      { autoApprove: true, source: 'scheduler' },
    );
    if ('approval' in result) {
      const err = `Step ${('completedSteps' in result) ? result.completedSteps?.length ?? 0 : 0} requires manual approval — destructive action blocked`;
      await recordFailure(workflowName, { messageId, failedAt: Date.now(), error: err });
      return { success: false, error: err };
    }
    if (result.success === false) {
      const err = result.output || 'Workflow step failed';
      await recordFailure(workflowName, { messageId, failedAt: Date.now(), error: err });
      return { success: false, error: err };
    }
    if (options?.clearFailureOnSuccess) {
      await clearFailureForMessage(workflowName, messageId);
    }
    return { success: true };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    await recordFailure(workflowName, { messageId, failedAt: Date.now(), error: msg });
    return { success: false, error: msg };
  }
}

export async function runTriggerCycle(workflowName: string): Promise<void> {
  const tool = getDynamicTool(workflowName);
  if (!tool || !tool.trigger?.enabled) return;

  try {
    if (!currentDeps) return;

    let results: Array<{ threadId: string; messageId: string }>;
    try {
      results = await currentDeps.gmailSearch(`${tool.trigger.filter} newer_than:1d`);
    } catch (err: any) {
      const msg = String(err?.message ?? err).toLowerCase();
      if (msg.includes('auth') || msg.includes('token')) {
        console.warn('[scheduler] no auth — skipping cycle for', workflowName);
        return;
      }
      throw err;
    }

    for (const { threadId, messageId } of results) {
      if (await isProcessed(workflowName, messageId)) continue;

      // Mark-after-execute is intentional: a crash between exec and mark
      // means the message will be retried next cycle. The auto-approve
      // allowlist (label/archive/mark-read/mute/restore) is idempotent so
      // retry is safe; failed runs land in `failures` for manual retrigger.
      const result = await executeForMessage(workflowName, messageId, threadId);
      await markProcessed(workflowName, [messageId]);
      if (result.success) {
        console.log('[scheduler] executed', workflowName, 'for message', messageId);
      }
    }

    await setLastPollAt(workflowName, currentDeps.now());
  } catch (err) {
    console.error('[scheduler] ERROR', workflowName, err);
  }
}
