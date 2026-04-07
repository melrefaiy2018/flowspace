/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ThreadReader from '../ThreadReader';
import { api, type GmailThreadDetail } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  api: {
    draftReply: vi.fn(),
  },
}));

vi.mock('../InlineReplyCompose', () => ({
  default: () => <div data-testid="inline-reply-compose" />,
}));

const mockOpenExternalUrl = vi.fn();
vi.mock('../../../lib/open-external', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

function makeThread(overrides: Partial<GmailThreadDetail> = {}): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Lab meeting follow-up',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Alice <alice@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-03-12T10:00:00Z',
        body: 'Can we meet on Friday?',
        bodyType: 'text',
        attachments: [],
      },
    ],
    ...overrides,
  };
}

describe('ThreadReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders agent controls when a thread is open', () => {
    render(
      <ThreadReader
        thread={makeThread()}
        onBack={vi.fn()}
        onArchive={vi.fn().mockResolvedValue(undefined)}
        onTrash={vi.fn().mockResolvedValue(undefined)}
        onAgentAction={vi.fn()}
      />,
    );

    expect(screen.getByText('Agent actions')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft follow-up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create task' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask agent' })).toBeTruthy();
  });

  it('requires non-empty ask input before enabling Ask agent', () => {
    render(
      <ThreadReader
        thread={makeThread()}
        onBack={vi.fn()}
        onArchive={vi.fn().mockResolvedValue(undefined)}
        onTrash={vi.fn().mockResolvedValue(undefined)}
        onAgentAction={vi.fn()}
      />,
    );

    const askButton = screen.getByRole('button', { name: 'Ask agent' }) as HTMLButtonElement;
    expect(askButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Ask the agent about this email...'), {
      target: { value: 'What should I do next?' },
    });

    expect(askButton.disabled).toBe(false);
  });

  it('calls onAgentAction for quick actions and freeform asks', () => {
    const onAgentAction = vi.fn();
    const thread = makeThread();

    render(
      <ThreadReader
        thread={thread}
        onBack={vi.fn()}
        onArchive={vi.fn().mockResolvedValue(undefined)}
        onTrash={vi.fn().mockResolvedValue(undefined)}
        onAgentAction={onAgentAction}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(onAgentAction).toHaveBeenCalledWith(thread, 'add_to_calendar');

    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
    expect(onAgentAction).toHaveBeenCalledWith(thread, 'draft_follow_up');

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(onAgentAction).toHaveBeenCalledWith(thread, 'create_task');

    fireEvent.change(screen.getByPlaceholderText('Ask the agent about this email...'), {
      target: { value: 'Summarize the key ask.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask agent' }));

    expect(onAgentAction).toHaveBeenCalledWith(thread, 'ask_agent', 'Summarize the key ask.');
  });

  it('keeps native reply action working unchanged', async () => {
    vi.mocked(api.draftReply).mockResolvedValue({
      draft: 'Thanks for the note.',
      subject: 'Re: Lab meeting follow-up',
      to: 'alice@example.com',
      thread_id: 'thread-1',
      original_messages: [],
    });

    render(
      <ThreadReader
        thread={makeThread()}
        onBack={vi.fn()}
        onArchive={vi.fn().mockResolvedValue(undefined)}
        onTrash={vi.fn().mockResolvedValue(undefined)}
        onAgentAction={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    });

    expect(api.draftReply).toHaveBeenCalledWith('thread-1');
  });

  describe('external link handling', () => {
    it('opens external URL when iframe posts an open-url message', () => {
      const thread = makeThread({
        messages: [
          {
            id: 'msg-html',
            from: 'Spotify <no-reply@spotify.com>',
            to: 'me@example.com',
            cc: '',
            date: '2026-03-12T10:00:00Z',
            body: '<p>Visit your <a href="https://account.spotify.com">account page</a></p>',
            bodyType: 'html',
            attachments: [],
          },
        ],
      });

      render(
        <ThreadReader
          thread={thread}
          onBack={vi.fn()}
          onArchive={vi.fn().mockResolvedValue(undefined)}
          onTrash={vi.fn().mockResolvedValue(undefined)}
          onAgentAction={vi.fn()}
        />,
      );

      // Simulate the postMessage that the injected iframe script sends on link click
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'open-url', url: 'https://account.spotify.com' },
        }),
      );

      expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://account.spotify.com');
    });

    it('ignores postMessage events with unknown types', () => {
      mockOpenExternalUrl.mockClear();
      render(
        <ThreadReader
          thread={makeThread()}
          onBack={vi.fn()}
          onArchive={vi.fn().mockResolvedValue(undefined)}
          onTrash={vi.fn().mockResolvedValue(undefined)}
          onAgentAction={vi.fn()}
        />,
      );

      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'something-else', url: 'https://evil.com' } }),
      );

      expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    it('renders iframe with allow-scripts in sandbox for link interception', () => {
      const thread = makeThread({
        messages: [
          {
            id: 'msg-html',
            from: 'Spotify <no-reply@spotify.com>',
            to: 'me@example.com',
            cc: '',
            date: '2026-03-12T10:00:00Z',
            body: '<p>Visit your <a href="https://account.spotify.com">account page</a></p>',
            bodyType: 'html',
            attachments: [],
          },
        ],
      });

      const { container } = render(
        <ThreadReader
          thread={thread}
          onBack={vi.fn()}
          onArchive={vi.fn().mockResolvedValue(undefined)}
          onTrash={vi.fn().mockResolvedValue(undefined)}
          onAgentAction={vi.fn()}
        />,
      );

      const iframe = container.querySelector('iframe')!;
      expect(iframe).toBeTruthy();
      expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin allow-scripts');
    });
  });

  describe('HTML email dark-mode rendering', () => {
    it('renders HTML email body inside an iframe with invert filter for dark mode', () => {
      const thread = makeThread({
        messages: [
          {
            id: 'msg-html',
            from: 'Chase <no-reply@chase.com>',
            to: 'me@example.com',
            cc: '',
            date: '2026-03-12T10:00:00Z',
            body: '<div style="background:#fff;color:#000"><h1>Payment scheduled</h1></div>',
            bodyType: 'html',
            attachments: [],
          },
        ],
      });

      const { container } = render(
        <ThreadReader
          thread={thread}
          onBack={vi.fn()}
          onArchive={vi.fn().mockResolvedValue(undefined)}
          onTrash={vi.fn().mockResolvedValue(undefined)}
          onAgentAction={vi.fn()}
        />,
      );

      const iframe = container.querySelector('iframe');
      expect(iframe).toBeTruthy();
      // Iframe should use CSS invert filter for reliable dark-mode, not per-element color overrides
      const style = iframe!.getAttribute('style') ?? '';
      expect(style).toContain('filter');
      expect(style).toContain('invert');
    });

    it('renders plain text email without an iframe', () => {
      const thread = makeThread({
        messages: [
          {
            id: 'msg-text',
            from: 'Alice <alice@example.com>',
            to: 'me@example.com',
            cc: '',
            date: '2026-03-12T10:00:00Z',
            body: 'Just plain text',
            bodyType: 'text',
            attachments: [],
          },
        ],
      });

      const { container } = render(
        <ThreadReader
          thread={thread}
          onBack={vi.fn()}
          onArchive={vi.fn().mockResolvedValue(undefined)}
          onTrash={vi.fn().mockResolvedValue(undefined)}
          onAgentAction={vi.fn()}
        />,
      );

      expect(container.querySelector('iframe')).toBeNull();
      expect(screen.getByText('Just plain text')).toBeTruthy();
    });
  });
});
