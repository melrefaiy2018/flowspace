/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import ReviewPane from '../ReviewPane.js';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';
import type { ThreadBrief } from '../../../../../shared/gmail-enrichment-types.js';

expect.extend(toHaveNoViolations);

function makeWorkItem(): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'security_alert',
    title: 'Unusual sign-in detected',
    subtitle: 'Google',
    primaryActionLabel: 'Review activity',
    paneKind: 'review',
    enrichment: undefined,
    brief: undefined,
  };
}

function makeThreadDetail(): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Unusual sign-in detected',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Google <noreply@accounts.google.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Someone signed in to your account.',
        bodyType: 'text',
        attachments: [],
      },
    ],
  };
}

function makeBrief(): ThreadBrief {
  return {
    threadId: 'thread-1',
    summary: 'A sign-in from a new device was detected on your account.',
    recommendedAction: 'Review and verify this sign-in activity.',
    contextChips: [
      { label: 'Security alert', kind: 'other' },
      { label: 'Google account', kind: 'other' },
      { label: 'New device', kind: 'other' },
    ],
    firstClassActions: [{ kind: 'draft_reply' }],
    isFallback: false,
    cachedAt: '2026-04-01T10:00:00Z',
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReviewPane', () => {
  it('renders summary, recommended action, and context chips when brief is ready', () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();

    render(
      <ReviewPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.getByText(/A sign-in from a new device/i)).toBeTruthy();
    expect(screen.getByText(/Review and verify this sign-in activity/i)).toBeTruthy();
    expect(screen.getByText('Security alert')).toBeTruthy();
    expect(screen.getByText('Google account')).toBeTruthy();
    expect(screen.getByText('New device')).toBeTruthy();
  });

  it('renders skeleton shimmer when briefLoading is true', () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();

    render(
      <ReviewPane
        item={item}
        threadDetail={threadDetail}
        brief={null}
        briefLoading={true}
        onAgentAction={noop}
      />
    );

    expect(screen.getByTestId('review-pane-skeleton')).toBeTruthy();
  });

  it('renders fallback message when brief is null and not loading', () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();

    render(
      <ReviewPane
        item={item}
        threadDetail={threadDetail}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.getByText(/No detailed analysis yet/i)).toBeTruthy();
    // Ask follow-up form still shown
    expect(screen.getByPlaceholderText(/Ask a follow-up question/i)).toBeTruthy();
  });

  it('ask-follow-up submit calls onAgentAction with question and clears input', () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();
    const onAgentAction = vi.fn();

    render(
      <ReviewPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={onAgentAction}
      />
    );

    const input = screen.getByPlaceholderText(/Ask a follow-up question/i);
    fireEvent.change(input, { target: { value: 'Is this sign-in from me?' } });
    fireEvent.submit(input.closest('form')!);

    expect(onAgentAction).toHaveBeenCalledWith('ask_agent', 'Is this sign-in from me?');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('has no accessibility violations with valid brief', async () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();

    const { container } = render(
      <ReviewPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
