import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs, getDataDir, and createLLMClient before importing ─────────────────

const { mockFs, mockComplete } = vi.hoisted(() => {
  const mockFs = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  };
  const mockComplete = vi.fn();
  return { mockFs, mockComplete };
});

vi.mock('fs', () => ({ default: mockFs, ...mockFs }));

vi.mock('../../lib/data-dir.js', () => ({
  getDataDir: vi.fn(() => '/fake/data'),
}));

vi.mock('../llm-client.js', () => ({
  createLLMClient: vi.fn(() => ({
    complete: mockComplete,
    model: 'test-model',
    provider: 'openai',
  })),
}));

// ── Import module under test ──────────────────────────────────────────────────

import {
  loadSummaryStore,
  saveSummaryStore,
  getSummary,
  saveSummary,
  shouldGenerateSummary,
  generateSummary,
  formatMessagesForSummary,
  SUMMARY_TOKEN_THRESHOLD,
  SUMMARY_UPDATE_INTERVAL,
} from '../conversation-summary.js';
import type { ConversationSummary, ConversationSummaryStore } from '../conversation-summary.js';
import type { ChatMessage } from '../llm-types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const USER_HASH = 'abc123def456';
const FILE_PATH = `/fake/data/.conversation-summaries.${USER_HASH}.json`;
const TMP_PATH = FILE_PATH + '.tmp';

function resetMocks() {
  mockFs.existsSync.mockReset();
  mockFs.readFileSync.mockReset();
  mockFs.writeFileSync.mockReset();
  mockFs.renameSync.mockReset();
  mockComplete.mockReset();
}

function makeSummary(partial: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversationId: 'conv-123',
    version: 1,
    updatedAt: Date.now(),
    messageCountAtLastSummary: 20,
    summaryText: 'The user is planning a team offsite.',
    ...partial,
  };
}

function makeStore(summaries: Record<string, ConversationSummary> = {}): ConversationSummaryStore {
  return { version: 1, summaries };
}

// ── shouldGenerateSummary ─────────────────────────────────────────────────────

describe('shouldGenerateSummary', () => {
  it('returns false when tokens are below threshold', () => {
    expect(shouldGenerateSummary(SUMMARY_TOKEN_THRESHOLD - 1, undefined, 100)).toBe(false);
  });

  it('returns false when tokens equal threshold', () => {
    expect(shouldGenerateSummary(SUMMARY_TOKEN_THRESHOLD, undefined, 100)).toBe(false);
  });

  it('returns true when tokens exceed threshold and no existing summary', () => {
    expect(shouldGenerateSummary(SUMMARY_TOKEN_THRESHOLD + 1, undefined, 100)).toBe(true);
  });

  it('returns false when tokens exceed threshold but summary was updated recently (< 10 messages ago)', () => {
    const existing = makeSummary({ messageCountAtLastSummary: 95 });
    // currentMessageCount - 95 = 4 < SUMMARY_UPDATE_INTERVAL (10)
    expect(shouldGenerateSummary(SUMMARY_TOKEN_THRESHOLD + 1, existing, 99)).toBe(false);
  });

  it('returns false when tokens exceed threshold and exactly SUMMARY_UPDATE_INTERVAL - 1 messages since last summary', () => {
    const existing = makeSummary({ messageCountAtLastSummary: 91 });
    // 100 - 91 = 9 < 10
    expect(shouldGenerateSummary(SUMMARY_TOKEN_THRESHOLD + 1, existing, 100)).toBe(false);
  });

  it('returns true when tokens exceed threshold and exactly SUMMARY_UPDATE_INTERVAL messages since last summary', () => {
    const existing = makeSummary({ messageCountAtLastSummary: 90 });
    // 100 - 90 = 10 >= 10
    expect(shouldGenerateSummary(SUMMARY_TOKEN_THRESHOLD + 1, existing, 100)).toBe(true);
  });

  it('returns true when tokens exceed threshold and more than SUMMARY_UPDATE_INTERVAL messages since last summary', () => {
    const existing = makeSummary({ messageCountAtLastSummary: 50 });
    expect(shouldGenerateSummary(SUMMARY_TOKEN_THRESHOLD + 1, existing, 100)).toBe(true);
  });
});

// ── loadSummaryStore ──────────────────────────────────────────────────────────

describe('loadSummaryStore', () => {
  beforeEach(resetMocks);

  it('returns empty store when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = loadSummaryStore(USER_HASH);
    expect(result).toEqual({ version: 1, summaries: {} });
  });

  it('returns empty store on JSON parse error', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('not-valid-json');
    const result = loadSummaryStore(USER_HASH);
    expect(result).toEqual({ version: 1, summaries: {} });
  });

  it('returns empty store on version mismatch', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ version: 2, summaries: {} }));
    const result = loadSummaryStore(USER_HASH);
    expect(result).toEqual({ version: 1, summaries: {} });
  });

  it('returns parsed store when file is valid', () => {
    const store = makeStore({ 'conv-123': makeSummary() });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(store));
    const result = loadSummaryStore(USER_HASH);
    expect(result).toEqual(store);
  });

  it('reads from the correct file path', () => {
    mockFs.existsSync.mockReturnValue(false);
    loadSummaryStore(USER_HASH);
    expect(mockFs.existsSync).toHaveBeenCalledWith(FILE_PATH);
  });
});

// ── saveSummaryStore ──────────────────────────────────────────────────────────

describe('saveSummaryStore', () => {
  beforeEach(resetMocks);

  it('writes pretty-printed JSON to a tmp file then renames', () => {
    const store = makeStore();
    saveSummaryStore(USER_HASH, store);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      TMP_PATH,
      JSON.stringify(store, null, 2),
      'utf-8',
    );
    expect(mockFs.renameSync).toHaveBeenCalledWith(TMP_PATH, FILE_PATH);
  });
});

// ── getSummary ────────────────────────────────────────────────────────────────

describe('getSummary', () => {
  beforeEach(resetMocks);

  it('returns undefined for unknown conversation', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = getSummary(USER_HASH, 'unknown-conv');
    expect(result).toBeUndefined();
  });

  it('returns summary for known conversation', () => {
    const summary = makeSummary({ conversationId: 'conv-abc' });
    const store = makeStore({ 'conv-abc': summary });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(store));
    const result = getSummary(USER_HASH, 'conv-abc');
    expect(result).toEqual(summary);
  });
});

// ── saveSummary ───────────────────────────────────────────────────────────────

describe('saveSummary', () => {
  beforeEach(resetMocks);

  it('persists summary and can be reloaded', () => {
    // Start with empty store
    mockFs.existsSync.mockReturnValueOnce(false);

    const summary = makeSummary({ conversationId: 'conv-new' });
    saveSummary(USER_HASH, summary);

    // Verify write was called
    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written) as ConversationSummaryStore;
    expect(parsed.summaries['conv-new']).toEqual(summary);
  });

  it('upserts without removing existing entries', () => {
    const existingSummary = makeSummary({ conversationId: 'conv-old' });
    const store = makeStore({ 'conv-old': existingSummary });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(store));

    const newSummary = makeSummary({ conversationId: 'conv-new', summaryText: 'New summary.' });
    saveSummary(USER_HASH, newSummary);

    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written) as ConversationSummaryStore;
    expect(parsed.summaries['conv-old']).toEqual(existingSummary);
    expect(parsed.summaries['conv-new']).toEqual(newSummary);
  });
});

// ── formatMessagesForSummary ──────────────────────────────────────────────────

describe('formatMessagesForSummary', () => {
  it('formats user and assistant messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toBe('User: Hello\nAssistant: Hi there');
  });

  it('skips system messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are an assistant.' },
      { role: 'user', content: 'Hello' },
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toBe('User: Hello');
  });

  it('skips tool messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'tool', tool_call_id: 'call-1', content: '{"result": "data"}' },
      { role: 'assistant', content: 'Done.' },
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toBe('User: Hello\nAssistant: Done.');
  });

  it('truncates individual messages at 500 characters', () => {
    const longContent = 'x'.repeat(600);
    const messages: ChatMessage[] = [
      { role: 'user', content: longContent },
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toBe(`User: ${'x'.repeat(500)}...`);
  });

  it('does not truncate messages at exactly 500 characters', () => {
    const exactContent = 'x'.repeat(500);
    const messages: ChatMessage[] = [
      { role: 'user', content: exactContent },
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toBe(`User: ${exactContent}`);
    expect(result).not.toContain('...');
  });

  it('returns empty string for empty message list', () => {
    expect(formatMessagesForSummary([])).toBe('');
  });
});

// ── generateSummary ───────────────────────────────────────────────────────────

describe('generateSummary', () => {
  beforeEach(resetMocks);

  const userMessages: ChatMessage[] = [
    { role: 'user', content: 'I need to plan the Q2 offsite.' },
    { role: 'assistant', content: 'I can help with that. What venue are you considering?' },
    { role: 'user', content: "We're thinking downtown or the park." },
    { role: 'assistant', content: 'Both are great options. Let me check availability.' },
  ];

  it('calls LLM with full message history when no existing summary', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: 'The user is planning a Q2 offsite.' }, finish_reason: 'stop' }],
    });

    const result = await generateSummary(userMessages, undefined, 'conv-123');

    expect(mockComplete).toHaveBeenCalledOnce();
    const [calledMessages] = mockComplete.mock.calls[0] as [ChatMessage[]];
    expect(calledMessages[0].role).toBe('user');
    expect(calledMessages[0].content).toContain('Summarize this conversation');
    expect(calledMessages[0].content).toContain('Q2 offsite');
    expect(result).not.toBeNull();
    expect(result?.summaryText).toBe('The user is planning a Q2 offsite.');
    expect(result?.version).toBe(1);
    expect(result?.conversationId).toBe('conv-123');
  });

  it('calls LLM with previous summary and only new messages for incremental update', async () => {
    const existingSummary = makeSummary({
      summaryText: 'The user is planning a Q2 offsite.',
      messageCountAtLastSummary: 2,
    });

    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: 'Updated: The user decided on the downtown venue.' }, finish_reason: 'stop' }],
    });

    const result = await generateSummary(userMessages, existingSummary, 'conv-123');

    expect(mockComplete).toHaveBeenCalledOnce();
    const [calledMessages] = mockComplete.mock.calls[0] as [ChatMessage[]];
    expect(calledMessages[0].content).toContain('Here is the current summary');
    expect(calledMessages[0].content).toContain('The user is planning a Q2 offsite.');
    // Should include only new messages (after index 2)
    expect(calledMessages[0].content).toContain('downtown or the park');
    // Should NOT include messages already covered by the summary
    expect(calledMessages[0].content).not.toContain('What venue are you considering');
    expect(result?.version).toBe(2);
  });

  it('returns null on LLM failure', async () => {
    mockComplete.mockRejectedValueOnce(new Error('LLM unavailable'));

    const result = await generateSummary(userMessages, undefined, 'conv-123');

    expect(result).toBeNull();
  });

  it('returns null when LLM returns empty response', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
    });

    const result = await generateSummary(userMessages, undefined, 'conv-123');

    expect(result).toBeNull();
  });

  it('returns null when LLM returns whitespace-only response', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: '   ' }, finish_reason: 'stop' }],
    });

    const result = await generateSummary(userMessages, undefined, 'conv-123');

    expect(result).toBeNull();
  });

  it('caps summaryText at 2000 characters', async () => {
    const longSummary = 'x'.repeat(3000);
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: longSummary }, finish_reason: 'stop' }],
    });

    const result = await generateSummary(userMessages, undefined, 'conv-123');

    expect(result).not.toBeNull();
    expect(result!.summaryText.length).toBe(2000);
  });

  it('does not cap summaryText at or below 2000 characters', async () => {
    const shortSummary = 'The user is planning an offsite.';
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: shortSummary }, finish_reason: 'stop' }],
    });

    const result = await generateSummary(userMessages, undefined, 'conv-123');

    expect(result?.summaryText).toBe(shortSummary);
  });

  it('sets messageCountAtLastSummary to messages.length', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: 'Summary.' }, finish_reason: 'stop' }],
    });

    const result = await generateSummary(userMessages, undefined, 'conv-123');

    expect(result?.messageCountAtLastSummary).toBe(userMessages.length);
  });
});
