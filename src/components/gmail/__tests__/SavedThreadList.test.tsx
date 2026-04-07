/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SavedThreadList from '../SavedThreadList';
import type { SavedEmail } from '../../../services/api';

function makeSaved(overrides: Partial<SavedEmail> = {}): SavedEmail {
  return {
    id: 'pref-1',
    thread_id: 'thread-abc',
    subject: 'Important meeting notes',
    sender: 'Alice Smith',
    saved_at: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    label: 'important',
    ...overrides,
  };
}

describe('SavedThreadList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no saved emails', () => {
    render(
      <SavedThreadList
        savedEmails={[]}
        onSelectThread={vi.fn()}
        onUnsave={vi.fn()}
      />,
    );

    expect(screen.getByText(/no labeled emails/i)).toBeTruthy();
  });

  it('renders a list of saved email cards grouped by label', () => {
    const emails = [
      makeSaved({ id: 'p1', subject: 'Meeting agenda', sender: 'Bob', label: 'important' }),
      makeSaved({ id: 'p2', subject: 'Project update', sender: 'Carol', label: 'not_important' }),
    ];

    render(
      <SavedThreadList
        savedEmails={emails}
        onSelectThread={vi.fn()}
        onUnsave={vi.fn()}
      />,
    );

    expect(screen.getByText('Meeting agenda')).toBeTruthy();
    expect(screen.getByText('Project update')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Carol')).toBeTruthy();
    // Category headers
    expect(screen.getByText('Important')).toBeTruthy();
    expect(screen.getByText('Not important')).toBeTruthy();
  });

  it('only shows categories that have items', () => {
    const emails = [
      makeSaved({ id: 'p1', subject: 'Meeting agenda', sender: 'Bob', label: 'important' }),
    ];

    render(
      <SavedThreadList
        savedEmails={emails}
        onSelectThread={vi.fn()}
        onUnsave={vi.fn()}
      />,
    );

    expect(screen.getByText('Important')).toBeTruthy();
    expect(screen.queryByText('Not important')).toBeNull();
  });

  it('calls onSelectThread with thread_id when card is clicked', () => {
    const onSelectThread = vi.fn();
    const email = makeSaved({ thread_id: 'thread-xyz' });

    render(
      <SavedThreadList
        savedEmails={[email]}
        onSelectThread={onSelectThread}
        onUnsave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Important meeting notes'));
    expect(onSelectThread).toHaveBeenCalledWith('thread-xyz');
  });

  it('calls onUnsave with preference id when remove button is clicked', () => {
    const onUnsave = vi.fn();
    const email = makeSaved({ id: 'pref-99' });

    render(
      <SavedThreadList
        savedEmails={[email]}
        onSelectThread={vi.fn()}
        onUnsave={onUnsave}
      />,
    );

    fireEvent.click(screen.getByTitle('Remove'));
    expect(onUnsave).toHaveBeenCalledWith('pref-99');
  });

  it('highlights the selected thread', () => {
    const emails = [
      makeSaved({ id: 'p1', thread_id: 'thread-1', subject: 'First', label: 'important' }),
      makeSaved({ id: 'p2', thread_id: 'thread-2', subject: 'Second', label: 'important' }),
    ];

    const { container } = render(
      <SavedThreadList
        savedEmails={emails}
        selectedThreadId="thread-1"
        onSelectThread={vi.fn()}
        onUnsave={vi.fn()}
      />,
    );

    const cards = container.querySelectorAll('[data-testid="saved-email-card"]');
    expect(cards[0].getAttribute('data-selected')).toBe('true');
    expect(cards[1].getAttribute('data-selected')).toBe('false');
  });
});
