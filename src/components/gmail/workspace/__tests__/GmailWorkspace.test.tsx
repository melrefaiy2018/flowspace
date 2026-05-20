/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import GmailWorkspace from '../GmailWorkspace.js';
import { ThemeProvider } from '../../../../context/ThemeContext.js';
import type { WorkItem } from '../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../services/api.js';

expect.extend(toHaveNoViolations);

// Mock the api module so telemetry calls don't make real network requests.
// Use vi.hoisted so the mock fn is available when the factory runs (vi.mock is hoisted).
const { mockReportGmailWorkspaceOpen, mockCloseChat } = vi.hoisted(() => ({
  mockReportGmailWorkspaceOpen: vi.fn().mockResolvedValue(undefined),
  mockCloseChat: vi.fn(),
}));
vi.mock('../../../../services/api.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../services/api.js')>();
  return {
    ...original,
    api: {
      ...(original as any).api,
      reportGmailWorkspaceOpen: mockReportGmailWorkspaceOpen,
    },
  };
});

// Mock useThreadBrief so no real network calls are made
vi.mock('../../../../hooks/useThreadBrief.js', () => ({
  useThreadBrief: () => ({ brief: null, loading: false, error: null }),
}));

// Mock ChatContext so GmailWorkspace (which calls closeChat on mount) doesn't require a ChatProvider.
vi.mock('../../../../context/ChatContext.js', () => ({
  useChatContext: () => ({
    closeChat: mockCloseChat,
    setInput: vi.fn(),
    getOrCreateConversation: vi.fn(),
    currentConversationId: 'gmail-thread:thread-1',
  }),
}));

// Mock PaneRouter so we can assert it's rendered without pane internals interfering.
// The mock exposes a "Complete pane" button that calls onComplete so tests can trigger the done footer.
vi.mock('../panes/PaneRouter.js', () => ({
  default: ({ item, onComplete }: { item: WorkItem; onComplete?: (summary: string) => void }) => (
    <div data-testid="pane-router" data-panekind={item.paneKind}>
      PaneRouter
      {onComplete && (
        <button
          data-testid="trigger-complete"
          onClick={() => onComplete('Archived "Test item"')}
        >
          Complete pane
        </button>
      )}
    </div>
  ),
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'personal_reply_needed',
    title: 'Hey, can you review this?',
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
    subject: 'Hey, can you review this?',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Alice Lee <alice@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Please review this document.',
        bodyType: 'text',
        attachments: [],
      },
      {
        id: 'msg-2',
        from: 'me@example.com',
        to: 'alice@example.com',
        cc: '',
        date: '2026-04-02T10:00:00Z',
        body: 'Sure, I will take a look.',
        bodyType: 'text',
        attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', size: 12345, attachmentId: 'att-1' }],
      },
    ],
    ...overrides,
  };
}

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const defaultOnArchive = vi.fn();
const defaultOnPrimaryAction = vi.fn();
const defaultOnSecondaryAction = vi.fn();
const defaultOnAgentAction = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GmailWorkspace', () => {
  it('renders empty state when item is null', () => {
    renderWithTheme(
      <GmailWorkspace
        item={null}
        threadDetail={null}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    expect(screen.getByText(/Pick an item from the queue to start working/i)).toBeTruthy();
  });

  it('renders workspace header and tab bar when item is provided', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    // Header shows subject
    expect(screen.getByText('Hey, can you review this?')).toBeTruthy();
    // Tab bar shows all five tabs
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('Thread')).toBeTruthy();
    expect(screen.getByText('Context')).toBeTruthy();
    expect(screen.getByText('Agent Work')).toBeTruthy();
    expect(screen.getByText('Chat')).toBeTruthy();
  });

  it('Email is the default selected tab on mount', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    const emailTab = screen.getByRole('tab', { name: /^Email$/i });
    expect(emailTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('email-tab')).toBeTruthy();
    expect(screen.getByTestId('email-tab').className).toContain('min-h-0');
  });

  it('renders PaneRouter in the Agent Work tab with the correct paneKind', () => {
    const item = makeWorkItem({ paneKind: 'draft' });
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    // Navigate to Agent Work (no longer the default)
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    const router = screen.getByTestId('pane-router');
    expect(router).toBeTruthy();
    expect(router.getAttribute('data-panekind')).toBe('draft');
  });

  it('switches to Email tab body when Email tab is clicked', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    // Email is already the default, but clicking it again should still show the tab
    fireEvent.click(screen.getByRole('tab', { name: /^Email$/i }));
    expect(screen.getByTestId('email-tab')).toBeTruthy();
  });

  it('fires onPrimaryAction with item when primary button is clicked', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Draft reply/i }));
    expect(defaultOnPrimaryAction).toHaveBeenCalledWith(item);
  });

  it('routes the Discuss chip to the inline Chat tab without opening the drawer flow', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Discuss/i }));
    expect(defaultOnSecondaryAction).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /^Chat$/i }).getAttribute('aria-selected')).toBe('true');
    expect(mockCloseChat).toHaveBeenCalled();
  });

  it('fires onSecondaryAction with item and kind for non-chat secondary chips', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Snooze/i }));
    expect(defaultOnSecondaryAction).toHaveBeenCalledWith(item, 'snooze');
  });

  it('has no accessibility violations in ready state', async () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    const { container } = renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // ── Done-state footer tests ─────────────────────────────────────────────────

  it('does NOT render done footer initially (before any action completes)', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    expect(screen.queryByText(/Archived/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Next item/i })).toBeNull();
  });

  it('renders done footer with summary when onComplete is triggered by PaneRouter', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
        onNext={vi.fn()}
      />
    );
    // Navigate to Agent Work tab where PaneRouter is rendered
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    fireEvent.click(screen.getByTestId('trigger-complete'));
    expect(screen.getByText('Archived "Test item"')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Next item/i })).toBeTruthy();
  });

  it('shows Undo button when completion summary starts with "Archived"', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    const onUndo = vi.fn();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
        onNext={vi.fn()}
        onUndo={onUndo}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    fireEvent.click(screen.getByTestId('trigger-complete'));
    // "Archived ..." summary → canUndo = true → Undo button visible
    expect(screen.getByRole('button', { name: /^Undo$/i })).toBeTruthy();
  });

  it('does NOT show Undo button when onUndo prop is absent', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
        onNext={vi.fn()}
        // no onUndo prop
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    fireEvent.click(screen.getByTestId('trigger-complete'));
    // Undo button should not appear when onUndo is not provided
    expect(screen.queryByRole('button', { name: /^Undo$/i })).toBeNull();
  });

  it('calls onNext and hides footer when "Next item →" button is clicked', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    const onNext = vi.fn();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
        onNext={onNext}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    fireEvent.click(screen.getByTestId('trigger-complete'));
    const nextBtn = screen.getByRole('button', { name: /Next item/i });
    fireEvent.click(nextBtn);
    expect(onNext).toHaveBeenCalledTimes(1);
    // Footer should be dismissed
    expect(screen.queryByRole('button', { name: /Next item/i })).toBeNull();
  });

  it('calls onUndo and hides footer when Undo button is clicked', () => {
    const item = makeWorkItem();
    const detail = makeThreadDetail();
    const onUndo = vi.fn();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
        onNext={vi.fn()}
        onUndo={onUndo}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    fireEvent.click(screen.getByTestId('trigger-complete'));
    const undoBtn = screen.getByRole('button', { name: /^Undo$/i });
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
    // Footer should be dismissed
    expect(screen.queryByRole('button', { name: /^Undo$/i })).toBeNull();
  });

  it('clears done footer when item changes (switching to a new item)', () => {
    const item1 = makeWorkItem({ id: 'thread-1', source: { kind: 'gmail', threadId: 'thread-1' } });
    const item2 = makeWorkItem({ id: 'thread-2', source: { kind: 'gmail', threadId: 'thread-2' } });
    const detail = makeThreadDetail();
    const onNext = vi.fn();

    const { rerender } = renderWithTheme(
      <GmailWorkspace
        item={item1}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
        onNext={onNext}
      />
    );
    // Navigate to Agent Work, trigger completion
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    fireEvent.click(screen.getByTestId('trigger-complete'));
    expect(screen.getByRole('button', { name: /Next item/i })).toBeTruthy();

    // Switch to a different item — done footer should clear
    rerender(
      <ThemeProvider>
        <GmailWorkspace
          item={item2}
          threadDetail={detail}
          onArchive={defaultOnArchive}
          onPrimaryAction={defaultOnPrimaryAction}
          onSecondaryAction={defaultOnSecondaryAction}
          onAgentAction={defaultOnAgentAction}
          onNext={onNext}
        />
      </ThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /Next item/i })).toBeNull();
  });

  // ── Telemetry tests ─────────────────────────────────────────────────────────

  it('calls api.reportGmailWorkspaceOpen when an item is rendered', () => {
    const item = makeWorkItem({ paneKind: 'draft', type: 'personal_reply_needed' });
    const detail = makeThreadDetail();
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    expect(mockReportGmailWorkspaceOpen).toHaveBeenCalledTimes(1);
  });

  it('passes correct threadType and paneKind to reportGmailWorkspaceOpen', () => {
    const item = makeWorkItem({
      id: 'thread-99',
      source: { kind: 'gmail', threadId: 'thread-99' },
      type: 'newsletter',
      paneKind: 'review',
    });
    const detail = makeThreadDetail({ id: 'thread-99' });
    renderWithTheme(
      <GmailWorkspace
        item={item}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    expect(mockReportGmailWorkspaceOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        threadType: 'newsletter',
        paneKind: 'review',
        threadId: 'thread-99',
        durationMs: expect.any(Number),
      })
    );
  });

  it('does NOT call reportGmailWorkspaceOpen when item is null', () => {
    renderWithTheme(
      <GmailWorkspace
        item={null}
        threadDetail={null}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );
    expect(mockReportGmailWorkspaceOpen).not.toHaveBeenCalled();
  });

  // ── Loading guard (stableItem / rapid-switch) tests ─────────────────────────

  it('rapid item switch: only renders the final item pane after debounce settles', () => {
    vi.useFakeTimers();

    const item1 = makeWorkItem({
      id: 'thread-A',
      source: { kind: 'gmail', threadId: 'thread-A' },
      paneKind: 'draft',
    });
    const item2 = makeWorkItem({
      id: 'thread-B',
      source: { kind: 'gmail', threadId: 'thread-B' },
      paneKind: 'review',
    });
    const detail = makeThreadDetail();

    const { rerender } = renderWithTheme(
      <GmailWorkspace
        item={item1}
        threadDetail={detail}
        onArchive={defaultOnArchive}
        onPrimaryAction={defaultOnPrimaryAction}
        onSecondaryAction={defaultOnSecondaryAction}
        onAgentAction={defaultOnAgentAction}
      />
    );

    // Navigate to Agent Work tab so PaneRouter is visible for item1
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    expect(screen.getByTestId('pane-router').getAttribute('data-panekind')).toBe('draft');

    // Within 50ms, switch to item B before debounce settles
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender(
      <ThemeProvider>
        <GmailWorkspace
          item={item2}
          threadDetail={detail}
          onArchive={defaultOnArchive}
          onPrimaryAction={defaultOnPrimaryAction}
          onSecondaryAction={defaultOnSecondaryAction}
          onAgentAction={defaultOnAgentAction}
        />
      </ThemeProvider>
    );

    // Advance past the debounce window (150ms total) — this triggers stableItem update
    // and resets the tab to Email (per the item-change useEffect)
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Navigate back to Agent Work for item2 to verify stableItem settled on item B
    fireEvent.click(screen.getByRole('tab', { name: /^Agent Work$/i }));
    const router = screen.getByTestId('pane-router');
    expect(router.getAttribute('data-panekind')).toBe('review');

    vi.useRealTimers();
  });
});
