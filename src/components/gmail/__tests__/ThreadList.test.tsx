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
        enrichmentMap={new Map()}
        fallbackReason={null}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Select Status update' });
    fireEvent.keyDown(checkbox, { key: ' ', code: 'Space' });
    fireEvent.click(checkbox);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggleSelect).toHaveBeenCalledWith('thread-1');
  });

  it('renders enriched row with action chip when enrichmentMap has an entry', () => {
    const onSelect = vi.fn();
    const enrichmentMap = new Map([
      ['thread-1', {
        threadId: 'thread-1',
        priority: 'high' as const,
        recommendedAction: 'draft_reply' as const,
        whyItMatters: 'External reply — you asked on Apr 8.',
        effortMinutes: '5' as const,
        bucket: 'needs_reply' as const,
      }],
    ]);

    render(
      <ThreadList
        threads={[makeThread()]}
        selectedId={null}
        selectedThreadIds={[]}
        loading={false}
        hasMore={false}
        onSelect={onSelect}
        onLoadMore={vi.fn()}
        enrichmentMap={enrichmentMap}
        fallbackReason={null}
      />,
    );

    // Should render the action chip from the enrichment
    expect(screen.getByText('Draft reply')).toBeTruthy();
  });

  it('renders plain row when enrichmentMap is empty (no enrichment)', () => {
    render(
      <ThreadList
        threads={[makeThread()]}
        selectedId={null}
        selectedThreadIds={[]}
        loading={false}
        hasMore={false}
        onSelect={vi.fn()}
        onLoadMore={vi.fn()}
        enrichmentMap={new Map()}
        fallbackReason={null}
      />,
    );

    // Row should render with subject but no action chip
    expect(screen.getByText('Status update')).toBeTruthy();
    expect(screen.queryByText('Draft reply')).toBeNull();
  });
});
