/**
 * Codex CLI provider adapter.
 *
 * Lets users with a ChatGPT Plus/Pro subscription use OpenAI models
 * without an API key. Authentication is handled by the `codex` CLI
 * via browser OAuth (`codex login`).
 *
 * Architecture:
 *   1. Spawn `codex app-server --listen ws://127.0.0.1:<port>` once per process
 *   2. Open a WebSocket per `complete()` call
 *   3. Send a JSON-RPC 2.0 `chat` request
 *   4. Resolve with a normalized `CompletionResponse`
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'node:util';
import type {
  LLMClient,
  LLMProviderConfig,
  ChatMessage,
  CompletionOptions,
  CompletionResponse,
  ToolFunctionDef,
} from '../llm-types.js';

const execFileAsync = promisify(execFile);

// ── Constants ──────────────────────────────────────────────────────

const CODEX_WS_PORT = 4501;
const CODEX_WS_URL = `ws://127.0.0.1:${CODEX_WS_PORT}`;
const SERVER_READY_TIMEOUT_MS = 15_000;
const DETECT_TIMEOUT_MS = 5_000;
const COMPLETION_TIMEOUT_MS = 60_000;

const CODEX_PATHS = [
  'codex',
  '/usr/local/bin/codex',
  '/opt/homebrew/bin/codex',
  `${process.env.HOME}/.npm-global/bin/codex`,
  `${process.env.HOME}/.local/bin/codex`,
];

// ── Detection cache ────────────────────────────────────────────────

interface DetectResult {
  available: boolean;
  path?: string;
}

let cachedDetection: DetectResult | null = null;

export function resetCodexDetectionCache(): void {
  cachedDetection = null;
}

export async function detectCodexCLI(): Promise<DetectResult> {
  if (cachedDetection) return cachedDetection;

  for (const candidate of CODEX_PATHS) {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), DETECT_TIMEOUT_MS),
      );
      await Promise.race([execFileAsync(candidate, ['--version']), timeout]);
      cachedDetection = { available: true, path: candidate };
      return cachedDetection;
    } catch {
      // try next
    }
  }

  cachedDetection = { available: false };
  return cachedDetection;
}

// ── Server lifecycle ───────────────────────────────────────────────

let cachedServerUrl: string | null = null;
let cachedServerProcess: ReturnType<typeof spawn> | null = null;
let pendingServerPromise: Promise<string> | null = null;

export function resetCodexServerCache(): void {
  cachedServerUrl = null;
  pendingServerPromise = null;
  if (cachedServerProcess) {
    try { cachedServerProcess.kill(); } catch { /* ignore */ }
    cachedServerProcess = null;
  }
}

// Register cleanup once at module level — not per call
process.once('exit', () => resetCodexServerCache());

export function ensureCodexServer(port = CODEX_WS_PORT): Promise<string> {
  if (cachedServerUrl) return Promise.resolve(cachedServerUrl);
  // Prevent concurrent callers from spawning duplicate processes
  if (pendingServerPromise) return pendingServerPromise;

  pendingServerPromise = new Promise<string>((resolve, reject) => {
    const detection = cachedDetection;
    const codexBin = detection?.path ?? 'codex';

    const proc = spawn(codexBin, ['app-server', '--listen', `ws://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    cachedServerProcess = proc;

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Codex app-server did not start within ${SERVER_READY_TIMEOUT_MS}ms`));
    }, SERVER_READY_TIMEOUT_MS);

    proc.stdout?.on('data', () => {
      clearTimeout(timer);
      cachedServerUrl = `ws://127.0.0.1:${port}`;
      resolve(cachedServerUrl);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      cachedServerUrl = null;
      cachedServerProcess = null;
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        cachedServerUrl = null;
        cachedServerProcess = null;
      }
    });
  }).finally(() => {
    pendingServerPromise = null;
  });

  return pendingServerPromise;
}

// ── Message conversion ─────────────────────────────────────────────

type CodexMessage = Record<string, unknown>;

export function buildCodexMessages(messages: readonly ChatMessage[]): CodexMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return { role: 'tool', tool_call_id: msg.tool_call_id, content: msg.content };
    }
    if (msg.role === 'assistant') {
      const out: CodexMessage = { role: 'assistant', content: msg.content ?? null };
      if (msg.tool_calls) out.tool_calls = msg.tool_calls;
      return out;
    }
    return { role: msg.role, content: msg.content };
  });
}

// ── Response parsing ───────────────────────────────────────────────

export function parseCodexResponse(raw: unknown): CompletionResponse {
  const obj = raw as Record<string, any>;

  if (obj.error) {
    throw new Error(obj.error.message ?? 'Codex error');
  }

  const choices: CompletionResponse['choices'] = (obj.result?.choices ?? []).map((c: any) => ({
    message: {
      role: 'assistant' as const,
      content: c.message?.content ?? null,
      ...(c.message?.tool_calls ? { tool_calls: c.message.tool_calls } : {}),
    },
    finish_reason: c.finish_reason ?? 'stop',
  }));

  return { choices };
}

// ── LLMClient implementation ───────────────────────────────────────

let rpcIdCounter = 0;

export function createCodexClient(config: LLMProviderConfig): LLMClient {
  return {
    provider: 'codex',
    model: config.model || 'o4-mini',

    async complete(
      messages: readonly ChatMessage[],
      options: CompletionOptions = {},
    ): Promise<CompletionResponse> {
      const { signal, tools } = options;

      if (signal?.aborted) {
        throw new Error('Request aborted');
      }

      const wsUrl = await ensureCodexServer();
      const id = String(++rpcIdCounter);

      const request = {
        jsonrpc: '2.0',
        id,
        method: 'chat',
        params: {
          model: config.model || 'o4-mini',
          messages: buildCodexMessages(messages),
          ...(tools && tools.length > 0 ? { tools } : {}),
        },
      };

      return new Promise((resolve, reject) => {
        const WS = (globalThis as any).WebSocket as typeof WebSocket;
        const ws = new WS(wsUrl) as any;
        let settled = false;

        const cleanup = () => {
          settled = true;
          clearTimeout(timeoutTimer);
          try { ws.close(); } catch { /* ignore */ }
        };

        // Timeout guard — reject if Codex never responds
        const timeoutTimer = setTimeout(() => {
          if (!settled) {
            cleanup();
            signal?.removeEventListener('abort', onAbort);
            reject(new Error(`Codex completion timed out after ${COMPLETION_TIMEOUT_MS}ms`));
          }
        }, COMPLETION_TIMEOUT_MS);

        const onAbort = () => {
          cleanup();
          reject(new Error('Request aborted'));
        };

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        ws.addEventListener
          ? ws.addEventListener('open', onOpen)
          : ws.on('open', onOpen);
        ws.addEventListener
          ? ws.addEventListener('message', onMessage)
          : ws.on('message', onMessage);
        ws.addEventListener
          ? ws.addEventListener('error', onError)
          : ws.on('error', onError);

        function onOpen() {
          ws.send(JSON.stringify(request));
        }

        function onMessage(event: any) {
          try {
            const text = typeof event === 'string' ? event
              : event?.data ? event.data
              : event;
            const parsed = JSON.parse(text);
            if (parsed.id !== id) return; // not our message
            signal?.removeEventListener('abort', onAbort);
            cleanup();
            resolve(parseCodexResponse(parsed));
          } catch (err) {
            signal?.removeEventListener('abort', onAbort);
            cleanup();
            reject(err);
          }
        }

        function onError(err: any) {
          signal?.removeEventListener('abort', onAbort);
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err.message ?? err)));
        }
      });
    },
  };
}

// ── Connection test ────────────────────────────────────────────────

export async function testCodexConnection(
  config: LLMProviderConfig,
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = createCodexClient(config);
    await client.complete([{ role: 'user', content: 'Say "ok".' }]);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Connection failed' };
  }
}
