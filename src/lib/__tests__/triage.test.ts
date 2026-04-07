import { describe, it, expect } from 'vitest';
import { triageEmailsHeuristic } from '../triage';
import type { GmailMessage } from '../../services/api';
import { createPreferenceExample } from '../importance-feedback';

function makeEmail(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    snippet: 'Hello',
    from: 'Jane Doe <jane@example.com>',
    subject: 'Project update',
    date: '2026-03-08',
    labelIds: ['INBOX'],
    unread: true,
    ...overrides,
  };
}

describe('triageEmailsHeuristic', () => {
  it('returns empty buckets for empty input', () => {
    const result = triageEmailsHeuristic([]);
    expect(result.needs_reply).toEqual([]);
    expect(result.needs_input).toEqual([]);
    expect(result.fyi_only).toEqual([]);
    expect(result.can_ignore).toEqual([]);
  });

  it('puts unread human emails in needs_reply', () => {
    const result = triageEmailsHeuristic([makeEmail()]);
    expect(result.needs_reply).toHaveLength(1);
    expect(result.needs_reply[0].subject).toBe('Project update');
    expect(result.needs_reply[0].sender).toBe('Jane Doe <jane@example.com>');
    expect(result.needs_reply[0].thread_id).toBe('thread-1');
  });

  it('adds draft_reply action to needs_reply items', () => {
    const result = triageEmailsHeuristic([makeEmail()]);
    expect(result.needs_reply[0].actions).toHaveLength(1);
    expect(result.needs_reply[0].actions![0].type).toBe('draft_reply');
    expect(result.needs_reply[0].actions![0].context.thread_id).toBe('thread-1');
  });

  it('puts read human emails in fyi_only', () => {
    const result = triageEmailsHeuristic([makeEmail({ unread: false })]);
    expect(result.fyi_only).toHaveLength(1);
    expect(result.needs_reply).toHaveLength(0);
  });

  it('puts noreply senders in can_ignore', () => {
    const patterns = [
      'noreply@company.com',
      'no-reply@service.io',
      'notifications@github.com',
      'mailer-daemon@google.com',
      'donotreply@bank.com',
      'newsletter@blog.com',
    ];
    for (const from of patterns) {
      const result = triageEmailsHeuristic([makeEmail({ from })]);
      expect(result.can_ignore).toHaveLength(1);
      expect(result.needs_reply).toHaveLength(0);
    }
  });

  it('does not add actions to can_ignore emails', () => {
    const result = triageEmailsHeuristic([makeEmail({ from: 'noreply@test.com' })]);
    expect(result.can_ignore[0].actions).toEqual([]);
  });

  it('puts CATEGORY_PROMOTIONS emails in can_ignore', () => {
    const result = triageEmailsHeuristic([
      makeEmail({ labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }),
    ]);
    expect(result.can_ignore).toHaveLength(1);
    expect(result.needs_reply).toHaveLength(0);
  });

  it('puts CATEGORY_UPDATES emails in can_ignore', () => {
    const result = triageEmailsHeuristic([
      makeEmail({ labelIds: ['INBOX', 'CATEGORY_UPDATES'] }),
    ]);
    expect(result.can_ignore).toHaveLength(1);
  });

  it('does not leak draft_reply actions into can_ignore for promotional/update emails', () => {
    // Regression: unread emails from real senders in CATEGORY_PROMOTIONS/UPDATES
    // were getting draft_reply actions assigned before bucket selection
    const promoEmail = makeEmail({
      from: 'deals@store.com',
      unread: true,
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
    });
    const updateEmail = makeEmail({
      id: 'msg-2',
      threadId: 'thread-2',
      from: 'updates@service.com',
      unread: true,
      labelIds: ['INBOX', 'CATEGORY_UPDATES'],
    });
    const result = triageEmailsHeuristic([promoEmail, updateEmail]);
    expect(result.can_ignore).toHaveLength(2);
    expect(result.needs_reply).toHaveLength(0);
    for (const item of result.can_ignore) {
      expect(item.actions).toEqual([]);
    }
  });

  it('caps needs_reply at 5 items', () => {
    const emails = Array.from({ length: 10 }, (_, i) =>
      makeEmail({ id: `msg-${i}`, threadId: `thread-${i}`, subject: `Email ${i}` })
    );
    const result = triageEmailsHeuristic(emails);
    expect(result.needs_reply).toHaveLength(5);
  });

  it('always returns empty needs_input array', () => {
    const result = triageEmailsHeuristic([makeEmail()]);
    expect(result.needs_input).toEqual([]);
  });

  it('correctly triages a mixed inbox', () => {
    const emails = [
      makeEmail({ id: '1', threadId: 't1', from: 'alice@work.com', unread: true }),
      makeEmail({ id: '2', threadId: 't2', from: 'noreply@github.com', unread: true }),
      makeEmail({ id: '3', threadId: 't3', from: 'bob@work.com', unread: false }),
      makeEmail({ id: '4', threadId: 't4', from: 'promo@shop.com', labelIds: ['CATEGORY_PROMOTIONS'], unread: true }),
    ];
    const result = triageEmailsHeuristic(emails);
    expect(result.needs_reply).toHaveLength(1);
    expect(result.needs_reply[0].sender).toBe('alice@work.com');
    expect(result.fyi_only).toHaveLength(1);
    expect(result.fyi_only[0].sender).toBe('bob@work.com');
    expect(result.can_ignore).toHaveLength(2);
  });

  it('downgrades learned negative matches without suppressing the whole sender', () => {
    const preference = createPreferenceExample({
      scope: 'triage_item',
      item_type: 'email',
      sender: 'Alice <alice@example.com>',
      subject: 'Project update',
      entity_id: 'thread-1',
      bucket: 'needs_reply',
    }, 'not_important');

    const result = triageEmailsHeuristic([
      makeEmail({ from: 'Alice <alice@example.com>', subject: 'Project update' }),
      makeEmail({ id: 'msg-2', threadId: 'thread-2', from: 'Bob <bob@example.com>', subject: 'Team note' }),
    ], preference ? [preference] : []);

    expect(result.needs_reply).toHaveLength(1);
    expect(result.needs_reply[0].sender).toContain('bob@example.com');
    expect(result.fyi_only.length + result.can_ignore.length).toBe(1);
  });
});
