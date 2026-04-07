/**
 * Types for the dynamic/compositional tool system.
 *
 * A DynamicToolDef describes a user-created tool that composes
 * existing static tool primitives into higher-level workflows.
 */

import type { ToolFunctionDef } from './llm-types.js';

// ── Step definition ──────────────────────────────────────────────────

export interface ToolStep {
  /** An existing static tool name (e.g. "sheets_create", "search_emails"). */
  readonly action: string;
  /**
   * Arguments for the action. Values can contain template expressions:
   *   {{input.paramName}}         — references a parameter from the tool's input
   *   {{steps.N.fieldPath}}       — references a field from step N's parsed result
   */
  readonly args: Readonly<Record<string, string>>;
  /** Optional key to store this step's result under for later reference. */
  readonly outputKey?: string;
}

// ── Dynamic tool definition ──────────────────────────────────────────

export interface DynamicToolDef {
  /** Unique name — must not collide with static tool names. */
  readonly name: string;
  /** LLM-facing description of what this tool does. */
  readonly description: string;
  /** JSON Schema for the tool's input parameters. */
  readonly parameters: Record<string, unknown>;
  /** Ordered list of steps to execute. */
  readonly steps: readonly ToolStep[];
  /** Whether this tool requires user approval before executing. */
  readonly isWriteTool?: boolean;
  /** ISO timestamp of when this tool was created. */
  readonly createdAt?: string;
  /** Optional human-readable label for the UI. */
  readonly label?: string;
}

// ── Persisted file format ────────────────────────────────────────────

export interface DynamicToolsFile {
  readonly version: 1;
  readonly tools: readonly DynamicToolDef[];
}

// ── Runtime result of executing a dynamic tool ───────────────────────

export interface DynamicToolResult {
  /** Whether the overall execution succeeded. */
  readonly success: boolean;
  /** Final output string (last step's result or aggregated summary). */
  readonly output: string;
  /** Per-step results for observability. */
  readonly stepResults: readonly StepResult[];
}

export interface StepResult {
  readonly action: string;
  readonly outputKey?: string;
  readonly output: string;
  readonly success: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert a DynamicToolDef into the OpenAI-compatible ToolFunctionDef format. */
export function toToolFunctionDef(def: DynamicToolDef): ToolFunctionDef {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}
