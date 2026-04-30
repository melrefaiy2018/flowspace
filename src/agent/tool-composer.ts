/**
 * Tool Composer — Template Interpolation & Step Executor
 *
 * Executes a DynamicToolDef by running its steps sequentially,
 * interpolating template variables between steps.
 *
 * Template syntax:
 *   {{input.paramName}}       — replaced with the tool's input argument
 *   {{steps.N.fieldPath}}     — replaced with a value from step N's parsed result
 */

import type { DynamicToolDef, DynamicToolResult, StepResult } from './dynamic-tool-types.js';
import { executeTool, isWriteTool, buildApprovalRequest } from './tools.js';
import type { ApprovalRequest } from '../shared/chat.js';

export const AUTO_APPROVE_SAFE_ACTIONS = new Set<string>([
  'apply_label_to_threads',
  'archive_email_threads',
  'restore_email_threads',
  'mark_threads_read',
  'mute_email_threads',
]);

/** Returned when a write step is encountered and user approval is required. */
export interface ApprovalRequiredResult {
  readonly type: 'approval_required';
  readonly approval: ApprovalRequest;
  readonly completedSteps: readonly StepResult[];
}

// ── Known static tool names (for validation) ────────────────────────

const ALLOWED_ACTIONS = new Set([
  'search_drive', 'list_drive_files', 'create_drive_folder',
  'send_email', 'search_emails', 'read_email',
  'create_calendar_event', 'list_calendar_events',
  'create_task', 'list_tasks',
  'standup_report', 'meeting_prep', 'email_to_task', 'weekly_digest',
  'calendar_agenda', 'gmail_triage',
  'sheets_read', 'sheets_create', 'sheets_update', 'sheets_append',
  'docs_read', 'docs_write',
  'drive_upload', 'review_overdue_tasks', 'save_email_to_doc',
  'archive_email_threads', 'trash_email_threads',
  'restore_email_threads', 'mute_email_threads',
  'mark_threads_read', 'apply_label_to_threads',
  'unsubscribe_from_sender', 'create_gmail_filter',
]);

/** Return the list of allowed step action names. */
export function getAllowedActions(): string[] {
  return Array.from(ALLOWED_ACTIONS).sort();
}

// ── Template interpolation ───────────────────────────────────────────

interface InterpolationContext {
  readonly input: Readonly<Record<string, unknown>>;
  readonly steps: readonly (Record<string, unknown> | null)[];
  /** Maps outputKey names to their parsed step result, for {{steps.<key>.path}} syntax. */
  readonly outputKeys?: Readonly<Record<string, Record<string, unknown> | null>>;
}

/**
 * Resolve a dot-separated path on an object.
 * e.g. getPath({ a: { b: 'c' } }, 'a.b') → 'c'
 */
function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Interpolate template expressions in a string.
 * Returns the resolved string with all {{...}} replaced.
 */
export function interpolate(template: unknown, ctx: InterpolationContext): string {
  // Accept non-string values gracefully (LLM may return numbers, booleans, etc.)
  const str = typeof template === 'string' ? template : String(template ?? '');
  return str.replace(/\{\{(.*?)\}\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();

    // {{input.paramName}}
    if (trimmed.startsWith('input.')) {
      const fieldPath = trimmed.slice('input.'.length);
      const value = getPath(ctx.input, fieldPath);
      return value !== undefined ? String(value) : '';
    }

    // {{steps.N.fieldPath}} or {{steps.<outputKey>.fieldPath}}
    if (trimmed.startsWith('steps.')) {
      const rest = trimmed.slice('steps.'.length);
      const dotIdx = rest.indexOf('.');
      if (dotIdx === -1) return '';
      const key = rest.slice(0, dotIdx);
      const fieldPath = rest.slice(dotIdx + 1);

      let stepData: Record<string, unknown> | null | undefined;
      const stepIdx = parseInt(key, 10);
      if (!Number.isNaN(stepIdx) && stepIdx >= 0 && stepIdx < ctx.steps.length) {
        stepData = ctx.steps[stepIdx];
      } else {
        // Fall back to outputKey name lookup
        stepData = ctx.outputKeys?.[key];
      }

      if (!stepData) return '';
      const value = getPath(stepData, fieldPath);
      return value !== undefined ? String(value) : '';
    }

    return '';
  });
}

/**
 * Interpolate all values in an args record.
 */
export function interpolateArgs(
  args: Readonly<Record<string, unknown>>,
  ctx: InterpolationContext,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    // Coerce non-string values (numbers, booleans) to string before interpolating
    const strValue = typeof value === 'string' ? value : String(value ?? '');
    result[key] = interpolate(strValue, ctx);
  }
  return result;
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Validate that all steps reference known static tools.
 * Returns an error message if invalid, or null if valid.
 */
export function validateDynamicTool(tool: DynamicToolDef): string | null {
  if (!tool.name || typeof tool.name !== 'string') {
    return 'Tool name is required.';
  }
  if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
    return 'Tool name must be lowercase alphanumeric with underscores, starting with a letter.';
  }
  if (!tool.steps || tool.steps.length === 0) {
    return 'Tool must have at least one step.';
  }
  if (tool.steps.length > 10) {
    return 'Tool cannot have more than 10 steps.';
  }
  for (let i = 0; i < tool.steps.length; i++) {
    const step = tool.steps[i];
    if (!ALLOWED_ACTIONS.has(step.action)) {
      return `Step ${i + 1}: unknown action "${step.action}". Only existing tools can be used as steps.`;
    }
  }
  return null;
}

// ── Step executor ────────────────────────────────────────────────────

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Execute a dynamic tool by running its steps in sequence.
 * Each step's result is available to subsequent steps via {{steps.N.field}}.
 */
export async function executeDynamicTool(
  tool: DynamicToolDef,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  options?: { autoApprove?: boolean; source?: 'chat' | 'scheduler' },
): Promise<DynamicToolResult | ApprovalRequiredResult> {
  const source: 'chat' | 'scheduler' = options?.source ?? 'chat';
  const stepResults: StepResult[] = [];
  const parsedSteps: (Record<string, unknown> | null)[] = [];
  const outputKeyMap: Record<string, Record<string, unknown> | null> = {};

  const ctx: InterpolationContext = { input, steps: parsedSteps, outputKeys: outputKeyMap };

  for (let i = 0; i < tool.steps.length; i++) {
    const step = tool.steps[i];

    if (signal?.aborted) {
      return {
        success: false,
        output: 'Execution was aborted.',
        stepResults,
      };
    }

    const resolvedArgs = interpolateArgs(step.args, ctx);

    if (isWriteTool(step.action)) {
      const isSafe = AUTO_APPROVE_SAFE_ACTIONS.has(step.action);
      if (!(options?.autoApprove === true && isSafe)) {
        const approval = buildApprovalRequest(step.action, resolvedArgs);
        const approvalWithContext: ApprovalRequest = {
          ...approval,
          toolArgs: {
            ...resolvedArgs,
            _dynamicToolName: tool.name,
            _stepIndex: i,
            _remainingSteps: JSON.stringify(tool.steps.slice(i + 1)),
            _outputKeys: JSON.stringify(outputKeyMap),
          },
        };
        return {
          type: 'approval_required',
          approval: approvalWithContext,
          completedSteps: stepResults,
        };
      }
    }

    try {
      const output = await executeTool(step.action, resolvedArgs, signal, source);
      const parsed = tryParseJson(output);
      parsedSteps.push(parsed);
      if (step.outputKey && parsed) {
        outputKeyMap[step.outputKey] = parsed;
      }

      const isError = output.startsWith('Error:');
      stepResults.push({
        action: step.action,
        outputKey: step.outputKey,
        output,
        success: !isError,
      });

      if (isError) {
        return {
          success: false,
          output: `Step ${i + 1} (${step.action}) failed: ${output}`,
          stepResults,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      parsedSteps.push(null);
      stepResults.push({
        action: step.action,
        outputKey: step.outputKey,
        output: `Error: ${message}`,
        success: false,
      });
      return {
        success: false,
        output: `Step ${i + 1} (${step.action}) threw an error: ${message}`,
        stepResults,
      };
    }
  }

  // Build a structured summary so the LLM can report what happened across all steps
  const stepSummaryLines = stepResults.map((r, i) => {
    const label = r.action.replace(/_/g, ' ');
    const preview = r.output.length > 300 ? r.output.slice(0, 300) + '…' : r.output;
    return `Step ${i + 1} — ${label}:\n${preview}`;
  });

  const lastResult = stepResults[stepResults.length - 1];
  const output = [
    `Workflow "${tool.label || tool.name}" completed ${stepResults.length} step(s).`,
    '',
    stepSummaryLines.join('\n\n'),
    '',
    `Final result:\n${lastResult?.output ?? 'No output.'}`,
  ].join('\n');

  return {
    success: true,
    output,
    stepResults,
  };
}
