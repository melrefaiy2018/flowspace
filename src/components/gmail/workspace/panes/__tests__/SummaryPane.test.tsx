/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';
import type { ThreadBrief } from '../../../../../shared/gmail-enrichment-types.js';

expect.extend(toHaveNoViolations);

import SummaryPane from '../SummaryPane.js';

function makeWorkItem(): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'newsletter',
    title: 'Weekly AI Digest',
    subtitle: 'newsletter@digest.com',
    primaryActionLabel: 'Summarize & file',
    paneKind: 'summary',
    enrichment: undefined,
    brief: undefined,
  };
}

function makeThreadDetail(): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Weekly AI Digest',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'newsletter@digest.com',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'This week in AI: GPT-5 announced, new robotics advances...',
        bodyType: 'text',
        attachments: [],
      },
    ],
  };
}

function makeBrief(): ThreadBrief {
  return {
    threadId: 'thread-1',
    summary: 'This week: GPT-5 announced with major improvements, new robotics breakthroughs at MIT.',
    recommendedAction: 'Archive after reading.',
    contextChips: [
      { label: 'Newsletter', kind: 'other' },
      { label: 'AI news', kind: 'other' },
    ],
    firstClassActions: [],
    isFallback: false,
    cachedAt: '2026-04-01T10:00:00Z',
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SummaryPane', () => {
  it('renders summary, recommended action, chips, and 3 secondary action buttons in ready state', () => {
    const item = makeWorkItem();
    render(
      <SummaryPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.getByText(/GPT-5 announced/i)).toBeTruthy();
    expect(screen.getByText(/Archive after reading/i)).toBeTruthy();
    expect(screen.getByText('Newsletter')).toBeTruthy();
    expect(screen.getByText('AI news')).toBeTruthy();

    // Three secondary action buttons
    expect(screen.getByRole('button', { name: /draft reply/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /extract tasks/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeTruthy();
  });

  it('renders skeleton shimmer when briefLoading is true', () => {
    const item = makeWorkItem();
    render(
      <SummaryPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={true}
        onAgentAction={noop}
      />
    );

    expect(screen.getByTestId('summary-pane-skeleton')).toBeTruthy();
  });

  it('renders fallback "Extract" button when brief is null and not loading', () => {
    const onAgentAction = vi.fn();
    const item = makeWorkItem();
    render(
      <SummaryPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={onAgentAction}
      />
    );

    const extractBtn = screen.getByRole('button', { name: /ask agent to summarize/i });
    fireEvent.click(extractBtn);
    expect(onAgentAction).toHaveBeenCalledWith('ask_agent', 'Summarize this thread');
  });

  it('Draft reply button fires onAgentAction("draft_follow_up")', () => {
    const onAgentAction = vi.fn();
    const item = makeWorkItem();
    render(
      <SummaryPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={onAgentAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /draft reply/i }));
    expect(onAgentAction).toHaveBeenCalledWith('draft_follow_up');
  });

  it('Extract tasks button fires onAgentAction("create_task")', () => {
    const onAgentAction = vi.fn();
    const item = makeWorkItem();
    render(
      <SummaryPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={onAgentAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /extract tasks/i }));
    expect(onAgentAction).toHaveBeenCalledWith('create_task');
  });

  it('Archive button fires onDirectAction("archive", threadId) when provided', () => {
    const onDirectAction = vi.fn();
    const item = makeWorkItem();
    render(
      <SummaryPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={onDirectAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onDirectAction).toHaveBeenCalledWith('archive', 'thread-1');
  });

  it('has no accessibility violations in ready state', async () => {
    const item = makeWorkItem();

    const { container } = render(
      <SummaryPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={noop}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
