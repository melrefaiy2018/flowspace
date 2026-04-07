/**
 * Unified LLM client factory.
 *
 * Single entry point for all LLM usage across the app.
 * Reads the active provider config from settings and returns the
 * appropriate adapter (OpenAI-compatible or Anthropic).
 */

import type { LLMClient, LLMProviderConfig } from './llm-types.js';
import { getActiveProviderConfig } from './llm-settings.js';
import { createOpenAICompatClient, testOpenAICompatConnection } from './providers/openai-compat.js';
import { createAnthropicClient, testAnthropicConnection } from './providers/anthropic.js';
import { createClaudeCodeClient, testClaudeCodeConnection } from './providers/claude-code.js';
import { createCodexClient, testCodexConnection } from './providers/codex.js';

/**
 * Create an LLM client from explicit config or from persisted settings.
 * Throws if no provider is configured.
 */
export function createLLMClient(config?: LLMProviderConfig): LLMClient {
  const resolved = config ?? getActiveProviderConfig();
  if (!resolved) {
    throw new Error('No LLM provider configured. Open Settings to add an API key.');
  }

  if (resolved.provider === 'anthropic') {
    return createAnthropicClient(resolved);
  }

  if (resolved.provider === 'claude-code') {
    return createClaudeCodeClient(resolved);
  }

  if (resolved.provider === 'codex') {
    return createCodexClient(resolved);
  }

  // OpenAI, OpenRouter, LM Studio, and all custom providers use OpenAI-compatible format
  return createOpenAICompatClient(resolved);
}

/**
 * Test a provider connection without persisting anything.
 */
export async function testConnection(config: LLMProviderConfig): Promise<{ success: boolean; error?: string }> {
  if (config.provider === 'anthropic') {
    return testAnthropicConnection(config);
  }
  if (config.provider === 'claude-code') {
    return testClaudeCodeConnection(config);
  }
  if (config.provider === 'codex') {
    return testCodexConnection(config);
  }
  return testOpenAICompatConnection(config);
}

/**
 * Check if any LLM provider is configured (settings file or env var).
 */
export function isLLMConfigured(): boolean {
  return getActiveProviderConfig() !== null;
}
