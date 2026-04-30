import { describe, it, expect } from 'vitest';
import {
  buildTriageSystemPrompt,
  buildTriageUserMessage,
  parseTriageResponse,
  parseAiTriageResponse,
  type AITriageResult,
} from '../ai-triage';
import type { GmailThreadSummary } from '../../services/api';

function makeThread(id: string, subject: string, from: string, unread = false): GmailThreadSummary {
  return {
    id,
    subject,
    from,
    date: '2026-03-26T10:00:00Z',
    snippet: `Snippet for ${subject}`,
    unread,
    labelIds: ['INBOX'],
    messageCount: 1,
    hasAttachments: false,
  };
}

const sampleThreads: GmailThreadSummary[] = [
  makeThread('t1', 'ML Engineer job alert', 'linkedin@example.com'),
  makeThread('t2', 'Chase payment scheduled', 'no-reply@chase.com'),
  makeThread('t3', 'Leander ISD digest', 'digest@parentSquare.com', true),
  makeThread('t4', 'GitHub permissions request', 'noreply@github.com', true),
  makeThread('t5', 'Spotify Premium Duo offer', 'no-reply@spotify.com'),
];

describe('buildTriageSystemPrompt', () => {
  it('returns a non-empty string with JSON instructions', () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('categories');
    expect(prompt).toContain('threadIds');
  });
});

describe('buildTriageUserMessage', () => {
  it('includes all thread subjects and IDs', () => {
    const message = buildTriageUserMessage(sampleThreads);
    expect(message).toContain('t1');
    expect(message).toContain('ML Engineer job alert');
    expect(message).toContain('t2');
    expect(message).toContain('Chase payment scheduled');
    expect(message).toContain('t5');
  });

  it('includes sender and unread status', () => {
    const message = buildTriageUserMessage(sampleThreads);
    expect(message).toContain('linkedin@example.com');
    expect(message).toContain('unread');
  });

  it('handles empty threads array', () => {
    const message = buildTriageUserMessage([]);
    expect(message).toContain('0 threads');
  });
});

describe('parseTriageResponse', () => {
  const validIds = new Set(['t1', 't2', 't3', 't4', 't5']);

  it('parses a well-formed JSON response', () => {
    const raw = JSON.stringify({
      categories: [
        { label: 'Job Alerts', threadIds: ['t1'] },
        { label: 'Finance', threadIds: ['t2'] },
        { label: 'School', threadIds: ['t3'] },
      ],
    });

    const result = parseTriageResponse(raw, validIds);
    expect(result.categories).toHaveLength(3);
    expect(result.categories[0]).toEqual({ label: 'Job Alerts', threadIds: ['t1'] });
    expect(result.categories[1]).toEqual({ label: 'Finance', threadIds: ['t2'] });
  });

  it('extracts JSON from markdown code block', () => {
    const raw = '```json\n{"categories": [{"label": "Test", "threadIds": ["t1"]}]}\n```';
    const result = parseTriageResponse(raw, validIds);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].label).toBe('Test');
  });

  it('extracts JSON embedded in surrounding text', () => {
    const raw = 'Here is my analysis:\n{"categories": [{"label": "Misc", "threadIds": ["t2", "t3"]}]}\nHope that helps!';
    const result = parseTriageResponse(raw, validIds);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].threadIds).toEqual(['t2', 't3']);
  });

  it('filters out invalid thread IDs', () => {
    const raw = JSON.stringify({
      categories: [{ label: 'Test', threadIds: ['t1', 'invalid-id', 't2'] }],
    });
    const result = parseTriageResponse(raw, validIds);
    expect(result.categories[0].threadIds).toEqual(['t1', 't2']);
  });

  it('removes categories with no valid threads after filtering', () => {
    const raw = JSON.stringify({
      categories: [
        { label: 'Valid', threadIds: ['t1'] },
        { label: 'Empty', threadIds: ['fake1', 'fake2'] },
      ],
    });
    const result = parseTriageResponse(raw, validIds);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].label).toBe('Valid');
  });

  it('throws on completely unparseable response', () => {
    expect(() => parseTriageResponse('not json at all', validIds)).toThrow();
  });

  it('throws on missing categories field', () => {
    expect(() => parseTriageResponse('{"foo": "bar"}', validIds)).toThrow();
  });
});

describe('parseAiTriageResponse — threadType handling', () => {
  const ids = new Set(['t1', 't2', 't3']);

  it('valid threadType in LLM response → enrichment has matching threadType', () => {
    const raw = JSON.stringify({
      enrichments: [
        {
          threadId: 't1',
          priority: 'high',
          recommendedAction: 'draft_reply',
          whyItMatters: 'Meeting request from Alice on Friday at 3pm.',
          effortMinutes: '5',
          bucket: 'needs_reply',
          threadType: 'meeting_request',
        },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    const e = result.enrichments.find((x) => x.threadId === 't1');
    expect(e).toBeDefined();
    expect(e?.threadType).toBe('meeting_request');
    expect(result.failed).not.toContain('t1');
  });

  it('unknown threadType in LLM response → enrichment has threadType undefined, NOT in failed[]', () => {
    const raw = JSON.stringify({
      enrichments: [
        {
          threadId: 't1',
          priority: 'medium',
          recommendedAction: 'draft_reply',
          whyItMatters: 'Alice is waiting for your answer on the proposal.',
          effortMinutes: '5',
          bucket: 'needs_reply',
          threadType: 'invalid_type',
        },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    const e = result.enrichments.find((x) => x.threadId === 't1');
    expect(e).toBeDefined();
    expect(e?.threadType).toBeUndefined();
    expect(result.failed).not.toContain('t1');
  });

  it('threadType omitted entirely → enrichment has threadType undefined, NOT in failed[]', () => {
    const raw = JSON.stringify({
      enrichments: [
        {
          threadId: 't1',
          priority: 'low',
          recommendedAction: 'archive',
          whyItMatters: 'Receipt from Stripe for $49 on Apr 8.',
          effortMinutes: '1',
          bucket: 'reference_fyi',
        },
      ],
    });
    const result = parseAiTriageResponse(raw, ids);
    const e = result.enrichments.find((x) => x.threadId === 't1');
    expect(e).toBeDefined();
    expect(e?.threadType).toBeUndefined();
    expect(result.failed).not.toContain('t1');
  });
});
