/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import GmailPage from '../GmailPage';

const mockSelectThread = vi.fn();
const mockLoadMore = vi.fn();
const mockArchive = vi.fn();
const mockTrash = vi.fn();
const mockSendMessage = vi.fn();
const mockPerformBulkAction = vi.fn();
const mockUndoRecentAction = vi.fn();
const mockSelectNextInQueue = vi.fn();
const gmailPageState = {
  threads: [],
  labels: [],
  selectedThread: null as null | {
    id: string;
    subject: string;
    labelIds: string[];
    messages: Array<{
      id: string;
      from: string;
      to: string;
      cc: string;
      date: string;
      body: string;
      bodyType: 'text' | 'html';
      attachments: never[];
    }>;
  },
  activeLabel: 'INBOX',
  searchQuery: '',
  loading: false,
  threadLoading: false,
  error: null,
  hasMore: false,
  selectedThreadIds: [] as string[],
  recentAction: null,
  actionHistory: [] as unknown[],
  enrichmentMap: new Map(),
  enrichmentQueue: new Set<string>(),
  enrichmentStatus: 'idle' as const,
  enrichmentProgress: null,
  fallbackReason: null as string | null,
  invalidateLocalEnrichment: vi.fn(),
  setLabel: vi.fn(),
  setSearchQuery: vi.fn(),
  selectThread: mockSelectThread,
  deselectThread: vi.fn(),
  loadMore: mockLoadMore,
  toggleThreadSelection: vi.fn(),
  selectAllVisibleThreads: vi.fn(),
  clearSelection: vi.fn(),
  performBulkAction: mockPerformBulkAction,
  undoRecentAction: mockUndoRecentAction,
  archive: mockArchive,
  trash: mockTrash,
  refresh: vi.fn(),
  selectNextInQueue: mockSelectNextInQueue,
};

vi.mock('../../hooks/useGmailPage', () => ({
  useGmailPage: () => gmailPageState,
}));

vi.mock('../../context/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: mockSendMessage,
    clearNavigateTab: vi.fn(),
    navigateRefresh: false,
    clearNavigateRefresh: vi.fn(),
  }),
}));

vi.mock('../../components/gmail/LabelFilter', () => ({
  default: () => <div data-testid="label-filter" />,
}));

vi.mock('../../components/gmail/ThreadList', () => ({
  default: () => <div data-testid="thread-list" />,
}));

vi.mock('../../components/gmail/BucketedThreadList', () => ({
  default: ({ showRawInbox }: { showRawInbox: boolean }) => (
    <div data-testid="bucketed-thread-list" data-raw={String(showRawInbox)} />
  ),
}));

vi.mock('../../components/gmail/SavedThreadList', () => ({
  default: () => <div data-testid="saved-thread-list" />,
}));

vi.mock('../../components/gmail/workspace/GmailWorkspace', () => ({
  default: ({ item, onNext, onUndo }: { item: unknown; onNext?: () => void; onUndo?: () => void }) => (
    <div
      data-testid="gmail-workspace"
      data-has-item={item !== null ? 'true' : 'false'}
      data-item-id={item !== null && typeof item === 'object' && 'id' in (item as object) ? String((item as { id: string }).id) : ''}
      data-has-on-next={onNext !== undefined ? 'true' : 'false'}
      data-has-on-undo={onUndo !== undefined ? 'true' : 'false'}
    />
  ),
}));

describe('GmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    gmailPageState.selectedThreadIds = [];
    gmailPageState.recentAction = null;
    gmailPageState.actionHistory = [];
    gmailPageState.fallbackReason = null;
    gmailPageState.selectedThread = null;
    gmailPageState.threads = [];
  });

  it('renders BucketedThreadList as main content (no tab buttons)', () => {
    render(<GmailPage />);
    expect(screen.getByTestId('bucketed-thread-list')).toBeTruthy();
    // No old tab buttons
    expect(screen.queryByRole('button', { name: /^Inbox$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^AI Triage$/ })).toBeNull();
    expect(screen.queryByText('AI Triage')).toBeNull();
  });

  it('renders GmailWorkspace in workspace mode (not raw inbox)', () => {
    render(<GmailPage />);
    expect(screen.getByTestId('gmail-workspace')).toBeTruthy();
  });

  it('renders Saved dropdown button', () => {
    render(<GmailPage />);
    const savedBtn = screen.getByRole('button', { name: /Saved/i });
    expect(savedBtn).toBeTruthy();
  });

  it('opens Saved popover when Saved button is clicked', () => {
    render(<GmailPage />);
    const savedBtn = screen.getByRole('button', { name: /Saved/i });
    expect(screen.queryByTestId('saved-thread-list')).toBeNull();
    fireEvent.click(savedBtn);
    expect(screen.getByTestId('saved-thread-list')).toBeTruthy();
  });

  it('Show raw inbox toggle renders and is not pressed by default', () => {
    render(<GmailPage />);
    const toggle = screen.getByRole('button', { name: /Raw inbox/i });
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('Show raw inbox toggle sets showRawInbox=true on click and passes to BucketedThreadList', () => {
    render(<GmailPage />);
    const toggle = screen.getByRole('button', { name: /Raw inbox/i });
    expect(screen.getByTestId('bucketed-thread-list').getAttribute('data-raw')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('bucketed-thread-list').getAttribute('data-raw')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('raw inbox mode hides workspace and shows full-width thread list', () => {
    render(<GmailPage />);
    const toggle = screen.getByRole('button', { name: /Raw inbox/i });
    fireEvent.click(toggle);
    // In raw inbox mode, the workspace should not be rendered
    expect(screen.queryByTestId('gmail-workspace')).toBeNull();
    // Thread list is still rendered
    expect(screen.getByTestId('bucketed-thread-list')).toBeTruthy();
  });

  it('wires Trash selected to the bulk Gmail action', () => {
    gmailPageState.selectedThreadIds = ['thread-1'];

    render(<GmailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Trash selected' }));

    expect(mockPerformBulkAction).toHaveBeenCalledWith('trash_threads');
  });

  it('keeps the undo banner visible even when no thread is selected', () => {
    gmailPageState.recentAction = {
      action_type: 'trash_threads',
      requested_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      undo_available: true,
      audit_id: 'audit-1',
      items: [{ thread_id: 'thread-1', sender: 'Recruiter', subject: 'Interview request', status: 'completed' }],
      message: 'Completed 1 action.',
    };
    gmailPageState.actionHistory = [{
      audit_id: 'audit-1',
      action_type: 'trash_threads',
      initiated_at: Date.now(),
      thread_ids: ['thread-1'],
      approval_snapshot: 'Trash 1 thread',
      requested_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      undo_available: true,
      result_items: [{ thread_id: 'thread-1', sender: 'Recruiter', subject: 'Interview request', status: 'completed' }],
    }];

    render(<GmailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(mockUndoRecentAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Completed 1 action.')).toBeTruthy();
  });

  // T025: SmartViewUnavailableBanner and enrichment props wiring
  it('T025: renders SmartViewUnavailableBanner when fallbackReason is set', () => {
    gmailPageState.fallbackReason = 'enrichment_timeout';

    render(<GmailPage />);

    expect(screen.getByText(/Smart view unavailable/i)).toBeTruthy();
  });

  it('T025: does not render SmartViewUnavailableBanner when fallbackReason is null', () => {
    gmailPageState.fallbackReason = null;

    render(<GmailPage />);

    expect(screen.queryByText(/Smart view unavailable/i)).toBeNull();
  });

  it('workspace receives workItem null when no thread is selected', () => {
    gmailPageState.selectedThread = null;
    render(<GmailPage />);
    const workspace = screen.getByTestId('gmail-workspace');
    expect(workspace.getAttribute('data-has-item')).toBe('false');
  });

  it('workspace receives workItem when thread is selected and found in threads list', () => {
    const thread = {
      id: 'thread-1',
      subject: 'Interview request',
      labelIds: ['INBOX'],
      messages: [
        {
          id: 'msg-1',
          from: 'Recruiter <recruiter@example.com>',
          to: 'me@example.com',
          cc: '',
          date: '2026-03-12T10:00:00Z',
          body: 'Can you meet on Tuesday at 2 PM?',
          bodyType: 'text' as const,
          attachments: [] as never[],
        },
      ],
    };
    gmailPageState.selectedThread = thread;
    // threads list must have a matching summary for workItemFromGmailThread to work
    (gmailPageState as unknown as { threads: unknown[] }).threads = [
      {
        id: 'thread-1',
        subject: 'Interview request',
        from: 'Recruiter <recruiter@example.com>',
        snippet: 'Can you meet on Tuesday at 2 PM?',
        date: '2026-03-12T10:00:00Z',
        labelIds: ['INBOX'],
        isUnread: false,
        attachmentCount: 0,
      },
    ];

    render(<GmailPage />);

    const workspace = screen.getByTestId('gmail-workspace');
    expect(workspace.getAttribute('data-has-item')).toBe('true');
    expect(workspace.getAttribute('data-item-id')).toBe('thread-1');
  });

  it('does not render old "Reader ready" placeholder', () => {
    render(<GmailPage />);
    expect(screen.queryByText('Reader ready')).toBeNull();
  });

  it('GmailWorkspace receives onNext prop wired to selectNextInQueue', () => {
    render(<GmailPage />);
    const workspace = screen.getByTestId('gmail-workspace');
    expect(workspace.getAttribute('data-has-on-next')).toBe('true');
  });

  it('GmailWorkspace receives onUndo prop wired to undoRecentAction', () => {
    render(<GmailPage />);
    const workspace = screen.getByTestId('gmail-workspace');
    expect(workspace.getAttribute('data-has-on-undo')).toBe('true');
  });
});
