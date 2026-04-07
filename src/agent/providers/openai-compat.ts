/**
 * OpenAI-compatible provider adapter.
 *
 * Works with: OpenAI, Z.AI (GLM), OpenRouter, LM Studio.
 * All use the same API format with different baseURLs.
 */

import OpenAI from 'openai';
import type {
  ChatMessage,
  CompletionOptions,
  CompletionResponse,
  LLMClient,
  LLMProviderConfig,
} from '../llm-types.js';
import { getProviderMeta } from '../llm-providers-meta.js';
import { isMaskedKey } from '../llm-settings.js';

/**
 * Resolve a safe ASCII-only API key for the OpenAI SDK.
 * Masked keys (containing unicode bullets) and empty strings
 * are replaced with a dummy value — LM Studio ignores the key anyway.
 */
function resolveApiKey(key: string | undefined): string {
  if (!key || isMaskedKey(key)) return 'not-required';
  return key;
}

export function createOpenAICompatClient(config: LLMProviderConfig): LLMClient {
  const meta = getProviderMeta(config.provider);
  let baseURL = config.baseURL || meta?.defaultBaseURL || 'https://api.openai.com/v1';
  // LM Studio/local providers: auto-append /v1 if missing
  if (config.provider === 'lmstudio' && baseURL && !baseURL.endsWith('/v1') && !baseURL.endsWith('/v1/')) {
    baseURL = baseURL.replace(/\/+$/, '') + '/v1';
  }

  const client = new OpenAI({
    apiKey: resolveApiKey(config.apiKey),
    baseURL,
  });

  return {
    model: config.model,
    provider: config.provider,

    async complete(
      messages: readonly ChatMessage[],
      options: CompletionOptions = {},
    ): Promise<CompletionResponse> {
      const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model: config.model,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.tools && options.tools.length > 0 && { tools: options.tools as OpenAI.ChatCompletionTool[] }),
      };

      const response = await client.chat.completions.create(params, {
        signal: options.signal,
      });

      return {
        choices: (response.choices ?? []).map((choice) => ({
          message: {
            role: 'assistant' as const,
            content: choice.message.content,
            tool_calls: choice.message.tool_calls
              ?.filter((tc): tc is Extract<typeof tc, { function: unknown }> => 'function' in tc)
              .map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              })),
          },
          finish_reason: choice.finish_reason ?? 'stop',
        })),
      };
    },
  };
}

/**
 * Test an OpenAI-compatible connection with a minimal request.
 */
export async function testOpenAICompatConnection(config: LLMProviderConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const client = createOpenAICompatClient(config);
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
