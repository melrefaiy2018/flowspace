/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ThreadList from '../ThreadList';
import type { GmailThreadSummary } from '../../../services/api';

function makeThread(overrides: Partial<GmailThreadSummary> = {}): GmailThreadSummary {
  return {
    id: 'thread-1',
    subject: 'Status update',
    snippet: 'Quick note',
    from: 'Alice <alice@example.com>',
    date: '2026-03-13T10:00:00Z',
    unread: true,
    messageCount: 1,
    hasAttachments: false,
    labelIds: ['INBOX'],
    ...overrides,
  };
}

describe('ThreadList', () => {
  it('does not open the thread when the checkbox handles Space', () => {
    const onSelect = vi.fn();
    const onToggleSelect = vi.fn();

    render(
      <ThreadList
        threads={[makeThread()]}
        selectedId={null}
        selectedThreadIds={[]}
        loading={false}
        hasMore={false}
        onSelect={onSelect}
        onLoadMore={vi.fn()}
        onToggleSelect={onToggleSelect}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Select Status update' });
    fireEvent.keyDown(checkbox, { key: ' ', code: 'Space' });
    fireEvent.click(checkbox);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggleSelect).toHaveBeenCalledWith('thread-1');
  });
});
