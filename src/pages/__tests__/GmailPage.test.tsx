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
const gmailPageState = {
  threads: [],
  labels: [],
  selectedThread: {
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
        attachments: [],
      },
    ],
  },
  activeLabel: 'INBOX',
  searchQuery: '',
  loading: false,
  threadLoading: false,
  error: null,
  hasMore: false,
  selectedThreadIds: [] as string[],
  recentAction: null,
  actionHistory: [],
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
};

vi.mock('../../hooks/useGmailPage', () => ({
  useGmailPage: () => gmailPageState,
}));

vi.mock('../../context/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: mockSendMessage,
  }),
}));

vi.mock('../../components/gmail/LabelFilter', () => ({
  default: () => <div data-testid="label-filter" />,
}));

vi.mock('../../components/gmail/ThreadList', () => ({
  default: () => <div data-testid="thread-list" />,
}));

describe('GmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gmailPageState.selectedThreadIds = [];
    gmailPageState.recentAction = null;
    gmailPageState.actionHistory = [];
    gmailPageState.selectedThread = {
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
          attachments: [],
        },
      ],
    };
  });

  it('opens agent actions in the side panel flow on desktop', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });

    render(<GmailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
      forceNewChat: true,
      preserveActiveView: true,
      displayContent: expect.any(String),
    }));
  });

  it('falls back to full chat handoff on mobile widths', () => {
    Object.defineProperty(window, 'innerWidth', { value: 768, configurable: true });

    render(<GmailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
      forceNewChat: true,
      preserveActiveView: false,
      displayContent: expect.any(String),
    }));
  });

  it('wires Trash selected to the bulk Gmail action', () => {
    gmailPageState.selectedThreadIds = ['thread-1'];

    render(<GmailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Trash selected' }));

    expect(mockPerformBulkAction).toHaveBeenCalledWith('trash_threads');
  });

  it('keeps the undo banner visible even when no thread is selected', () => {
    gmailPageState.selectedThread = null;
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
});
