/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import DiscussPane from '../DiscussPane.js';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';

expect.extend(toHaveNoViolations);

const setInputMock = vi.fn();
vi.mock('../../../../../context/ChatContext', () => ({
  useChatContext: () => ({
    setInput: setInputMock,
  }),
}));

function makeWorkItem(): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'other',
    title: 'Some thread',
    subtitle: 'Someone',
    primaryActionLabel: 'Discuss',
    paneKind: 'discuss',
    enrichment: undefined,
    brief: undefined,
  };
}

function makeThreadDetail(): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Some thread',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Someone <someone@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Hello there.',
        bodyType: 'text',
        attachments: [],
      },
    ],
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DiscussPane', () => {
  it('renders the main card and Open chat button', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();

    render(
      <DiscussPane
        item={item}
        threadDetail={detail}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.getByText(/Talk to the agent about this email/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /open chat/i })).toBeTruthy();
  });

  it('calls onSwitchTab("chat") when Open chat is clicked', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    const onSwitchTab = vi.fn();

    render(
      <DiscussPane
        item={item}
        threadDetail={detail}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
        onSwitchTab={onSwitchTab}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /open chat/i }));
    expect(onSwitchTab).toHaveBeenCalledWith('chat');
    expect(setInputMock).not.toHaveBeenCalled();
  });

  it('quick-prompt buttons set input and switch to Chat tab', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    const onSwitchTab = vi.fn();

    render(
      <DiscussPane
        item={item}
        threadDetail={detail}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
        onSwitchTab={onSwitchTab}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Summarize this thread/i }));
    expect(setInputMock).toHaveBeenCalledWith('Summarize this thread');
    expect(onSwitchTab).toHaveBeenCalledWith('chat');

    vi.clearAllMocks();

    fireEvent.click(screen.getByRole('button', { name: /What should I do with this/i }));
    expect(setInputMock).toHaveBeenCalledWith('What should I do with this?');
    expect(onSwitchTab).toHaveBeenCalledWith('chat');

    vi.clearAllMocks();

    fireEvent.click(screen.getByRole('button', { name: /Draft a reply/i }));
    expect(setInputMock).toHaveBeenCalledWith('Draft a reply');
    expect(onSwitchTab).toHaveBeenCalledWith('chat');
  });

  it('shows analysis banner when briefLoading is true', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();

    render(
      <DiscussPane
        item={item}
        threadDetail={detail}
        brief={null}
        briefLoading={true}
        onAgentAction={noop}
      />
    );

    expect(screen.getByTestId('discuss-pane-loading-banner')).toBeTruthy();
    expect(screen.getByText(/still analyzing this thread/i)).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();

    const { container } = render(
      <DiscussPane
        item={item}
        threadDetail={detail}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
