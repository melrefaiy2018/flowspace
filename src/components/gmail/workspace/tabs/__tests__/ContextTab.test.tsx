/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import ContextTab from '../ContextTab.js';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';

expect.extend(toHaveNoViolations);

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'personal_reply_needed',
    title: 'Q2 budget review',
    subtitle: 'Bob Smith',
    primaryActionLabel: 'Draft reply',
    paneKind: 'draft',
    enrichment: undefined,
    brief: undefined,
    ...overrides,
  };
}

function makeThreadDetail(overrides: Partial<GmailThreadDetail> = {}): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Q2 budget review',
    labelIds: ['INBOX', 'IMPORTANT'],
    messages: [
      {
        id: 'msg-1',
        from: 'Bob Smith <bob@example.com>',
        to: 'me@example.com',
        cc: 'carol@example.com',
        date: '2026-04-01T10:00:00Z',
        body: 'Attached the budget.',
        bodyType: 'text',
        attachments: [{ filename: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 50000, attachmentId: 'att-1' }],
      },
    ],
    ...overrides,
  };
}

describe('ContextTab', () => {
  it('renders summary when enrichment has whyItMatters', () => {
    const item = makeWorkItem({
      enrichment: {
        threadId: 'thread-1',
        priority: 'high',
        recommendedAction: 'draft_reply',
        whyItMatters: 'Alice is blocked on your approval.',
        effortMinutes: '5',
        bucket: 'needs_reply',
      },
    });
    render(<ContextTab item={item} threadDetail={makeThreadDetail()} />);
    expect(screen.getByText('Alice is blocked on your approval.')).toBeTruthy();
  });

  it('renders fallback message when enrichment is absent', () => {
    const item = makeWorkItem({ enrichment: undefined });
    render(<ContextTab item={item} threadDetail={makeThreadDetail()} />);
    expect(screen.getByText(/No summary yet/i)).toBeTruthy();
  });

  it('shows participant count from thread messages', () => {
    const detail = makeThreadDetail();
    render(<ContextTab item={makeWorkItem()} threadDetail={detail} />);
    // 1 message, participants derived from from/to/cc fields
    expect(screen.getByText(/1 message/i)).toBeTruthy();
  });

  it('hides attachments card when no attachments present', () => {
    const detail = makeThreadDetail({
      messages: [
        {
          id: 'msg-1',
          from: 'Bob <bob@example.com>',
          to: 'me@example.com',
          cc: '',
          date: '2026-04-01T10:00:00Z',
          body: 'No attachments here.',
          bodyType: 'text',
          attachments: [],
        },
      ],
    });
    render(<ContextTab item={makeWorkItem()} threadDetail={detail} />);
    expect(screen.queryByText(/Attachments/i)).toBeNull();
  });

  it('shows attachment filenames when present', () => {
    render(<ContextTab item={makeWorkItem()} threadDetail={makeThreadDetail()} />);
    expect(screen.getByText('budget.xlsx')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ContextTab item={makeWorkItem()} threadDetail={makeThreadDetail()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
