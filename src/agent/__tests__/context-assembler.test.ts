import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/branding.js', () => ({ AGENT_NAME: 'TestAgent' }));
vi.mock('../../lib/persona.js', () => ({
  buildPersonaPrompt: () => 'persona-prompt',
  DEFAULT_PERSONA: { name: 'default' },
}));
vi.mock('../memory/memory-retriever.js', () => ({
  formatMemoriesForPrompt: (entries: unknown[]) => `memories: ${entries.length}`,
}));

import { assembleContext, estimateTokens, truncateMessages } from '../context-assembler.js';
import type { ChatMessageInput } from '../../shared/chat.js';

describe('assembleContext', () => {
  it('produces a string containing the agent name', () => {
    const result = assembleContext({ userTz: 'America/New_York' });
    expect(result).toContain('TestAgent');
  });

  it('includes the timezone in the output', () => {
    const result = assembleContext({ userTz: 'America/Chicago' });
    expect(result).toContain('America/Chicago');
  });

  it('includes thread brief when provided', () => {
    const result = assembleContext({ threadBrief: 'Meeting prep for design review' });
    expect(result).toContain('Meeting prep for design review');
  });

  it('includes memory context when memories provided', () => {
    const memories = [
      {
        id: 'mem-1',
        category: 'fact' as const,
        content: 'User prefers morning meetings',
        tags: ['preference'],
        metadata: {},
        source: { type: 'auto_extraction' as const, toolName: 'test' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        lastAccessedAt: '2024-01-01T00:00:00Z',
        accessCount: 0,
      },
    ];
    const result = assembleContext({ memories });
    expect(result).toContain('memories: 1');
  });

  it('returns a string even without options', () => {
    const result = assembleContext({});
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes conversation summary wrapped in markers when provided', () => {
    const summary = 'The user is planning a Q2 offsite. They decided on the downtown venue.';
    const result = assembleContext({ conversationSummary: summary });
    expect(result).toContain('--- Conversation summary (last updated:');
    expect(result).toContain(summary);
    expect(result).toContain('--- End of conversation summary ---');
  });

  it('does not include summary markers when conversationSummary is not provided', () => {
    const result = assembleContext({});
    expect(result).not.toContain('--- Conversation summary');
    expect(result).not.toContain('--- End of conversation summary ---');
  });
});

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('hello world')).toBe(Math.ceil(11 / 4));
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('handles longer text', () => {
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });
});

describe('truncateMessages', () => {
  const makeMessages = (): ChatMessageInput[] => [
    { role: 'user', content: 'first user message' },
    { role: 'assistant', content: 'first assistant reply with some content here' },
    { role: 'user', content: 'second user message' },
    { role: 'assistant', content: 'second assistant reply that is also quite long' },
    { role: 'user', content: 'third user message — the most recent' },
  ];

  it('returns all messages when within budget', () => {
    const messages = makeMessages();
    const result = truncateMessages(messages, 10_000);
    expect(result).toHaveLength(messages.length);
  });

  it('preserves first and last user message when truncating', () => {
    const messages = makeMessages();
    // Very small budget: forces truncation
    const result = truncateMessages(messages, 5);
    expect(result[0]).toEqual(messages[0]);
    const lastUser = [...result].reverse().find((m) => m.role === 'user');
    expect(lastUser?.content).toBe('third user message — the most recent');
  });

  it('does not mutate the input array', () => {
    const messages = makeMessages();
    const copy = [...messages];
    truncateMessages(messages, 5);
    expect(messages).toEqual(copy);
  });

  it('returns at least 2 messages (first + last user) for tiny budget', () => {
    const messages = makeMessages();
    const result = truncateMessages(messages, 1);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
