/**
 * Tests for the Anthropic adapter's format conversion logic.
 *
 * We don't make real API calls — we test the conversion functions
 * that translate between OpenAI and Anthropic formats.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnthropicClient } from '../anthropic';
import type { ChatMessage, ToolFunctionDef } from '../../llm-types';

// We'll test the client by mocking fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function makeConfig() {
  return {
    provider: 'anthropic' as const,
    apiKey: 'sk-ant-test-key',
    model: 'claude-sonnet-4-20250514',
  };
}

function makeAnthropicResponse(content: any[], stopReason = 'end_turn') {
  return {
    ok: true,
    json: async () => ({
      content,
      stop_reason: stopReason,
      model: 'claude-sonnet-4-20250514',
    }),
  };
}

describe('createAnthropicClient', () => {
  it('returns a client with correct provider and model', () => {
    const client = createAnthropicClient(makeConfig());
    expect(client.provider).toBe('anthropic');
    expect(client.model).toBe('claude-sonnet-4-20250514');
  });

  it('sends system prompt as top-level parameter', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: 'text', text: 'Hello' }]));

    const client = createAnthropicClient(makeConfig());
    await client.complete([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ]);

    const [url, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.system).toBe('You are helpful.');
    // System should NOT be in messages
    expect(body.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });

  it('sends correct headers', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: 'text', text: 'ok' }]));

    const client = createAnthropicClient(makeConfig());
    await client.complete([{ role: 'user', content: 'test' }]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('sk-ant-test-key');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('converts a text response to normalized format', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([
      { type: 'text', text: 'The answer is 42.' },
    ]));

    const client = createAnthropicClient(makeConfig());
    const response = await client.complete([{ role: 'user', content: 'What is the answer?' }]);

    expect(response.choices).toHaveLength(1);
    expect(response.choices[0].message.content).toBe('The answer is 42.');
    expect(response.choices[0].message.tool_calls).toBeUndefined();
    expect(response.choices[0].finish_reason).toBe('stop');
  });

  it('converts tool_use response to normalized tool_calls format', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([
      { type: 'text', text: 'Let me search for that.' },
      { type: 'tool_use', id: 'toolu_123', name: 'search_drive', input: { query: 'budget' } },
    ], 'tool_use'));

    const client = createAnthropicClient(makeConfig());
    const response = await client.complete([{ role: 'user', content: 'Find budget file' }]);

    expect(response.choices[0].finish_reason).toBe('tool_calls');
    expect(response.choices[0].message.content).toBe('Let me search for that.');
    const toolCalls = response.choices[0].message.tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls![0].id).toBe('toolu_123');
    expect(toolCalls![0].function.name).toBe('search_drive');
    expect(JSON.parse(toolCalls![0].function.arguments)).toEqual({ query: 'budget' });
  });

  it('converts tool definitions to Anthropic format', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: 'text', text: 'ok' }]));

    const tools: ToolFunctionDef[] = [{
      type: 'function',
      function: {
        name: 'search_drive',
        description: 'Search Google Drive',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    }];

    const client = createAnthropicClient(makeConfig());
    await client.complete([{ role: 'user', content: 'test' }], { tools });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('search_drive');
    expect(body.tools[0].input_schema).toEqual({ type: 'object', properties: { query: { type: 'string' } } });
    // Should NOT have `type: 'function'` wrapper
    expect(body.tools[0].type).toBeUndefined();
  });

  it('converts tool result messages to user messages with tool_result blocks', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: 'text', text: 'Found files.' }]));

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Find files' },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'toolu_1', type: 'function', function: { name: 'search_drive', arguments: '{"query":"test"}' } },
      ]},
      { role: 'tool', tool_call_id: 'toolu_1', content: '{"files":[]}' },
    ];

    const client = createAnthropicClient(makeConfig());
    await client.complete(messages);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // The tool result should be a user message with a tool_result content block
    const toolResultMsg = body.messages.find((m: any) =>
      Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
    );
    expect(toolResultMsg).toBeTruthy();
    expect(toolResultMsg.role).toBe('user');
    expect(toolResultMsg.content[0].tool_use_id).toBe('toolu_1');
    expect(toolResultMsg.content[0].content).toBe('{"files":[]}');
  });

  it('throws on API error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
    });

    const client = createAnthropicClient(makeConfig());
    await expect(
      client.complete([{ role: 'user', content: 'test' }])
    ).rejects.toThrow('Invalid API key');
  });
});
