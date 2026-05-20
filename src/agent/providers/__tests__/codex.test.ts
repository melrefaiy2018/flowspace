/**
 * Tests for the Codex CLI provider adapter (OAuth / app-server protocol).
 *
 * Mocks child_process.spawn and globalThis.WebSocket to test the
 * initialize → thread/start → turn/start → turn/completed flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChatMessage } from '../../llm-types';

// ── Mock child_process ─────────────────────────────────────────────

const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// ── MockWebSocket ──────────────────────────────────────────────────

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
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

// ── Dynamic import after mocks ─────────────────────────────────────

const {
  ensureCodexServer,
  resetCodexServerCache,
  resetCodexDetectionCache,
  createCodexClient,
  testCodexConnection,
} = await import('../codex.js');

// ── Helpers ────────────────────────────────────────────────────────

function createMockServerProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function setupServerMock() {
  const proc = createMockServerProcess();
  mockSpawn.mockImplementation(() => {
    process.nextTick(() => proc.stdout.emit('data', Buffer.from('listening on:')));
    return proc;
  });
  return proc;
}

function getLastWs(): MockWebSocket {
  return mockWsInstances[mockWsInstances.length - 1];
}

// ── Setup / teardown ───────────────────────────────────────────────

beforeEach(() => {
  mockSpawn.mockReset();
  mockExecFileSync.mockReset();
  // Make execFileSync succeed so codex bin detection works
  mockExecFileSync.mockReturnValue(Buffer.from('codex-cli 0.132.0'));
  mockWsInstances.length = 0;
  resetCodexServerCache();
  resetCodexDetectionCache();
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  delete (globalThis as any).WebSocket;
});

// ── ensureCodexServer ──────────────────────────────────────────────

describe('ensureCodexServer', () => {
  it('spawns codex app-server and resolves with ws URL', async () => {
    setupServerMock();
    const url = await ensureCodexServer(4501);
    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn.mock.calls[0][1]).toContain('app-server');
    expect(url).toBe('ws://127.0.0.1:4501');
  });

  it('returns cached URL on second call', async () => {
    setupServerMock();
    await ensureCodexServer(4501);
    await ensureCodexServer(4501);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('rejects when spawn emits error', async () => {
    const proc = createMockServerProcess();
    mockSpawn.mockReturnValue(proc);
    const p = ensureCodexServer(4501);
    process.nextTick(() => proc.emit('error', new Error('codex not found')));
    await expect(p).rejects.toThrow('codex not found');
  });
});

// ── createCodexClient ──────────────────────────────────────────────

describe('createCodexClient', () => {
  const config = { provider: 'codex' as const, apiKey: '', model: 'gpt-5.5' };

  /** Drive the full initialize → thread/start → turn/start → turn/completed flow */
  function driveFlow(ws: MockWebSocket, responseText: string) {
    process.nextTick(async () => {
      ws.emit('open');
      // Small delay so send() gets called before we check it
      await new Promise(r => setTimeout(r, 5));

      // Respond to initialize
      const calls = ws.send.mock.calls;
      const initMsg = JSON.parse(calls[0][0]);
      ws.emit('message', JSON.stringify({ jsonrpc: '2.0', id: initMsg.id, result: { userAgent: 'test' } }));

      await new Promise(r => setTimeout(r, 5));

      // Respond to thread/start
      const threadStartMsg = JSON.parse(ws.send.mock.calls[1][0]);
      ws.emit('message', JSON.stringify({
        jsonrpc: '2.0',
        id: threadStartMsg.id,
        result: { thread: { id: 'thread-123' } },
      }));

      await new Promise(r => setTimeout(r, 5));

      // Respond to turn/start (ACK) + streaming + completed
      ws.emit('message', JSON.stringify({
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-123', turnId: 'turn-1', itemId: 'item-1', delta: responseText },
      }));
      ws.emit('message', JSON.stringify({
        method: 'turn/completed',
        params: { threadId: 'thread-123', turn: { id: 'turn-1' } },
      }));
    });
  }

  it('has correct provider and model', () => {
    const client = createCodexClient(config);
    expect(client.provider).toBe('codex');
    expect(client.model).toBe('gpt-5.5');
  });

  it('sends initialize then thread/start then turn/start in order', async () => {
    setupServerMock();
    const client = createCodexClient(config);
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];

    const completePromise = client.complete(messages);
    await new Promise(r => setTimeout(r, 10));
    const ws = getLastWs();
    driveFlow(ws, 'Hi!');

    await completePromise;

    const sent = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    expect(sent[0].method).toBe('initialize');
    expect(sent[1].method).toBe('thread/start');
    expect(sent[2].method).toBe('turn/start');
    expect(sent[2].params.threadId).toBe('thread-123');
  });

  it('returns accumulated text from agentMessage/delta', async () => {
    setupServerMock();
    const client = createCodexClient(config);

    const completePromise = client.complete([{ role: 'user', content: 'Hi' }]);
    await new Promise(r => setTimeout(r, 10));
    const ws = getLastWs();
    driveFlow(ws, 'Hello there!');

    const result = await completePromise;
    expect(result.choices[0].message.content).toBe('Hello there!');
    expect(result.choices[0].finish_reason).toBe('stop');
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
    await new Promise(r => setTimeout(r, 10));
    const ws = getLastWs();
    process.nextTick(() => ws.emit('error', new Error('WS connection failed')));
    await expect(completePromise).rejects.toThrow('WS connection failed');
  });

  it('rejects with error when thread/start fails', async () => {
    setupServerMock();
    const client = createCodexClient(config);
    const completePromise = client.complete([{ role: 'user', content: 'Hi' }]);
    await new Promise(r => setTimeout(r, 10));
    const ws = getLastWs();

    process.nextTick(async () => {
      ws.emit('open');
      await new Promise(r => setTimeout(r, 5));
      const initMsg = JSON.parse(ws.send.mock.calls[0][0]);
      ws.emit('message', JSON.stringify({ jsonrpc: '2.0', id: initMsg.id, result: {} }));
      await new Promise(r => setTimeout(r, 5));
      const threadStartMsg = JSON.parse(ws.send.mock.calls[1][0]);
      ws.emit('message', JSON.stringify({
        jsonrpc: '2.0', id: threadStartMsg.id,
        error: { code: -32600, message: 'Not authenticated' },
      }));
    });

    await expect(completePromise).rejects.toThrow('Not authenticated');
  });
});

// ── testCodexConnection ────────────────────────────────────────────

describe('testCodexConnection', () => {
  const config = { provider: 'codex' as const, apiKey: '', model: 'gpt-5.5' };

  it('returns success: false with error when server spawn fails', async () => {
    const proc = createMockServerProcess();
    mockSpawn.mockReturnValue(proc);
    // Emit error immediately so ensureCodexServer rejects
    process.nextTick(() => proc.emit('error', new Error('spawn ENOENT')));

    const result = await testCodexConnection(config);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spawn ENOENT/i);
  }, 10_000);
});

// ── reset helpers ──────────────────────────────────────────────────

describe('reset helpers', () => {
  it('resetCodexDetectionCache does not throw', () => {
    expect(() => resetCodexDetectionCache()).not.toThrow();
  });

  it('resetCodexServerCache kills server process and clears cache', async () => {
    const proc = setupServerMock();
    await ensureCodexServer(4501);
    resetCodexServerCache();
    expect(proc.kill).toHaveBeenCalled();
    // After reset, next call should spawn again
    setupServerMock();
    await ensureCodexServer(4501);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });
});
