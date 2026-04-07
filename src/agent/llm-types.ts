/**
 * Multi-LLM provider types.
 *
 * Shared between server (provider adapters, settings persistence)
 * and frontend (settings UI, model display).
 */

// ── Provider identifiers ────────────────────────────────────────────

/** Well-known built-in presets with dedicated UI cards. */
export type BuiltinProviderId = 'anthropic' | 'openai' | 'openrouter' | 'lmstudio' | 'claude-code' | 'codex';

/** Any string is a valid provider ID — custom providers use their user-chosen slug. */
export type LLMProviderId = BuiltinProviderId | (string & {});

// ── Provider configuration (persisted in .llm-settings.json) ────────

export interface LLMProviderConfig {
  readonly provider: LLMProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly baseURL?: string;
  /** Human-readable display name (used by custom providers; built-in presets use ProviderMeta.name). */
  readonly name?: string;
}

export interface LLMSettings {
  readonly activeProvider: LLMProviderId;
  readonly providers: Partial<Record<LLMProviderId, LLMProviderConfig>>;
}

// ── Provider metadata (static, used by settings UI) ─────────────────

export interface ModelOption {
  readonly id: string;
  readonly label: string;
}

export interface ProviderMeta {
  readonly id: LLMProviderId;
  readonly name: string;
  readonly requiresKey: boolean;
  readonly defaultBaseURL: string;
  readonly models: readonly ModelOption[];
  readonly keyPlaceholder: string;
  readonly keyPrefix?: string;
}

// ── Normalized completion interface ─────────────────────────────────

export interface CompletionMessage {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly tool_calls?: readonly CompletionToolCall[];
}

export interface CompletionToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface CompletionChoice {
  readonly message: CompletionMessage;
  readonly finish_reason: string;
}

export interface CompletionResponse {
  readonly choices: readonly CompletionChoice[];
}

// ── Tool definition (OpenAI format — the canonical format) ──────────

export interface ToolFunctionDef {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

// ── Chat message types for the completion API ───────────────────────

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string | null; readonly tool_calls?: readonly CompletionToolCall[] }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

// ── Unified LLM client interface ────────────────────────────────────

export interface LLMClient {
  /** Send a chat completion request (with optional tool definitions). */
  complete(
    messages: readonly ChatMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResponse>;

  /** The model string currently configured. */
  readonly model: string;

  /** The provider this client is using. */
  readonly provider: LLMProviderId;
}

export interface CompletionOptions {
  readonly tools?: readonly ToolFunctionDef[];
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}
