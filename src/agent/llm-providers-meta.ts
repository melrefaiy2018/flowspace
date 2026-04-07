/**
 * Static provider metadata — display names, models, defaults.
 * Consumed by the settings API and the frontend settings UI.
 */

import type { ProviderMeta } from './llm-types.js';

export const PROVIDER_META: readonly ProviderMeta[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    requiresKey: true,
    defaultBaseURL: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-api03-...',
    keyPrefix: 'sk-ant-',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
      { id: 'claude-haiku-4-20250514', label: 'Claude Haiku 4' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    requiresKey: true,
    defaultBaseURL: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-...',
    keyPrefix: 'sk-',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'o3-mini', label: 'o3-mini' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    requiresKey: true,
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'sk-or-v1-...',
    keyPrefix: 'sk-or-',
    models: [
      { id: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'google/gemini-2.5-pro-preview', label: 'Gemini 2.5 Pro' },
      { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
      { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
    ],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    requiresKey: false,
    defaultBaseURL: 'http://localhost:1234/v1',
    keyPlaceholder: 'not required',
    models: [
      { id: 'local-model', label: 'Local Model (auto-detect)' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex (ChatGPT Plus)',
    requiresKey: false,
    defaultBaseURL: '',
    keyPlaceholder: 'not required — uses codex CLI auth',
    models: [
      { id: 'o4-mini', label: 'o4-mini (default)' },
      { id: 'o3', label: 'o3' },
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code (CLI)',
    requiresKey: false,
    defaultBaseURL: '',
    keyPlaceholder: 'not required — uses claude CLI auth',
    models: [
      { id: 'sonnet', label: 'Claude Sonnet (default)' },
      { id: 'sonnet[1m]', label: 'Claude Sonnet (1M context)' },
      { id: 'opus', label: 'Claude Opus' },
      { id: 'opus[1m]', label: 'Claude Opus (1M context)' },
      { id: 'haiku', label: 'Claude Haiku' },
    ],
  },
] as const;

export function getProviderMeta(id: string): ProviderMeta | undefined {
  return PROVIDER_META.find((p) => p.id === id);
}

export function getDefaultModel(id: string): string {
  const meta = getProviderMeta(id);
  return meta?.models[0]?.id ?? 'unknown';
}
