import { describe, it, expect } from 'vitest';
import { buildListEnrichmentPrompt, buildThreadBriefPrompt, RECOMMENDED_ACTIONS } from '../gmail-enrichment.js';
import type { GmailThreadSummary, GmailThreadDetail } from '../../../services/api.js';

const makeThread = (overrides: Partial<GmailThreadSummary> = {}): GmailThreadSummary => ({
  id: 'thread1',
  subject: 'Test subject',
  snippet: 'Test snippet',
  from: 'alice@example.com',
  date: '2026-04-11T10:00:00Z',
  unread: true,
  messageCount: 2,
  hasAttachments: false,
  labelIds: ['INBOX'],
  ...overrides,
});

const makeThreadDetail = (overrides: Partial<GmailThreadDetail> = {}): GmailThreadDetail => ({
  id: 'thread1',
  subject: 'Meeting next week',
  messages: [
    { id: 'msg1', from: 'bob@example.com', to: 'me@example.com', cc: '', date: '2026-04-10T10:00:00Z', body: 'Can we meet Tuesday at 2pm?', bodyType: 'text', attachments: [] },
    { id: 'msg2', from: 'me@example.com', to: 'bob@example.com', cc: '', date: '2026-04-10T12:00:00Z', body: 'Sure, let me check my calendar.', bodyType: 'text', attachments: [] },
  ],
  labelIds: ['INBOX'],
  ...overrides,
});

describe('buildListEnrichmentPrompt', () => {
  it('returns { system, user } strings', () => {
    const result = buildListEnrichmentPrompt([makeThread()]);
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
  });

  it('system prompt contains "specific" and the list of allowed RecommendedAction values', () => {
    const { system } = buildListEnrichmentPrompt([makeThread()]);
    expect(system).toContain('specific');
    for (const action of RECOMMENDED_ACTIONS) {
      expect(system).toContain(action);
    }
  });

  it('user prompt contains each thread subject, sender, snippet, date, and label ids but NOT body text', () => {
    const thread = makeThread({
      id: 'abc123',
      subject: 'Re: Offer',
      from: 'alice@amd.com',
      snippet: 'Checking in on your decision',
      date: '2026-04-11T16:00:00Z',
      labelIds: ['INBOX', 'IMPORTANT'],
    });
    const { user } = buildListEnrichmentPrompt([thread]);
    expect(user).toContain('abc123');
    expect(user).toContain('Re: Offer');
    expect(user).toContain('alice@amd.com');
    expect(user).toContain('Checking in on your decision');
    expect(user).toContain('2026-04-11T16:00:00Z');
    expect(user).toContain('INBOX');
    expect(user).toContain('IMPORTANT');
  });

  it('handles empty threads array', () => {
    const { user } = buildListEnrichmentPrompt([]);
    expect(user).toContain('0 threads');
  });
});

describe('buildThreadBriefPrompt', () => {
  it('returns { system, user } strings', () => {
    const result = buildThreadBriefPrompt(makeThreadDetail());
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
  });

  it('user message concatenates message senders + dates + bodies', () => {
    const detail = makeThreadDetail();
    const { user } = buildThreadBriefPrompt(detail);
    expect(user).toContain('bob@example.com');
    expect(user).toContain('2026-04-10T10:00:00Z');
    expect(user).toContain('Can we meet Tuesday at 2pm?');
    expect(user).toContain('Sure, let me check my calendar.');
  });

  it('caps bodies at 2000 chars per message', () => {
    const longBody = 'x'.repeat(3000);
    const detail = makeThreadDetail({
      messages: [{ id: 'msg1', from: 'a@b.com', to: 'c@d.com', cc: '', date: '2026-04-11T10:00:00Z', body: longBody, bodyType: 'text', attachments: [] }],
    });
    const { user } = buildThreadBriefPrompt(detail);
    const bodyInOutput = user.slice(user.indexOf(longBody.slice(0, 100)));
    expect(bodyInOutput.length).toBeLessThan(longBody.length);
  });

  it('caps at 5 messages total', () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      id: `msg${i}`, from: `sender${i}@test.com`, to: 'me@test.com', cc: '',
      date: `2026-04-${10 + i}T10:00:00Z`, body: `Body ${i}`, bodyType: 'text' as const, attachments: [],
    }));
    const detail = makeThreadDetail({ messages });
    const { user } = buildThreadBriefPrompt(detail);
    expect(user).toContain('Body 4');
    expect(user).not.toContain('Body 5');
  });
});
