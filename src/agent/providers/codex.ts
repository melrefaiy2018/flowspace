/**
 * Codex CLI provider adapter (ChatGPT Plus / OAuth).
 *
 * Uses `codex app-server --listen ws://...` as a subprocess.
 * Auth is handled by the codex CLI (run `codex login` once).
 * No API key required — works with any ChatGPT Plus subscription.
 *
 * Protocol:
 *   1. Spawn `codex app-server --listen ws://127.0.0.1:<port>`
 *   2. Connect via WebSocket
 *   3. Send `initialize` RPC
 *   4. Send `thread/start` → get threadId from result
 *   5. Send `turn/start` with messages
 *   6. Collect `item/agentMessage/delta` notifications for streaming text
 *   7. Resolve on `turn/completed`
 */

import { execFileSync, spawn } from 'child_process';
import type {
  ChatMessage,
  CompletionOptions,
  CompletionResponse,
  LLMClient,
  LLMProviderConfig,
} from '../llm-types.js';

// ── Constants ──────────────────────────────────────────────────────

const CODEX_WS_PORT = 4501;
const SERVER_READY_TIMEOUT_MS = 15_000;
const COMPLETION_TIMEOUT_MS = 120_000;

// Candidate codex script paths (the .js entrypoint, not the shell wrapper)
const CODEX_SCRIPT_PATHS = [
  '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js',
  '/usr/local/lib/node_modules/@openai/codex/bin/codex.js',
  `${process.env.HOME}/.npm-global/lib/node_modules/@openai/codex/bin/codex.js`,
  `${process.env.HOME}/.local/lib/node_modules/@openai/codex/bin/codex.js`,
];

// Candidate codex wrapper paths (shell symlinks — only work if `node` is in PATH)
const CODEX_WRAPPER_PATHS = [
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
  `${process.env.HOME}/.npm-global/bin/codex`,
  `${process.env.HOME}/.local/bin/codex`,
];

// Extra PATH dirs for Tauri .app bundles (same pattern as claude-code.ts)
const EXTRA_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  `${process.env.HOME}/.npm-global/bin`,
  `${process.env.HOME}/.local/bin`,
];

function augmentedEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? '';
  const extra = EXTRA_PATH_DIRS.filter((d) => !currentPath.includes(d)).join(':');
  return {
    ...process.env,
    PATH: extra ? `${extra}:${currentPath}` : currentPath,
  };
}

/**
 * Resolve codex as { bin, args } so we can run either:
 *   - node /path/to/codex.js  (preferred: works even without node in PATH)
 *   - codex wrapper            (fallback: only works if node is in PATH)
 *
 * `process.execPath` is the Node binary that is *already* running the server,
 * so it is guaranteed to be present inside Tauri .app bundles.
 */
function resolveCodexCommand(env: NodeJS.ProcessEnv): { bin: string; leadingArgs: string[] } {
  const { existsSync } = require('fs') as typeof import('fs');

  // Prefer: invoke the .js entrypoint directly via the current Node runtime
  for (const scriptPath of CODEX_SCRIPT_PATHS) {
    if (existsSync(scriptPath)) {
      return { bin: process.execPath, leadingArgs: [scriptPath] };
    }
  }

  // Fallback: try shell wrappers (need node in PATH — may work if PATH is augmented)
  for (const wrapperPath of CODEX_WRAPPER_PATHS) {
    try {
      execFileSync(wrapperPath, ['--version'], { stdio: 'ignore', env });
      return { bin: wrapperPath, leadingArgs: [] };
    } catch {
      // not found or node missing — try next
    }
  }

  // Last resort: bare 'codex' and let it fail with a clear ENOENT
  return { bin: 'codex', leadingArgs: [] };
}

// ── Detection cache ────────────────────────────────────────────────

export function resetCodexDetectionCache(): void {}

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

process.once('exit', () => resetCodexServerCache());

export function ensureCodexServer(port = CODEX_WS_PORT): Promise<string> {
  if (cachedServerUrl) return Promise.resolve(cachedServerUrl);
  if (pendingServerPromise) return pendingServerPromise;

  pendingServerPromise = new Promise<string>((resolve, reject) => {
    const env = augmentedEnv();

    const codexBin = CODEX_PATHS.find((p) => {
      try {
        execFileSync(p, ['--version'], { stdio: 'ignore', env });
        return true;
      } catch {
        return false;
      }
    }) ?? 'codex';

    const proc = spawn(codexBin, ['app-server', '--listen', `ws://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    cachedServerProcess = proc;

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Codex app-server did not start within ${SERVER_READY_TIMEOUT_MS}ms`));
    }, SERVER_READY_TIMEOUT_MS);

    // Codex can emit startup logs on either stream depending on runtime context.
    const markReady = () => {
      clearTimeout(timer);
      cachedServerUrl = `ws://127.0.0.1:${port}`;
      resolve(cachedServerUrl);
    };
    proc.stdout?.once('data', markReady);
    proc.stderr?.once('data', markReady);

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

// ── Message serialization ──────────────────────────────────────────

/**
 * Build the text input for a turn from the last user message.
 * The Codex app-server manages conversation history via threadId,
 * so we only send the latest user content.
 */
function extractLastUserText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.content;
  }
  return '';
}

/**
 * Build a system + conversation context string from all prior messages.
 * Prepended to the user turn so Codex has full conversation context.
 */
function buildContextText(messages: readonly ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      parts.push(`[System]\n${m.content}`);
    } else if (m.role === 'assistant') {
      parts.push(`[Assistant]\n${m.content ?? ''}`);
    } else if (m.role === 'user') {
      parts.push(`[User]\n${m.content}`);
    } else if (m.role === 'tool') {
      parts.push(`[Tool result]\n${m.content}`);
    }
  }
  return parts.join('\n\n');
}

// ── LLMClient implementation ───────────────────────────────────────

let rpcIdCounter = 0;

export function createCodexClient(config: LLMProviderConfig): LLMClient {
  return {
    provider: 'codex',
    model: config.model || 'gpt-5.5',

    async complete(
      messages: readonly ChatMessage[],
      options: CompletionOptions = {},
    ): Promise<CompletionResponse> {
      const { signal } = options;

      if (signal?.aborted) throw new Error('Request aborted');

      const wsUrl = await ensureCodexServer();

      return new Promise<CompletionResponse>((resolve, reject) => {
        const WS = (globalThis as any).WebSocket as typeof WebSocket;
        const ws = new WS(wsUrl) as any;
        let settled = false;
        let accumulatedText = '';
        let threadId: string | null = null;

        const initId = String(++rpcIdCounter);
        const threadStartId = String(++rpcIdCounter);
        const turnStartId = String(++rpcIdCounter);

        const cleanup = () => {
          settled = true;
          clearTimeout(timeoutTimer);
          try { ws.close(); } catch { /* ignore */ }
        };

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
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        const on = (event: string, handler: (...args: any[]) => void) => {
          if (ws.addEventListener) ws.addEventListener(event, handler);
          else ws.on(event, handler);
        };

        on('open', () => {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            method: 'initialize',
            params: { clientInfo: { name: 'flowspace', version: '1.0' }, capabilities: null },
          }));
        });

        on('message', (event: any) => {
          try {
            const text = typeof event === 'string' ? event
              : event?.data ? event.data
              : String(event);
            const msg = JSON.parse(text);

            // RPC response to initialize → start thread
            if (msg.id === initId && msg.result !== undefined) {
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: threadStartId,
                method: 'thread/start',
                params: {
                  ephemeral: true,
                  ...(config.model ? { model: config.model } : {}),
                },
              }));
              return;
            }

            // RPC response to thread/start → extract threadId, start turn
            if (msg.id === threadStartId) {
              if (msg.error) {
                signal?.removeEventListener('abort', onAbort);
                cleanup();
                reject(new Error(msg.error.message ?? 'thread/start failed'));
                return;
              }
              threadId = msg.result?.thread?.id ?? null;
              if (!threadId) {
                signal?.removeEventListener('abort', onAbort);
                cleanup();
                reject(new Error('Codex: no threadId in thread/start response'));
                return;
              }

              // Build full context as a single user turn
              const contextText = buildContextText(messages);
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: turnStartId,
                method: 'turn/start',
                params: {
                  threadId,
                  input: [{ type: 'text', text: contextText, text_elements: [] }],
                },
              }));
              return;
            }

            // RPC error on turn/start
            if (msg.id === turnStartId && msg.error) {
              signal?.removeEventListener('abort', onAbort);
              cleanup();
              reject(new Error(msg.error.message ?? 'turn/start failed'));
              return;
            }

            // Notification: streaming text delta
            if (msg.method === 'item/agentMessage/delta') {
              accumulatedText += msg.params?.delta ?? '';
              return;
            }

            // Notification: turn completed → resolve
            if (msg.method === 'turn/completed') {
              signal?.removeEventListener('abort', onAbort);
              cleanup();
              resolve({
                choices: [{
                  message: {
                    role: 'assistant',
                    content: accumulatedText.trim() || null,
                  },
                  finish_reason: 'stop',
                }],
              });
              return;
            }

            // Notification: error
            if (msg.method === 'error') {
              signal?.removeEventListener('abort', onAbort);
              cleanup();
              reject(new Error(msg.params?.message ?? 'Codex error'));
            }
          } catch (err) {
            signal?.removeEventListener('abort', onAbort);
            cleanup();
            reject(err);
          }
        });

        on('error', (err: any) => {
          signal?.removeEventListener('abort', onAbort);
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err?.message ?? err)));
        });
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
    const response = await client.complete([{ role: 'user', content: 'Say "ok".' }]);
    const content = response.choices[0]?.message?.content;
    if (content === null || content === undefined) {
      return { success: false, error: 'No response from Codex' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Connection failed' };
  }
}
