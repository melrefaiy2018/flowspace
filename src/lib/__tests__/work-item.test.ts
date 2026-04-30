import { describe, it, expect } from 'vitest';
import { workItemFromGmailThread } from '../work-item.js';
import type { GmailThreadSummary } from '../../services/api.js';
import type { ThreadEnrichment } from '../../shared/gmail-enrichment-types.js';

function makeThread(overrides: Partial<GmailThreadSummary> = {}): GmailThreadSummary {
  return {
    id: 't1',
    subject: 'Project update',
    snippet: 'Some snippet',
    from: '"Alice Lee" <alice@example.com>',
    date: '2026-04-11T10:00:00Z',
    unread: true,
    messageCount: 2,
    hasAttachments: false,
    labelIds: ['INBOX'],
    ...overrides,
  };
}

function makeEnrichment(overrides: Partial<ThreadEnrichment> = {}): ThreadEnrichment {
  return {
    threadId: 't1',
    priority: 'high',
    recommendedAction: 'draft_reply',
    whyItMatters: 'Alice asked about the Tuesday 2pm slot.',
    effortMinutes: '5',
    bucket: 'needs_reply',
    ...overrides,
  };
}

describe('workItemFromGmailThread', () => {
  it('thread with known threadType enrichment → correct type, primaryActionLabel, paneKind', () => {
    const thread = makeThread();
    const enrichment = makeEnrichment({ threadType: 'meeting_request' });
    const item = workItemFromGmailThread(thread, enrichment);

    expect(item.type).toBe('meeting_request');
    expect(item.primaryActionLabel).toBe('Pick times');
    expect(item.paneKind).toBe('schedule');
  });

  it('thread with enrichment but threadType undefined → falls back to other', () => {
    const thread = makeThread();
    const enrichment = makeEnrichment({ threadType: undefined });
    const item = workItemFromGmailThread(thread, enrichment);

    expect(item.type).toBe('other');
    expect(item.primaryActionLabel).toBe('Discuss');
    expect(item.paneKind).toBe('discuss');
  });

  it('thread with no enrichment → falls back to other', () => {
    const thread = makeThread();
    const item = workItemFromGmailThread(thread, undefined);

    expect(item.type).toBe('other');
    expect(item.paneKind).toBe('discuss');
  });

  it('subtitle extracts display name from "Name <email>" format', () => {
    const thread = makeThread({ from: '"Alice Lee" <alice@example.com>' });
    const item = workItemFromGmailThread(thread, undefined);
    expect(item.subtitle).toBe('Alice Lee');
  });

  it('subtitle extracts display name without quotes', () => {
    const thread = makeThread({ from: 'Bob Smith <bob@example.com>' });
    const item = workItemFromGmailThread(thread, undefined);
    expect(item.subtitle).toBe('Bob Smith');
  });

  it('subtitle falls back to local part of email when no display name', () => {
    const thread = makeThread({ from: 'alice@example.com' });
    const item = workItemFromGmailThread(thread, undefined);
    expect(item.subtitle).toBe('alice');
  });

  it('title uses thread.subject', () => {
    const thread = makeThread({ subject: 'Meeting tomorrow at 2pm' });
    const item = workItemFromGmailThread(thread, undefined);
    expect(item.title).toBe('Meeting tomorrow at 2pm');
  });

  it('title uses (no subject) when subject is empty', () => {
    const thread = makeThread({ subject: '' });
    const item = workItemFromGmailThread(thread, undefined);
    expect(item.title).toBe('(no subject)');
  });

  it('whyItMatters is present when enrichment has it', () => {
    const thread = makeThread();
    const enrichment = makeEnrichment({ whyItMatters: 'Alice asked about the Tuesday 2pm slot.' });
    const item = workItemFromGmailThread(thread, enrichment);
    expect(item.whyItMatters).toBe('Alice asked about the Tuesday 2pm slot.');
  });

  it('whyItMatters is absent when enrichment is missing', () => {
    const thread = makeThread();
    const item = workItemFromGmailThread(thread, undefined);
    expect(item.whyItMatters).toBeUndefined();
  });

  it('id and source are set from thread', () => {
    const thread = makeThread({ id: 'thread-abc' });
    const item = workItemFromGmailThread(thread, undefined);
    expect(item.id).toBe('thread-abc');
    expect(item.source).toEqual({ kind: 'gmail', threadId: 'thread-abc' });
  });

  it('brief is always undefined (fetched separately)', () => {
    const thread = makeThread();
    const item = workItemFromGmailThread(thread, makeEnrichment());
    expect(item.brief).toBeUndefined();
  });
});
