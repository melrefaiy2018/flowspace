/**
 * Anthropic provider adapter — uses raw fetch, no SDK dependency.
 *
 * Handles the format differences between OpenAI and Anthropic APIs:
 * - System prompt is a top-level parameter, not a message
 * - Tool definitions use `input_schema` instead of `parameters`
 * - Tool results use content blocks with `tool_result` type
 * - Different finish reasons: `end_turn` vs `stop`, `tool_use` vs `tool_calls`
 */

import type {
  ChatMessage,
  CompletionOptions,
  CompletionResponse,
  CompletionToolCall,
  LLMClient,
  LLMProviderConfig,
  ToolFunctionDef,
} from '../llm-types.js';
import { isMaskedKey } from '../llm-settings.js';

const ANTHROPIC_API_VERSION = '2023-06-01';

// ── Format converters ───────────────────────────────────────────────

interface AnthropicTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

function convertToolsToAnthropic(tools: readonly ToolFunctionDef[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: 'tool_result'; readonly tool_use_id: string; readonly content: string };

function convertMessagesToAnthropic(messages: readonly ChatMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const converted: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Anthropic: system is a top-level param, not a message
      system = msg.content;
      continue;
    }

    if (msg.role === 'user') {
      converted.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      // Convert assistant message with possible tool_calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const blocks: AnthropicContentBlock[] = [];
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        converted.push({ role: 'assistant', content: blocks });
      } else {
        converted.push({ role: 'assistant', content: msg.content ?? '' });
      }
      continue;
    }

    if (msg.role === 'tool') {
      // Anthropic: tool results are user messages with tool_result content blocks
      // Must be merged into a single user message if consecutive
      const toolBlock: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content,
      };

      const lastMsg = converted[converted.length - 1];
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        // Merge into existing user message — immutable replacement
        converted[converted.length - 1] = {
          ...lastMsg,
          content: [...(lastMsg.content as AnthropicContentBlock[]), toolBlock],
        };
      } else {
        converted.push({ role: 'user', content: [toolBlock] });
      }
    }
  }

  return { system, messages: converted };
}

// ── Response converter ──────────────────────────────────────────────

interface AnthropicResponse {
  readonly content: readonly AnthropicResponseBlock[];
  readonly stop_reason: string;
  readonly model: string;
}

type AnthropicResponseBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> };

function convertAnthropicResponse(response: AnthropicResponse): CompletionResponse {
  let textContent = '';
  const toolCalls: CompletionToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  // Map Anthropic stop_reason to OpenAI finish_reason
  const finishReason = response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop';

  return {
    choices: [{
      message: {
        role: 'assistant',
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finish_reason: finishReason,
    }],
  };
}

// ── Client ──────────────────────────────────────────────────────────

export function createAnthropicClient(config: LLMProviderConfig): LLMClient {
  const baseURL = config.baseURL || 'https://api.anthropic.com';
  const apiKey = (config.apiKey && !isMaskedKey(config.apiKey)) ? config.apiKey : '';

  return {
    model: config.model,
    provider: 'anthropic',

    async complete(
      messages: readonly ChatMessage[],
      options: CompletionOptions = {},
    ): Promise<CompletionResponse> {
      const { system, messages: anthropicMessages } = convertMessagesToAnthropic(messages);

      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: 4096,
        messages: anthropicMessages,
      };

      if (system) body.system = system;
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.tools && options.tools.length > 0) {
        body.tools = convertToolsToAnthropic(options.tools);
      }

      const response = await fetch(`${baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let errorMessage: string;
        try {
          const parsed = JSON.parse(errorBody);
          errorMessage = parsed?.error?.message || `Anthropic API error: ${response.status}`;
        } catch {
          errorMessage = `Anthropic API error: ${response.status} ${errorBody.slice(0, 200)}`;
        }
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as AnthropicResponse;
      return convertAnthropicResponse(data);
    },
  };
}

/**
 * Test an Anthropic connection with a minimal request.
 */
export async function testAnthropicConnection(config: LLMProviderConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const client = createAnthropicClient(config);
    const response = await client.complete(
      [{ role: 'user', content: 'Say "ok".' }],
      { temperature: 0 },
    );
    const content = response.choices[0]?.message?.content;
    if (content === null || content === undefined) {
      return { success: false, error: 'No response from model' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Connection failed' };
  }
}
