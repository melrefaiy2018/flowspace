/**
 * Claude Code CLI adapter — uses `claude -p` subprocess as LLM backend.
 *
 * Enables users with Claude Code installed (Max subscription) to use Claude
 * without an API key. Tool calling is implemented via structured text prompts:
 * Claude responds with fenced `tool_call` blocks that we parse into
 * CompletionToolCall objects for the existing tool-calling loop in chat.ts.
 */

import { execFile, spawn } from 'child_process';
import type {
  ChatMessage,
  CompletionOptions,
  CompletionResponse,
  CompletionToolCall,
  LLMClient,
  LLMProviderConfig,
  ToolFunctionDef,
} from '../llm-types.js';

// ── Constants ────────────────────────────────────────────────────────

const CLI_TIMEOUT_MS = 120_000;
const DETECT_TIMEOUT_MS = 5_000;

/**
 * Extra PATH entries so the CLI is found inside Tauri .app bundles
 * (same pattern as src-tauri/lib.rs for node/gws resolution).
 */
const EXTRA_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  `${process.env.HOME}/.local/bin`,
  `${process.env.HOME}/.claude/bin`,
];

function augmentedEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? '';
  const extra = EXTRA_PATH_DIRS.filter((d) => !currentPath.includes(d)).join(':');
  return {
    ...process.env,
    PATH: extra ? `${extra}:${currentPath}` : currentPath,
  };
}

// ── Tool call parsing ────────────────────────────────────────────────

const TOOL_CALL_REGEX = /```tool_call\s*\n([\s\S]*?)\n```/g;

interface ParsedToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

function tryParseToolCall(json: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(json.trim());
    if (typeof parsed.name === 'string' && typeof parsed.arguments === 'object') {
      return { name: parsed.name, arguments: parsed.arguments };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse Claude CLI text output into a normalized CompletionResponse.
 * Extracts fenced `tool_call` blocks and converts them to CompletionToolCall[].
 */
export function parseClaudeResponse(text: string): CompletionResponse {
  const toolCalls: CompletionToolCall[] = [];
  let callIndex = 0;

  // Extract all tool_call blocks
  const textWithoutToolCalls = text.replace(TOOL_CALL_REGEX, (_match, jsonBlock: string) => {
    const parsed = tryParseToolCall(jsonBlock);
    if (parsed) {
      toolCalls.push({
        id: `cc_${Date.now()}_${callIndex++}`,
        type: 'function',
        function: {
          name: parsed.name,
          arguments: JSON.stringify(parsed.arguments),
        },
      });
      return ''; // Remove the tool_call block from text
    }
    // Malformed JSON — leave in text
    return _match;
  });

  const trimmedContent = textWithoutToolCalls.trim() || null;
  const hasToolCalls = toolCalls.length > 0;

  return {
    choices: [{
      message: {
        role: 'assistant',
        content: trimmedContent,
        tool_calls: hasToolCalls ? toolCalls : undefined,
      },
      finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
    }],
  };
}

// ── Tool calling instructions ────────────────────────────────────────

/**
 * Build a text block that instructs Claude to use fenced tool_call blocks
 * when it wants to invoke a tool. Appended to the prompt when tools are present.
 */
export function buildToolCallingInstructions(tools: readonly ToolFunctionDef[]): string {
  if (tools.length === 0) return '';

  const toolDescriptions = tools.map((t) => {
    const params = JSON.stringify(t.function.parameters, null, 2);
    return `### ${t.function.name}\n${t.function.description}\nParameters: ${params}`;
  }).join('\n\n');

  return `
## Available Tools

You have access to tools. When you need to call a tool, respond with a fenced code block using the language tag \`tool_call\` containing a JSON object with "name" and "arguments" keys. You may include text before and after the tool call. You may include multiple tool_call blocks in one response.

${toolDescriptions}

## Tool Call Format

When you want to use a tool, respond with exactly this format:

\`\`\`tool_call
{"name": "tool_name", "arguments": {"param1": "value1"}}
\`\`\`

IMPORTANT: Only use the tools listed above. Always use the exact tool_call format shown.`;
}

// ── Message serialization ────────────────────────────────────────────

/**
 * Serialize ChatMessage[] into a text prompt suitable for `claude -p`.
 * Returns the system prompt separately (passed via --system-prompt flag)
 * and the conversation as structured text.
 */
export function serializeMessages(messages: readonly ChatMessage[]): {
  readonly systemPrompt: string;
  readonly conversationText: string;
} {
  let systemPrompt = '';
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
      continue;
    }

    if (msg.role === 'user') {
      parts.push(`[User]\n${msg.content}`);
      continue;
    }

    if (msg.role === 'assistant') {
      const textPart = msg.content ?? '';
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCallsText = msg.tool_calls.map((tc) =>
          `Called tool: ${tc.function.name}(${tc.function.arguments})`
        ).join('\n');
        parts.push(`[Assistant]\n${textPart}\n${toolCallsText}`);
      } else {
        parts.push(`[Assistant]\n${textPart}`);
      }
      continue;
    }

    if (msg.role === 'tool') {
      parts.push(`[Tool Result (${msg.tool_call_id})]\n${msg.content}`);
    }
  }

  return { systemPrompt, conversationText: parts.join('\n\n') };
}

// ── CLI detection ────────────────────────────────────────────────────

let cachedDetection: { available: boolean; version?: string } | null = null;

/**
 * Check if the `claude` CLI is installed and accessible.
 * Result is cached for the lifetime of the process.
 */
export async function detectClaudeCLI(): Promise<{ available: boolean; version?: string }> {
  if (cachedDetection) return cachedDetection;

  const result = await new Promise<{ available: boolean; version?: string }>((resolve) => {
    execFile(
      'claude',
      ['--version'],
      { timeout: DETECT_TIMEOUT_MS, env: augmentedEnv() },
      (err, stdout) => {
        if (err) {
          resolve({ available: false });
        } else {
          resolve({ available: true, version: stdout.trim() });
        }
      },
    );
  });

  cachedDetection = result;
  return result;
}

/**
 * Reset cached detection (for testing).
 */
export function resetDetectionCache(): void {
  cachedDetection = null;
}

// ── LLM Client ───────────────────────────────────────────────────────

/**
 * Create an LLMClient that uses the Claude Code CLI subprocess.
 */
export function createClaudeCodeClient(config: LLMProviderConfig): LLMClient {
  return {
    model: config.model,
    provider: 'claude-code' as LLMProviderConfig['provider'],

    async complete(
      messages: readonly ChatMessage[],
      options: CompletionOptions = {},
    ): Promise<CompletionResponse> {
      // Abort early if already cancelled
      if (options.signal?.aborted) {
        throw new Error('Request aborted');
      }

      const { systemPrompt, conversationText } = serializeMessages(messages);

      // Build the full prompt with optional tool instructions
      const toolInstructions = options.tools
        ? buildToolCallingInstructions(options.tools)
        : '';

      const fullPrompt = [
        systemPrompt ? `[System Instructions]\n${systemPrompt}` : '',
        toolInstructions,
        conversationText,
      ].filter(Boolean).join('\n\n');

      const args = ['-p', '--model', config.model, '--output-format', 'text'];

      return new Promise<CompletionResponse>((resolve, reject) => {
        const child = spawn('claude', args, {
          env: augmentedEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
        child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        // Timeout handling
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('Claude CLI timed out after 120 seconds'));
        }, CLI_TIMEOUT_MS);

        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(stderr || `Claude CLI exited with code ${code}`));
            return;
          }
          resolve(parseClaudeResponse(stdout));
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        // Write prompt to stdin
        child.stdin.write(fullPrompt);
        child.stdin.end();

        // Wire up abort signal
        if (options.signal) {
          const onAbort = () => {
            child.kill('SIGTERM');
          };
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    },
  };
}

// ── Connection test ──────────────────────────────────────────────────

/**
 * Test the Claude Code CLI connection with a minimal prompt.
 */
export async function testClaudeCodeConnection(
  config: LLMProviderConfig,
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = createClaudeCodeClient(config);
    const response = await client.complete(
      [{ role: 'user', content: 'Say "ok".' }],
      { temperature: 0 },
    );
    const content = response.choices[0]?.message?.content;
    if (content === null || content === undefined) {
      return { success: false, error: 'No response from Claude CLI' };
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { success: false, error: message };
  }
}
