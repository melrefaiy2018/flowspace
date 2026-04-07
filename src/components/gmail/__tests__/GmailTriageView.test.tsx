/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GmailTriageView from '../GmailTriageView';
import type { GmailThreadSummary } from '../../../services/api';
import type { ThreadTriageResult } from '../../../lib/triage';

function makeThread(id: string, subject: string, from: string, unread = false): GmailThreadSummary {
  return {
    id,
    subject,
    from,
    date: '2026-03-26T10:00:00Z',
    snippet: `Snippet for ${subject}`,
    unread,
    labelIds: ['INBOX'],
    messageCount: 1,
    hasAttachments: false,
  };
}

function makeTriage(): ThreadTriageResult {
  return {
    urgent: [makeThread('t1', 'Urgent meeting', 'boss@example.com', true)],
    needs_attention: [makeThread('t2', 'Review PR', 'dev@example.com', true)],
    informational: [makeThread('t3', 'Weekly digest', 'newsletter@example.com')],
    low_priority: [
      makeThread('t4', 'Promo sale', 'store@example.com'),
      makeThread('t5', 'Social update', 'social@example.com'),
    ],
  };
}

const defaultProps = () => ({
  triage: makeTriage(),
  onSelectThread: vi.fn(),
  selectedThreadId: null as string | null,
  customCategories: [] as { id: string; label: string; threadIds: string[] }[],
  onAddCategory: vi.fn(),
  onMoveThread: vi.fn(),
  onArchiveThread: vi.fn(),
  onAskAgent: vi.fn(),
});

describe('GmailTriageView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default categories with thread counts', () => {
    render(<GmailTriageView {...defaultProps()} />);
    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Informational')).toBeTruthy();
    expect(screen.getByText('Low priority')).toBeTruthy();
    expect(screen.getByText('5 threads categorized')).toBeTruthy();
  });

  it('renders custom categories when provided (even empty)', () => {
    const props = defaultProps();
    props.customCategories = [
      { id: 'cat-1', label: 'Job Applications', threadIds: [] },
    ];
    render(<GmailTriageView {...props} />);
    expect(screen.getByText('Job Applications')).toBeTruthy();
  });

  it('shows Add category button', () => {
    render(<GmailTriageView {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /add category/i })).toBeTruthy();
  });

  it('calls onAddCategory when creating a new category', () => {
    const props = defaultProps();
    render(<GmailTriageView {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /add category/i }));
    const input = screen.getByPlaceholderText(/category name/i);
    fireEvent.change(input, { target: { value: 'Finance' } });
    fireEvent.submit(input.closest('form')!);

    expect(props.onAddCategory).toHaveBeenCalledWith('Finance');
  });

  it('shows thread action buttons (always visible, no hover needed)', () => {
    const props = defaultProps();
    render(<GmailTriageView {...props} />);

    const urgentThread = screen.getByText('Urgent meeting').closest('[data-thread-id]')!;
    const actions = within(urgentThread as HTMLElement);
    expect(actions.getByTitle('Archive')).toBeTruthy();
    expect(actions.getByTitle('Ask agent')).toBeTruthy();
    expect(actions.getByTitle('Move to category')).toBeTruthy();
  });

  it('calls onArchiveThread when clicking archive action', () => {
    const props = defaultProps();
    render(<GmailTriageView {...props} />);

    const urgentThread = screen.getByText('Urgent meeting').closest('[data-thread-id]')!;
    fireEvent.click(within(urgentThread as HTMLElement).getByTitle('Archive'));

    expect(props.onArchiveThread).toHaveBeenCalledWith('t1');
  });

  it('calls onAskAgent when clicking ask agent action', () => {
    const props = defaultProps();
    render(<GmailTriageView {...props} />);

    const urgentThread = screen.getByText('Urgent meeting').closest('[data-thread-id]')!;
    fireEvent.click(within(urgentThread as HTMLElement).getByTitle('Ask agent'));

    expect(props.onAskAgent).toHaveBeenCalledWith('t1');
  });

  it('shows move menu with categories when clicking move action', () => {
    const props = defaultProps();
    props.customCategories = [{ id: 'cat-1', label: 'Finance', threadIds: [] }];
    render(<GmailTriageView {...props} />);

    const urgentThread = screen.getByText('Urgent meeting').closest('[data-thread-id]')!;
    fireEvent.click(within(urgentThread as HTMLElement).getByTitle('Move to category'));

    const moveMenu = within(urgentThread as HTMLElement);
    expect(moveMenu.getByText('Low priority')).toBeTruthy();
    expect(moveMenu.getByText('Finance')).toBeTruthy();
  });

  it('calls onMoveThread when selecting a category from move menu', () => {
    const props = defaultProps();
    props.customCategories = [{ id: 'cat-1', label: 'Finance', threadIds: [] }];
    render(<GmailTriageView {...props} />);

    const urgentThread = screen.getByText('Urgent meeting').closest('[data-thread-id]')!;
    fireEvent.click(within(urgentThread as HTMLElement).getByTitle('Move to category'));
    fireEvent.click(within(urgentThread as HTMLElement).getByText('Finance'));

    expect(props.onMoveThread).toHaveBeenCalledWith('t1', 'cat-1');
  });

  it('moves threads from default category to custom category correctly', () => {
    const props = defaultProps();
    // t4 has been moved to custom category
    props.customCategories = [{ id: 'cat-1', label: 'Finance', threadIds: ['t4'] }];
    render(<GmailTriageView {...props} />);

    // t4 should appear under Finance, not Low priority
    const financeSection = screen.getByText('Finance').closest('[data-category]')!;
    expect(within(financeSection as HTMLElement).getByText('Promo sale')).toBeTruthy();
  });

  it('renders empty state when no threads exist', () => {
    const emptyTriage: ThreadTriageResult = {
      urgent: [], needs_attention: [], informational: [], low_priority: [],
    };
    render(<GmailTriageView {...defaultProps()} triage={emptyTriage} />);
    expect(screen.getByText('No emails to categorize')).toBeTruthy();
  });
});
