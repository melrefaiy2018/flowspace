/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FollowupPanel from '../FollowupPanel';
import type { FollowupItem, SavedEmail } from '../../services/api';

function makeFollowup(overrides: Partial<FollowupItem> = {}): FollowupItem {
  return {
    task_id: 'task-1',
    title: 'Send proposal → Alice',
    commitment: 'Send proposal',
    recipient: 'Alice',
    thread_id: 'thread-1',
    subject: 'Project kickoff',
    due: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    status: 'upcoming',
    ...overrides,
  };
}

function makeSaved(overrides: Partial<SavedEmail> = {}): SavedEmail {
  return {
    id: 'pref-1',
    thread_id: 'thread-saved',
    subject: 'Important announcement',
    sender: 'Bob',
    saved_at: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
    label: 'important',
    ...overrides,
  };
}

describe('FollowupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no follow-ups', () => {
    render(
      <FollowupPanel
        followups={[]}
        onComplete={vi.fn()}
        onSnooze={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('No open follow-ups')).toBeTruthy();
  });

  it('renders follow-up items', () => {
    render(
      <FollowupPanel
        followups={[makeFollowup()]}
        onComplete={vi.fn()}
        onSnooze={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Send proposal')).toBeTruthy();
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  describe('saved emails section', () => {
    it('does not render saved emails section when prop is absent', () => {
      render(
        <FollowupPanel
          followups={[]}
          onComplete={vi.fn()}
          onSnooze={vi.fn()}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.queryByText('Saved emails')).toBeNull();
    });

    it('does not render saved emails section when list is empty', () => {
      render(
        <FollowupPanel
          followups={[]}
          savedEmails={[]}
          onComplete={vi.fn()}
          onSnooze={vi.fn()}
          onDelete={vi.fn()}
          onUnsaveEmail={vi.fn()}
          onOpenSavedThread={vi.fn()}
        />,
      );

      expect(screen.queryByText('Saved emails')).toBeNull();
    });

    it('renders saved emails section when savedEmails is non-empty', () => {
      render(
        <FollowupPanel
          followups={[]}
          savedEmails={[makeSaved()]}
          onComplete={vi.fn()}
          onSnooze={vi.fn()}
          onDelete={vi.fn()}
          onUnsaveEmail={vi.fn()}
          onOpenSavedThread={vi.fn()}
        />,
      );

      expect(screen.getByText('Saved emails')).toBeTruthy();
      expect(screen.getByText('Important announcement')).toBeTruthy();
      expect(screen.getByText(/Bob/)).toBeTruthy();
    });

    it('calls onOpenSavedThread when Open button is clicked', () => {
      const onOpenSavedThread = vi.fn();

      render(
        <FollowupPanel
          followups={[]}
          savedEmails={[makeSaved({ thread_id: 'thread-saved-1' })]}
          onComplete={vi.fn()}
          onSnooze={vi.fn()}
          onDelete={vi.fn()}
          onUnsaveEmail={vi.fn()}
          onOpenSavedThread={onOpenSavedThread}
        />,
      );

      fireEvent.click(screen.getByTitle('Open in Gmail'));
      expect(onOpenSavedThread).toHaveBeenCalledWith('thread-saved-1');
    });

    it('calls onUnsaveEmail with preference id when unsave is clicked', () => {
      const onUnsaveEmail = vi.fn();

      render(
        <FollowupPanel
          followups={[]}
          savedEmails={[makeSaved({ id: 'pref-42' })]}
          onComplete={vi.fn()}
          onSnooze={vi.fn()}
          onDelete={vi.fn()}
          onUnsaveEmail={onUnsaveEmail}
          onOpenSavedThread={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTitle('Unsave'));
      expect(onUnsaveEmail).toHaveBeenCalledWith('pref-42');
    });

    it('shows both follow-ups and saved emails together', () => {
      render(
        <FollowupPanel
          followups={[makeFollowup()]}
          savedEmails={[makeSaved()]}
          onComplete={vi.fn()}
          onSnooze={vi.fn()}
          onDelete={vi.fn()}
          onUnsaveEmail={vi.fn()}
          onOpenSavedThread={vi.fn()}
        />,
      );

      expect(screen.getByText('Send proposal')).toBeTruthy();
      expect(screen.getByText('Saved emails')).toBeTruthy();
      expect(screen.getByText('Important announcement')).toBeTruthy();
      expect(screen.getByText(/Bob/)).toBeTruthy();
    });
  });
});
