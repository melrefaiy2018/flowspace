/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ThreadReader, { MessageCard } from '../ThreadReader';
import type { GmailThreadDetail } from '../../../services/api';
import { ThemeProvider } from '../../../context/ThemeContext';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

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

  it('renders a message card with sender name', () => {
    renderWithTheme(<ThreadReader thread={makeThread()} />);
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('renders plain text message body', () => {
    renderWithTheme(<ThreadReader thread={makeThread()} />);
    expect(screen.getByText('Can we meet on Friday?')).toBeTruthy();
  });

  it('renders all messages in a multi-message thread', () => {
    const thread = makeThread({
      messages: [
        {
          id: 'msg-1',
          from: 'Alice <alice@example.com>',
          to: 'me@example.com',
          cc: '',
          date: '2026-03-12T10:00:00Z',
          body: 'First message',
          bodyType: 'text',
          attachments: [],
        },
        {
          id: 'msg-2',
          from: 'Bob <bob@example.com>',
          to: 'alice@example.com',
          cc: '',
          date: '2026-03-12T11:00:00Z',
          body: 'Second message',
          bodyType: 'text',
          attachments: [],
        },
      ],
    });
    renderWithTheme(<ThreadReader thread={thread} />);
    expect(screen.getByText('First message')).toBeTruthy();
    expect(screen.getByText('Second message')).toBeTruthy();
  });

  it('renders no toolbar, no back button, no reply button', () => {
    renderWithTheme(<ThreadReader thread={makeThread()} />);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reply/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /archive/i })).toBeNull();
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

      renderWithTheme(<ThreadReader thread={thread} />);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'open-url', url: 'https://account.spotify.com' },
        }),
      );

      expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://account.spotify.com');
    });

    it('ignores postMessage events with unknown types', () => {
      mockOpenExternalUrl.mockClear();
      renderWithTheme(<ThreadReader thread={makeThread()} />);

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

      const { container } = renderWithTheme(<ThreadReader thread={thread} />);

      const iframe = container.querySelector('iframe')!;
      expect(iframe).toBeTruthy();
      expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin allow-scripts');
    });

    it('wraps HTML email content in a natural-height iframe document', () => {
      const thread = makeThread({
        messages: [
          {
            id: 'msg-html',
            from: 'Calendar <calendar-notification@google.com>',
            to: 'me@example.com',
            cc: '',
            date: '2026-03-12T10:00:00Z',
            body: '<table height="100%"><tbody><tr><td>Calendar invite</td></tr></tbody></table>',
            bodyType: 'html',
            attachments: [],
          },
        ],
      });

      const { container } = renderWithTheme(<ThreadReader thread={thread} />);

      const iframe = container.querySelector('iframe')!;
      const iframeDocument = iframe.contentDocument!;
      expect(iframe.className).toContain('shrink-0');
      expect(iframeDocument.getElementById('flowspace-email-root')).toBeTruthy();
      expect(iframeDocument.head.textContent).toContain('[height="100%"]');
      expect(iframeDocument.head.textContent).toContain('[style*="min-height: 100%"]');
      const inviteTable = iframeDocument.querySelector('table') as HTMLTableElement;
      expect(inviteTable.getAttribute('height')).toBeNull();
      expect(inviteTable.style.height).toBe('auto');
      expect(inviteTable.style.minHeight).toBe('0px');
    });
  });

  describe('plain text email rendering', () => {
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

      const { container } = renderWithTheme(<ThreadReader thread={thread} />);

      expect(container.querySelector('iframe')).toBeNull();
      expect(screen.getByText('Just plain text')).toBeTruthy();
    });
  });
});

describe('MessageCard (named export)', () => {
  it('renders sender name and date', () => {
    const message = {
      id: 'msg-1',
      from: 'Alice <alice@example.com>',
      to: 'me@example.com',
      cc: '',
      date: '2026-03-12T10:00:00Z',
      body: 'Hello',
      bodyType: 'text' as const,
      attachments: [],
    };
    const { container } = renderWithTheme(<MessageCard message={message} isLast={true} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(container.firstElementChild?.className).toContain('shrink-0');
  });

  it('renders plain text body', () => {
    const message = {
      id: 'msg-1',
      from: 'Alice <alice@example.com>',
      to: 'me@example.com',
      cc: '',
      date: '2026-03-12T10:00:00Z',
      body: 'Hello from Alice',
      bodyType: 'text' as const,
      attachments: [],
    };
    renderWithTheme(<MessageCard message={message} isLast={false} />);
    expect(screen.getByText('Hello from Alice')).toBeTruthy();
  });
});
