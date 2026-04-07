import { describe, expect, it } from 'vitest';
import { buildGmailAgentPrompt } from '../gmail-agent';
import type { GmailThreadDetail } from '../../services/api';

function makeThread(overrides: Partial<GmailThreadDetail> = {}): GmailThreadDetail {
  return {
    id: 'thread-123',
    subject: 'Interview scheduling',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Recruiter <recruiter@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-03-12T14:00:00Z',
        body: 'Can you share your availability for a 30 minute interview next week?',
        bodyType: 'text',
        attachments: [],
      },
      {
        id: 'msg-2',
        from: 'Recruiter <recruiter@example.com>',
        to: 'me@example.com',
        cc: 'coordinator@example.com',
        date: '2026-03-12T16:30:00Z',
        body: '<p>Please confirm whether <strong>Tuesday at 2 PM CT</strong> works.</p>',
        bodyType: 'html',
        attachments: [],
      },
    ],
    ...overrides,
  };
}

describe('buildGmailAgentPrompt', () => {
  it('includes thread id, subject, participants, and latest content for ask_agent', () => {
    const prompt = buildGmailAgentPrompt(makeThread(), 'ask_agent', 'What should I reply?');

    expect(prompt).toContain('Gmail thread "thread-123"');
    expect(prompt).toContain('Interview scheduling');
    expect(prompt).toContain('From: Recruiter <recruiter@example.com>');
    expect(prompt).toContain('To: me@example.com');
    expect(prompt).toContain('Cc: coordinator@example.com');
    expect(prompt).toContain('Tuesday at 2 PM CT works');
    expect(prompt).toContain('User request: What should I reply?');
  });

  it('uses calendar-specific instructions for add_to_calendar', () => {
    const prompt = buildGmailAgentPrompt(makeThread(), 'add_to_calendar');

    expect(prompt).toContain('prepare a calendar event draft');
    expect(prompt).toContain('ask a focused follow-up question');
    expect(prompt).toContain('thread-123');
  });

  it('includes the thread id in follow-up and task prompts', () => {
    const followUpPrompt = buildGmailAgentPrompt(makeThread(), 'draft_follow_up');
    const taskPrompt = buildGmailAgentPrompt(makeThread(), 'create_task');

    expect(followUpPrompt).toContain('thread "thread-123"');
    expect(followUpPrompt).toContain('draft an appropriate follow-up reply');
    expect(taskPrompt).toContain('thread "thread-123"');
    expect(taskPrompt).toContain('prepare a task');
  });
});
