/**
 * Tests for the Claude Code CLI adapter.
 *
 * Tests the response parser, tool-calling prompt builder, message serializer,
 * CLI detection, and the full LLMClient integration — all with mocked execFile.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage, ToolFunctionDef } from '../../llm-types';

// ── Mock child_process before importing module ──────────────────────

import { EventEmitter, Writable } from 'node:stream';

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Dynamic import after mocks are set up
const {
  parseClaudeResponse,
  buildToolCallingInstructions,
  serializeMessages,
  detectClaudeCLI,
  resetDetectionCache,
  createClaudeCodeClient,
  testClaudeCodeConnection,
} = await import('../claude-code.js');

/** Create a mock child process that emits data and closes. */
function createMockChild(stdout: string, stderr = '', exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();

  // Emit data and close on next tick
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });

  return child;
}

beforeEach(() => {
  mockExecFile.mockReset();
  mockSpawn.mockReset();
});

// ── parseClaudeResponse ─────────────────────────────────────────────

describe('parseClaudeResponse', () => {
  it('returns plain text when no tool_call blocks present', () => {
    const result = parseClaudeResponse('Hello, I can help with that.');

    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.content).toBe('Hello, I can help with that.');
    expect(result.choices[0].message.tool_calls).toBeUndefined();
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('extracts a single tool call from fenced block', () => {
    const text = `I'll search your Drive for that.

\`\`\`tool_call
{"name": "search_drive", "arguments": {"query": "budget report"}}
\`\`\``;

    const result = parseClaudeResponse(text);

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    expect(result.choices[0].message.content).toBe("I'll search your Drive for that.");

    const toolCalls = result.choices[0].message.tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls![0].type).toBe('function');
    expect(toolCalls![0].function.name).toBe('search_drive');
    expect(JSON.parse(toolCalls![0].function.arguments)).toEqual({ query: 'budget report' });
    // ID should be generated
    expect(toolCalls![0].id).toMatch(/^cc_/);
  });

  it('extracts multiple tool calls', () => {
    const text = `Let me check both.

\`\`\`tool_call
{"name": "search_drive", "arguments": {"query": "budget"}}
\`\`\`

\`\`\`tool_call
{"name": "search_emails", "arguments": {"query": "from:boss"}}
\`\`\``;

    const result = parseClaudeResponse(text);

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    const toolCalls = result.choices[0].message.tool_calls;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls![0].function.name).toBe('search_drive');
    expect(toolCalls![1].function.name).toBe('search_emails');
    // Each should have a unique ID
    expect(toolCalls![0].id).not.toBe(toolCalls![1].id);
  });

  it('ignores malformed JSON in tool_call blocks and treats as text', () => {
    const text = `Here's the result:

\`\`\`tool_call
{not valid json}
\`\`\``;

    const result = parseClaudeResponse(text);

    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.choices[0].message.tool_calls).toBeUndefined();
    // Content should include everything (malformed block treated as text)
    expect(result.choices[0].message.content).toContain("Here's the result:");
  });

  it('handles empty response', () => {
    const result = parseClaudeResponse('');

    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('strips surrounding whitespace from text content', () => {
    const result = parseClaudeResponse('  Hello  \n\n');

    expect(result.choices[0].message.content).toBe('Hello');
  });

  it('handles tool call with text before and after', () => {
    const text = `Before text.

\`\`\`tool_call
{"name": "search_drive", "arguments": {"query": "test"}}
\`\`\`

After text.`;

    const result = parseClaudeResponse(text);

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    // Content should include surrounding text
    expect(result.choices[0].message.content).toContain('Before text.');
    expect(result.choices[0].message.content).toContain('After text.');
  });
});

// ── buildToolCallingInstructions ────────────────────────────────────

describe('buildToolCallingInstructions', () => {
  const sampleTools: ToolFunctionDef[] = [
    {
      type: 'function',
      function: {
        name: 'search_drive',
        description: 'Search Google Drive files',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
      },
    },
  ];

  it('includes tool name and description', () => {
    const instructions = buildToolCallingInstructions(sampleTools);

    expect(instructions).toContain('search_drive');
    expect(instructions).toContain('Search Google Drive files');
  });

  it('includes parameter information', () => {
    const instructions = buildToolCallingInstructions(sampleTools);

    expect(instructions).toContain('query');
    expect(instructions).toContain('limit');
  });

  it('includes the tool_call format example', () => {
    const instructions = buildToolCallingInstructions(sampleTools);

    expect(instructions).toContain('```tool_call');
    expect(instructions).toContain('"name"');
    expect(instructions).toContain('"arguments"');
  });

  it('returns empty string when no tools provided', () => {
    const instructions = buildToolCallingInstructions([]);
    expect(instructions).toBe('');
  });
});

// ── serializeMessages ───────────────────────────────────────────────

describe('serializeMessages', () => {
  it('serializes system + user + assistant messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    const { systemPrompt, conversationText } = serializeMessages(messages);

    expect(systemPrompt).toBe('You are helpful.');
    expect(conversationText).toContain('Hello');
    expect(conversationText).toContain('Hi there!');
  });

  it('extracts system message separately', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System instructions here.' },
      { role: 'user', content: 'Question' },
    ];

    const { systemPrompt, conversationText } = serializeMessages(messages);

    expect(systemPrompt).toBe('System instructions here.');
    // System should NOT appear in conversation text
    expect(conversationText).not.toContain('System instructions here.');
  });

  it('handles tool result messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Find files' },
      {
        role: 'assistant',
        content: 'Searching...',
        tool_calls: [{
          id: 'tc_1',
          type: 'function',
          function: { name: 'search_drive', arguments: '{"query":"test"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'tc_1', content: '{"files":[]}' },
    ];

    const { conversationText } = serializeMessages(messages);

    expect(conversationText).toContain('search_drive');
    expect(conversationText).toContain('{"files":[]}');
  });

  it('returns empty system prompt when none present', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];

    const { systemPrompt } = serializeMessages(messages);
    expect(systemPrompt).toBe('');
  });
});

// ── detectClaudeCLI ─────────────────────────────────────────────────

describe('detectClaudeCLI', () => {
  beforeEach(() => {
    resetDetectionCache();
  });

  it('returns available when claude CLI is found', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, 'claude version 1.0.0\n', '');
    });

    const result = await detectClaudeCLI();

    expect(result.available).toBe(true);
    expect(result.version).toContain('1.0.0');
  });

  it('returns unavailable when claude CLI is not found', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error('ENOENT: command not found'), '', 'command not found');
    });

    const result = await detectClaudeCLI();

    expect(result.available).toBe(false);
    expect(result.version).toBeUndefined();
  });

  it('returns unavailable on timeout', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = new Error('timeout') as Error & { killed: boolean };
      err.killed = true;
      cb(err, '', '');
    });

    const result = await detectClaudeCLI();

    expect(result.available).toBe(false);
  });
});

// ── createClaudeCodeClient ──────────────────────────────────────────

describe('createClaudeCodeClient', () => {
  function makeConfig() {
    return {
      provider: 'claude-code' as const,
      apiKey: '',
      model: 'sonnet',
    };
  }

  it('returns a client with correct provider and model', () => {
    const client = createClaudeCodeClient(makeConfig());

    expect(client.provider).toBe('claude-code');
    expect(client.model).toBe('sonnet');
  });

  it('sends prompt via stdin to claude -p and returns parsed response', async () => {
    const child = createMockChild('The answer is 42.');
    mockSpawn.mockReturnValue(child);

    const client = createClaudeCodeClient(makeConfig());
    const result = await client.complete([
      { role: 'user', content: 'What is the meaning of life?' },
    ]);

    expect(result.choices[0].message.content).toBe('The answer is 42.');
    expect(result.choices[0].finish_reason).toBe('stop');

    // Verify claude was called with -p flag and --model
    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toContain('-p');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');

    // Verify prompt was written to stdin
    expect(child.stdin.write).toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('includes tool instructions in prompt when tools are provided', async () => {
    const child = createMockChild(
      'Let me search for that.\n\n```tool_call\n{"name": "search_drive", "arguments": {"query": "budget"}}\n```',
    );
    mockSpawn.mockReturnValue(child);

    const tools: ToolFunctionDef[] = [{
      type: 'function',
      function: {
        name: 'search_drive',
        description: 'Search Drive',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    }];

    const client = createClaudeCodeClient(makeConfig());
    const result = await client.complete(
      [{ role: 'user', content: 'Find budget files' }],
      { tools },
    );

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0].function.name).toBe('search_drive');

    // Verify the prompt included tool instructions (written to stdin)
    const stdinContent = child.stdin.write.mock.calls[0][0];
    expect(stdinContent).toContain('search_drive');
    expect(stdinContent).toContain('tool_call');
  });

  it('throws on CLI execution error (non-zero exit)', async () => {
    const child = createMockChild('', 'segfault', 1);
    mockSpawn.mockReturnValue(child);

    const client = createClaudeCodeClient(makeConfig());
    await expect(
      client.complete([{ role: 'user', content: 'test' }])
    ).rejects.toThrow('segfault');
  });

  it('throws on spawn error (CLI not found)', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.kill = vi.fn();
    process.nextTick(() => child.emit('error', new Error('ENOENT')));
    mockSpawn.mockReturnValue(child);

    const client = createClaudeCodeClient(makeConfig());
    await expect(
      client.complete([{ role: 'user', content: 'test' }])
    ).rejects.toThrow('ENOENT');
  });

  it('kills child process when abort signal fires', async () => {
    const controller = new AbortController();
    const child = createMockChild('', '', 0);
    child.kill = vi.fn();
    mockSpawn.mockReturnValue(child);

    controller.abort();

    const client = createClaudeCodeClient(makeConfig());
    // The process completes with code 0 but abort signal was set
    await expect(
      client.complete([{ role: 'user', content: 'test' }], { signal: controller.signal })
    ).rejects.toThrow('Request aborted');
  });
});

// ── testClaudeCodeConnection ────────────────────────────────────────

describe('testClaudeCodeConnection', () => {
  function makeConfig() {
    return {
      provider: 'claude-code' as const,
      apiKey: '',
      model: 'sonnet',
    };
  }

  it('returns success when CLI responds', async () => {
    mockSpawn.mockReturnValue(createMockChild('ok'));

    const result = await testClaudeCodeConnection(makeConfig());

    expect(result.success).toBe(true);
  });

  it('returns failure when CLI is not found', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.kill = vi.fn();
    process.nextTick(() => child.emit('error', new Error('ENOENT')));
    mockSpawn.mockReturnValue(child);

    const result = await testClaudeCodeConnection(makeConfig());

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns failure with descriptive error on auth expiry', async () => {
    mockSpawn.mockReturnValue(
      createMockChild('', 'Authentication expired. Please run: claude login', 1),
    );

    const result = await testClaudeCodeConnection(makeConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication expired');
  });
});
