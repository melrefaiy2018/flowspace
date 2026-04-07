/**
 * Tests for the Codex CLI provider adapter.
 *
 * Covers: CLI detection, message conversion, response parsing,
 * server lifecycle, and the full LLMClient integration — with
 * mocked child_process and globalThis.WebSocket.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChatMessage, ToolFunctionDef } from '../../llm-types';

// ── Mock child_process before importing module ──────────────────────

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// ── MockWebSocket ───────────────────────────────────────────────────

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  send = vi.fn();
  close = vi.fn();
  url: string;
  constructor(url: string) {
    super();
    mockWsInstances.push(this);
    this.url = url;
  }
}

const mockWsInstances: MockWebSocket[] = [];

// ── Dynamic import after mocks ────────────────────────────────────

const {
  detectCodexCLI,
  resetCodexDetectionCache,
  buildCodexMessages,
  parseCodexResponse,
  ensureCodexServer,
  resetCodexServerCache,
  createCodexClient,
  testCodexConnection,
} = await import('../codex.js');

// ── Setup / teardown ─────────────────────────────────────────────

beforeEach(() => {
  mockExecFile.mockReset();
  mockSpawn.mockReset();
  mockWsInstances.length = 0;
  resetCodexDetectionCache();
  resetCodexServerCache();
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  delete (globalThis as any).WebSocket;
});

// ── detectCodexCLI ───────────────────────────────────────────────

describe('detectCodexCLI', () => {
  it('returns available: true when codex --version succeeds', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
      cb(null, '1.0.0', '');
    });

    const result = await detectCodexCLI();

    expect(result.available).toBe(true);
    expect(result.path).toBeTruthy();
  });

  it('returns available: false when codex is not found', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
      const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
      cb(err, '', '');
    });

    const result = await detectCodexCLI();

    expect(result.available).toBe(false);
  });

  it('caches the result — execFile called only once on repeated calls', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
      cb(null, '1.0.0', '');
    });

    await detectCodexCLI();
    await detectCodexCLI();
    await detectCodexCLI();

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('resetCodexDetectionCache clears the cache', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
      cb(null, '1.0.0', '');
    });

    await detectCodexCLI();
    resetCodexDetectionCache();
    await detectCodexCLI();

    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});

// ── buildCodexMessages ──────────────────────────────────────────

describe('buildCodexMessages', () => {
  it('passes through system messages', () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'You are helpful.' }];
    const result = buildCodexMessages(messages);
    expect(result).toEqual([{ role: 'system', content: 'You are helpful.' }]);
  });

  it('passes through user messages', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
    const result = buildCodexMessages(messages);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('passes through assistant messages with tool_calls', () => {
    const toolCall = { id: 'tc1', type: 'function' as const, function: { name: 'search', arguments: '{}' } };
    const messages: ChatMessage[] = [{ role: 'assistant', content: null, tool_calls: [toolCall] }];
    const result = buildCodexMessages(messages);
    expect(result[0].role).toBe('assistant');
    expect((result[0] as any).tool_calls).toEqual([toolCall]);
  });

  it('converts tool role messages', () => {
    const messages: ChatMessage[] = [{ role: 'tool', tool_call_id: 'tc1', content: 'result' }];
    const result = buildCodexMessages(messages);
    expect(result[0].role).toBe('tool');
    expect((result[0] as any).tool_call_id).toBe('tc1');
    expect((result[0] as any).content).toBe('result');
  });

  it('returns empty array for empty input', () => {
    expect(buildCodexMessages([])).toEqual([]);
  });
});

// ── parseCodexResponse ──────────────────────────────────────────

describe('parseCodexResponse', () => {
  it('parses a valid result with text content', () => {
    const raw = {
      jsonrpc: '2.0',
      id: '1',
      result: {
        choices: [{
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        }],
      },
    };

    const result = parseCodexResponse(raw);

    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.content).toBe('Hello!');
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('parses tool_calls in the response', () => {
    const toolCall = { id: 'tc1', type: 'function', function: { name: 'search_drive', arguments: '{"q":"test"}' } };
    const raw = {
      jsonrpc: '2.0',
      id: '1',
      result: {
        choices: [{
          message: { role: 'assistant', content: null, tool_calls: [toolCall] },
          finish_reason: 'tool_calls',
        }],
      },
    };

    const result = parseCodexResponse(raw);

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0].function.name).toBe('search_drive');
  });

  it('throws on JSON-RPC error response', () => {
    const raw = {
      jsonrpc: '2.0',
      id: '1',
      error: { code: -32600, message: 'Not authenticated' },
    };

    expect(() => parseCodexResponse(raw)).toThrow('Not authenticated');
  });

  it('handles null content gracefully', () => {
    const raw = {
      jsonrpc: '2.0',
      id: '1',
      result: {
        choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      },
    };

    const result = parseCodexResponse(raw);
    expect(result.choices[0].message.content).toBeNull();
  });

  it('returns empty choices when result.choices is missing', () => {
    const raw = { jsonrpc: '2.0', id: '1', result: {} };
    const result = parseCodexResponse(raw);
    expect(result.choices).toEqual([]);
  });
});

// ── ensureCodexServer ─────────────────────────────────────────────

describe('ensureCodexServer', () => {
  function createMockServerProcess() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    proc.pid = 12345;
    return proc;
  }

  it('spawns codex app-server on first call', async () => {
    const proc = createMockServerProcess();
    mockSpawn.mockReturnValue(proc);

    const serverPromise = ensureCodexServer(4501);
    // Simulate server ready signal
    process.nextTick(() => proc.stdout.emit('data', Buffer.from('Listening')));

    const url = await serverPromise;

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn.mock.calls[0][0]).toMatch(/codex/);
    expect(url).toBe('ws://127.0.0.1:4501');
  });

  it('returns cached URL on second call without re-spawning', async () => {
    const proc = createMockServerProcess();
    mockSpawn.mockReturnValue(proc);

    const p1 = ensureCodexServer(4501);
    process.nextTick(() => proc.stdout.emit('data', Buffer.from('Listening')));
    await p1;

    const p2 = ensureCodexServer(4501);
    await p2;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('rejects when spawn emits error', async () => {
    const proc = createMockServerProcess();
    mockSpawn.mockReturnValue(proc);

    const serverPromise = ensureCodexServer(4501);
    process.nextTick(() => proc.emit('error', new Error('codex not found')));

    await expect(serverPromise).rejects.toThrow('codex not found');
  });
});

// ── createCodexClient ─────────────────────────────────────────────

describe('createCodexClient', () => {
  const config = { provider: 'codex' as const, apiKey: '', model: 'o4-mini' };

  function setupServerMock() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    proc.pid = 1;
    mockSpawn.mockReturnValue(proc);
    // Auto-emit ready signal
    const origSpawn = mockSpawn.getMockImplementation();
    mockSpawn.mockImplementation((...args: any[]) => {
      const p = origSpawn!(...args);
      process.nextTick(() => p.stdout.emit('data', Buffer.from('Listening')));
      return p;
    });
    return proc;
  }

  function getLastWs(): MockWebSocket {
    return mockWsInstances[mockWsInstances.length - 1];
  }

  function replyWithSuccess(ws: MockWebSocket, content: string, id?: string) {
    process.nextTick(() => {
      ws.emit('open');
      process.nextTick(() => {
        const sentMsg = JSON.parse(ws.send.mock.calls[0][0]);
        ws.emit('message', JSON.stringify({
          jsonrpc: '2.0',
          id: sentMsg.id,
          result: {
            choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
          },
        }));
      });
    });
  }

  it('has correct provider and model', () => {
    const client = createCodexClient(config);
    expect(client.provider).toBe('codex');
    expect(client.model).toBe('o4-mini');
  });

  it('sends a well-formed JSON-RPC chat request', async () => {
    setupServerMock();
    const client = createCodexClient(config);
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];

    const completePromise = client.complete(messages);
    await new Promise(r => process.nextTick(r)); // let server spawn
    const ws = getLastWs();
    replyWithSuccess(ws, 'Hi there!');

    await completePromise;

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.jsonrpc).toBe('2.0');
    expect(sent.method).toBe('chat');
    expect(sent.params.model).toBe('o4-mini');
    expect(sent.params.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('returns CompletionResponse with text content', async () => {
    setupServerMock();
    const client = createCodexClient(config);

    const completePromise = client.complete([{ role: 'user', content: 'Hi' }]);
    await new Promise(r => process.nextTick(r));
    const ws = getLastWs();
    replyWithSuccess(ws, 'Hello!');

    const response = await completePromise;

    expect(response.choices[0].message.content).toBe('Hello!');
    expect(response.choices[0].finish_reason).toBe('stop');
  });

  it('includes tools in the request when provided', async () => {
    setupServerMock();
    const client = createCodexClient(config);
    const tools: ToolFunctionDef[] = [{
      type: 'function',
      function: { name: 'search', description: 'Search', parameters: {} },
    }];

    const completePromise = client.complete([{ role: 'user', content: 'Search' }], { tools });
    await new Promise(r => process.nextTick(r));
    const ws = getLastWs();
    replyWithSuccess(ws, 'Done');

    await completePromise;

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.params.tools).toHaveLength(1);
    expect(sent.params.tools[0].function.name).toBe('search');
  });

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createCodexClient(config);

    await expect(
      client.complete([{ role: 'user', content: 'Hi' }], { signal: controller.signal })
    ).rejects.toThrow(/abort/i);
  });

  it('rejects when WebSocket emits error', async () => {
    setupServerMock();
    const client = createCodexClient(config);

    const completePromise = client.complete([{ role: 'user', content: 'Hi' }]);
    await new Promise(r => process.nextTick(r));
    const ws = getLastWs();
    process.nextTick(() => {
      ws.emit('open');
      process.nextTick(() => ws.emit('error', new Error('WS connection failed')));
    });

    await expect(completePromise).rejects.toThrow('WS connection failed');
  });

  it('closes WebSocket when abort fires mid-flight', async () => {
    setupServerMock();
    const controller = new AbortController();
    const client = createCodexClient(config);

    const completePromise = client.complete(
      [{ role: 'user', content: 'Hi' }],
      { signal: controller.signal }
    );
    await new Promise(r => process.nextTick(r));
    const ws = getLastWs();
    process.nextTick(() => {
      ws.emit('open');
      process.nextTick(() => controller.abort());
    });

    await expect(completePromise).rejects.toThrow(/abort/i);
    expect(ws.close).toHaveBeenCalled();
  });
});

// ── testCodexConnection ───────────────────────────────────────────

describe('testCodexConnection', () => {
  const config = { provider: 'codex' as const, apiKey: '', model: 'o4-mini' };

  it('returns success: true when complete resolves', async () => {
    // Pre-seed the server cache so ensureCodexServer doesn't spawn
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    mockSpawn.mockImplementation(() => {
      process.nextTick(() => proc.stdout.emit('data', Buffer.from('Listening')));
      return proc;
    });

    const testPromise = testCodexConnection(config);
    // Let the server spawn and WS connect
    await new Promise(r => setTimeout(r, 20));
    const ws = mockWsInstances[mockWsInstances.length - 1];
    if (ws) {
      ws.emit('open');
      await new Promise(r => process.nextTick(r));
      const sent = JSON.parse(ws.send.mock.calls[0]?.[0] ?? '{}');
      ws.emit('message', JSON.stringify({
        jsonrpc: '2.0', id: sent.id,
        result: { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] },
      }));
    }

    const result = await testPromise;
    expect(result.success).toBe(true);
  });

  it('returns success: false with error message when complete rejects', async () => {
    // Make WebSocket error immediately
    const OrigWs = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = class extends EventEmitter {
      static OPEN = 1;
      readyState = 0;
      send = vi.fn();
      close = vi.fn();
      constructor() {
        super();
        process.nextTick(() => this.emit('error', new Error('Not authenticated')));
      }
    };

    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    mockSpawn.mockImplementation(() => {
      process.nextTick(() => proc.stdout.emit('data', Buffer.from('Listening')));
      return proc;
    });

    const result = await testCodexConnection(config);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    (globalThis as any).WebSocket = OrigWs;
  });
});
