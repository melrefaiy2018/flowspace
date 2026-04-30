/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';
import type { ThreadBrief } from '../../../../../shared/gmail-enrichment-types.js';

expect.extend(toHaveNoViolations);

// Mock InlineReplyCompose so tests don't need its internal send logic
vi.mock('../../../InlineReplyCompose.js', () => ({
  default: vi.fn(({ draft, onSent, onDiscard }: { draft: string; onSent: () => void; onDiscard: () => void }) => (
    <div data-testid="inline-reply-compose">
      <span data-testid="draft-text">{draft}</span>
      <button onClick={onSent} data-testid="sent-btn">Send</button>
      <button onClick={onDiscard} data-testid="discard-btn">Discard</button>
    </div>
  )),
}));

// Mock api
const mockDraftReply = vi.fn();
vi.mock('../../../../../services/api.js', () => ({
  api: {
    draftReply: (...args: unknown[]) => mockDraftReply(...args),
  },
}));

import DraftPane from '../DraftPane.js';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'personal_reply_needed',
    title: 'Hey there',
    subtitle: 'Alice Lee',
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
    subject: 'Hey there',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Alice Lee <alice@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Please review this.',
        bodyType: 'text',
        attachments: [],
      },
    ],
    ...overrides,
  };
}

function makeBrief(): ThreadBrief {
  return {
    threadId: 'thread-1',
    summary: 'Alice wants a review.',
    recommendedAction: 'Draft reply',
    contextChips: [],
    firstClassActions: [{ kind: 'draft_reply' }],
    isFallback: false,
    cachedAt: '2026-04-01T10:00:00Z',
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  mockDraftReply.mockResolvedValue({
    draft: 'Hi Alice, thanks for reaching out.',
    subject: 'Hey there',
    to: 'alice@example.com',
    thread_id: 'thread-1',
    original_messages: [],
  });
});

describe('DraftPane', () => {
  it('fetches draft on mount when threadDetail and brief are present, renders InlineReplyCompose with draft', async () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();

    render(
      <DraftPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    await waitFor(() => {
      expect(mockDraftReply).toHaveBeenCalledWith('thread-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('inline-reply-compose')).toBeTruthy();
      expect(screen.getByTestId('draft-text').textContent).toBe('Hi Alice, thanks for reaching out.');
    });
  });

  it('shows regenerate button and refetches draft when clicked', async () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();

    render(
      <DraftPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    // Wait for initial fetch
    await waitFor(() => expect(mockDraftReply).toHaveBeenCalledTimes(1));

    const regenerateBtn = await screen.findByRole('button', { name: /regenerate/i });
    fireEvent.click(regenerateBtn);

    await waitFor(() => {
      expect(mockDraftReply).toHaveBeenCalledTimes(2);
    });
  });

  it('disables regenerate button and shows spinner while regenerating', async () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();

    // Make regenerate slow
    let resolveRegen: (v: unknown) => void = () => {};
    mockDraftReply
      .mockResolvedValueOnce({
        draft: 'First draft',
        subject: 'Hey there',
        to: 'alice@example.com',
        thread_id: 'thread-1',
        original_messages: [],
      })
      .mockImplementationOnce(
        () => new Promise((res) => { resolveRegen = res; })
      );

    render(
      <DraftPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    await waitFor(() => expect(mockDraftReply).toHaveBeenCalledTimes(1));

    const regenerateBtn = await screen.findByRole('button', { name: /regenerate/i });
    fireEvent.click(regenerateBtn);

    // While regenerating, button should be disabled
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /regenerate/i });
      expect(btn).toBeTruthy();
      // Button should be disabled or show spinner
      expect(btn.hasAttribute('disabled') || screen.queryByTestId('regenerate-spinner')).toBeTruthy();
    });

    // Resolve the pending promise
    resolveRegen({
      draft: 'New draft',
      subject: 'Hey there',
      to: 'alice@example.com',
      thread_id: 'thread-1',
      original_messages: [],
    });
  });

  it('shows loading skeleton when threadDetail is null', () => {
    const item = makeWorkItem();
    const brief = makeBrief();

    render(
      <DraftPane
        item={item}
        threadDetail={null}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.getByTestId('draft-pane-skeleton')).toBeTruthy();
    expect(mockDraftReply).not.toHaveBeenCalled();
  });

  it('calls onComplete with summary string when InlineReplyCompose fires onSent', async () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();
    const onComplete = vi.fn();

    render(
      <DraftPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
        onComplete={onComplete}
      />
    );

    await waitFor(() => expect(screen.getByTestId('inline-reply-compose')).toBeTruthy());

    fireEvent.click(screen.getByTestId('sent-btn'));

    expect(onComplete).toHaveBeenCalledWith(expect.stringContaining('Replied'));
  });

  it('DraftPane fires onComplete with "Replied to {recipient}" including the recipient', async () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();
    const onComplete = vi.fn();

    render(
      <DraftPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
        onComplete={onComplete}
      />
    );

    // Wait for the draft to load — api returns to: 'alice@example.com'
    await waitFor(() => expect(mockDraftReply).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('inline-reply-compose')).toBeTruthy());

    fireEvent.click(screen.getByTestId('sent-btn'));

    // The 'to' field from the mock response is 'alice@example.com'
    expect(onComplete).toHaveBeenCalledWith('Replied to alice@example.com');
  });

  it('has no accessibility violations in ready state', async () => {
    const item = makeWorkItem();
    const threadDetail = makeThreadDetail();
    const brief = makeBrief();

    const { container } = render(
      <DraftPane
        item={item}
        threadDetail={threadDetail}
        brief={brief}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    // Wait for fetch to settle
    await waitFor(() => expect(mockDraftReply).toHaveBeenCalled());

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
