import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProviderConfig, LLMClient } from '../llm-types';

// Stub adapters — each returns a minimal LLMClient tagged with the provider
const stubClient = (provider: string): LLMClient => ({
  provider,
  model: 'test-model',
  complete: vi.fn(),
});

vi.mock('../providers/openai-compat.js', () => ({
  createOpenAICompatClient: (config: LLMProviderConfig) =>
    stubClient(config.provider),
  testOpenAICompatConnection: vi.fn(),
}));

vi.mock('../providers/anthropic.js', () => ({
  createAnthropicClient: (config: LLMProviderConfig) =>
    stubClient(config.provider),
  testAnthropicConnection: vi.fn(),
}));

vi.mock('../providers/claude-code.js', () => ({
  createClaudeCodeClient: (config: LLMProviderConfig) =>
    stubClient(config.provider),
  testClaudeCodeConnection: vi.fn(),
}));

vi.mock('../llm-settings.js', () => ({
  getActiveProviderConfig: vi.fn(() => null),
}));

// Import after mocks are registered
import { createLLMClient } from '../llm-client';
import { getActiveProviderConfig } from '../llm-settings';

const mockedGetActive = vi.mocked(getActiveProviderConfig);

describe('createLLMClient routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes custom provider ID (e.g. groq) to openai-compat adapter', () => {
    const config: LLMProviderConfig = {
      provider: 'groq',
      apiKey: 'gsk_test_key_12345678',
      model: 'llama-3.3-70b-versatile',
      baseURL: 'https://api.groq.com/openai/v1',
    };

    const client = createLLMClient(config);
    expect(client.provider).toBe('groq');
  });

  it('routes anthropic to anthropic adapter', () => {
    const config: LLMProviderConfig = {
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-test12345678',
      model: 'claude-sonnet-4-20250514',
    };

    const client = createLLMClient(config);
    expect(client.provider).toBe('anthropic');
  });

  it('routes claude-code to claude-code adapter', () => {
    const config: LLMProviderConfig = {
      provider: 'claude-code',
      apiKey: '',
      model: 'sonnet',
    };

    const client = createLLMClient(config);
    expect(client.provider).toBe('claude-code');
  });

  it('routes openai to openai-compat adapter', () => {
    const config: LLMProviderConfig = {
      provider: 'openai',
      apiKey: 'sk-test1234567890abcdef',
      model: 'gpt-4o',
    };

    const client = createLLMClient(config);
    expect(client.provider).toBe('openai');
  });

  it('throws descriptive error when no provider is configured', () => {
    mockedGetActive.mockReturnValue(null);

    expect(() => createLLMClient()).toThrow(
      'No LLM provider configured. Open Settings to add an API key.',
    );
  });
});
