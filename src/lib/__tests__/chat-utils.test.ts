import { describe, it, expect } from 'vitest';
import { createId, normalizeMessages, titleFromMessages, toChatInput, type Message } from '../chat-utils';

describe('createId', () => {
  it('includes the prefix', () => {
    expect(createId('user')).toMatch(/^user-/);
    expect(createId('conv')).toMatch(/^conv-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId('test')));
    expect(ids.size).toBe(100);
  });

  it('includes timestamp and random suffix', () => {
    const id = createId('msg');
    const parts = id.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(Number(parts[1])).toBeGreaterThan(0);
  });
});

describe('normalizeMessages', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeMessages(null)).toEqual([]);
    expect(normalizeMessages(undefined)).toEqual([]);
    expect(normalizeMessages('string')).toEqual([]);
    expect(normalizeMessages(42)).toEqual([]);
    expect(normalizeMessages({})).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(normalizeMessages([])).toEqual([]);
  });

  it('filters out invalid entries', () => {
    expect(normalizeMessages([null, undefined, 42, 'str', {}])).toEqual([]);
  });

  it('filters out entries with invalid roles', () => {
    expect(normalizeMessages([{ role: 'system', content: 'hello' }])).toEqual([]);
    expect(normalizeMessages([{ role: 'tool', content: 'data' }])).toEqual([]);
  });

  it('normalizes a valid user message', () => {
    const result = normalizeMessages([{ role: 'user', content: 'hello', id: 'u1' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'u1',
      role: 'user',
      content: 'hello',
      status: 'complete',
    });
    expect(result[0].blocks).toEqual([]);
    expect(result[0].toolEvents).toEqual([]);
  });

  it('normalizes a valid assistant message', () => {
    const result = normalizeMessages([{ role: 'assistant', content: 'hi there', id: 'a1' }]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('hi there');
  });

  it('defaults content to empty string if missing', () => {
    const result = normalizeMessages([{ role: 'user', id: 'u1' }]);
    expect(result[0].content).toBe('');
  });

  it('generates an ID if missing', () => {
    const result = normalizeMessages([{ role: 'user', content: 'hello' }]);
    expect(result[0].id).toMatch(/^user-/);
  });

  it('preserves streaming and error status', () => {
    const streaming = normalizeMessages([{ role: 'assistant', content: '', status: 'streaming', id: 'a1' }]);
    expect(streaming[0].status).toBe('streaming');

    const error = normalizeMessages([{ role: 'assistant', content: '', status: 'error', id: 'a2' }]);
    expect(error[0].status).toBe('error');
  });

  it('defaults non-streaming/error status to complete', () => {
    const result = normalizeMessages([{ role: 'user', content: 'hi', id: 'u1', status: 'whatever' }]);
    expect(result[0].status).toBe('complete');
  });

  it('preserves blocks and toolEvents arrays', () => {
    const blocks = [{ type: 'status', title: 'Done', body: 'Ok' }];
    const toolEvents = [{ id: 't1', toolName: 'search', label: 'Searching', status: 'completed' }];
    const result = normalizeMessages([{
      role: 'assistant', content: 'done', id: 'a1', blocks, toolEvents,
    }]);
    expect(result[0].blocks).toEqual(blocks);
    expect(result[0].toolEvents).toEqual(toolEvents);
  });

  it('defaults non-array blocks/toolEvents to empty arrays', () => {
    const result = normalizeMessages([{
      role: 'assistant', content: 'hi', id: 'a1', blocks: 'invalid', toolEvents: null,
    }]);
    expect(result[0].blocks).toEqual([]);
    expect(result[0].toolEvents).toEqual([]);
  });
});

describe('titleFromMessages', () => {
  it('returns "New conversation" for empty messages', () => {
    expect(titleFromMessages([])).toBe('New conversation');
  });

  it('returns "New conversation" for assistant-only messages', () => {
    const msgs: Message[] = [
      { id: 'a1', role: 'assistant', content: 'Hello!', status: 'complete' },
    ];
    expect(titleFromMessages(msgs)).toBe('New conversation');
  });

  it('uses first user message as title', () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: 'Search for quarterly report', status: 'complete' },
    ];
    expect(titleFromMessages(msgs)).toBe('Search for quarterly report');
  });

  it('truncates long messages at 50 chars with ellipsis', () => {
    const longContent = 'A'.repeat(60);
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: longContent, status: 'complete' },
    ];
    const title = titleFromMessages(msgs);
    expect(title).toBe('A'.repeat(50) + '...');
    expect(title.length).toBe(53);
  });

  it('does not add ellipsis for exactly 50-char messages', () => {
    const content = 'A'.repeat(50);
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content, status: 'complete' },
    ];
    expect(titleFromMessages(msgs)).toBe(content);
  });
});

describe('toChatInput', () => {
  it('returns empty array for empty input', () => {
    expect(toChatInput([])).toEqual([]);
  });

  it('filters out messages with empty/whitespace content', () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: '', status: 'complete' },
      { id: 'u2', role: 'user', content: '   ', status: 'complete' },
      { id: 'u3', role: 'user', content: 'hello', status: 'complete' },
    ];
    const result = toChatInput(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('maps messages to ChatMessageInput format (role + content only)', () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: 'find emails', status: 'complete', blocks: [], toolEvents: [] },
      { id: 'a1', role: 'assistant', content: 'Found 3 results', status: 'complete', blocks: [{ type: 'status' } as any] },
    ];
    const result = toChatInput(msgs);
    expect(result).toEqual([
      { role: 'user', content: 'find emails' },
      { role: 'assistant', content: 'Found 3 results' },
    ]);
  });
});
