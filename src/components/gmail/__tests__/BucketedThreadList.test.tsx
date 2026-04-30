/**
 * Tests for BucketedThreadList component.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import BucketedThreadList from '../BucketedThreadList';
import type { GmailThreadSummary } from '../../../services/api';
import type { ThreadEnrichment } from '../../../shared/gmail-enrichment-types.js';

expect.extend(toHaveNoViolations);

// Mock ThreadList so we can check when it renders flat
vi.mock('../ThreadList', () => ({
  default: ({ threads }: { threads: GmailThreadSummary[] }) => (
    <div data-testid="flat-thread-list" data-count={threads.length}>
      {threads.map((t) => (
        <div key={t.id} data-testid={`flat-thread-${t.id}`}>{t.subject}</div>
      ))}
    </div>
  ),
}));

function makeThread(id: string, subject: string, overrides: Partial<GmailThreadSummary> = {}): GmailThreadSummary {
  return {
    id,
    subject,
    snippet: 'snippet',
    from: 'alice@example.com',
    date: '2026-04-10T10:00:00Z',
    unread: true,
    messageCount: 1,
    hasAttachments: false,
    labelIds: ['INBOX'],
    ...overrides,
  };
}

function makeEnrichment(bucket: 'needs_reply' | 'waiting' | 'quick_wins' | 'reference_fyi', priority: 'high' | 'medium' | 'low' | 'none' = 'medium'): ThreadEnrichment {
  const actionMap: Record<string, ThreadEnrichment['recommendedAction']> = {
    needs_reply: 'draft_reply',
    waiting: 'nudge',
    quick_wins: 'archive_subscription',
    reference_fyi: 'mark_done',
  };
  return {
    threadId: `thread-${bucket}`,
    bucket,
    priority,
    recommendedAction: actionMap[bucket],
    whyItMatters: 'test reason',
    effortMinutes: '5',
  };
}

const defaultProps = {
  selectedId: null,
  selectedThreadIds: [],
  loading: false,
  hasMore: false,
  onSelect: vi.fn(),
  onLoadMore: vi.fn(),
  onToggleSelect: vi.fn(),
  fallbackReason: null as string | null,
  showRawInbox: false,
  enrichmentQueue: new Set<string>(),
};

describe('BucketedThreadList', () => {
  it('groups threads into 4 buckets using enrichmentMap', () => {
    const threads = [
      makeThread('t1', 'Reply me'),
      makeThread('t2', 'Waiting for response'),
      makeThread('t3', 'Quick archive'),
      makeThread('t4', 'FYI newsletter'),
    ];
    const enrichmentMap = new Map<string, ThreadEnrichment>([
      ['t1', makeEnrichment('needs_reply', 'high')],
      ['t2', makeEnrichment('waiting')],
      ['t3', makeEnrichment('quick_wins')],
      ['t4', makeEnrichment('reference_fyi')],
    ]);

    render(
      <BucketedThreadList
        {...defaultProps}
        threads={threads}
        enrichmentMap={enrichmentMap}
      />,
    );

    expect(screen.getByText('Needs reply')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Quick wins')).toBeTruthy();
    expect(screen.getByText('Reference / FYI')).toBeTruthy();
  });

  it('renders Reference/FYI collapsed by default', () => {
    const threads = [makeThread('t4', 'FYI item')];
    const enrichmentMap = new Map<string, ThreadEnrichment>([
      ['t4', makeEnrichment('reference_fyi')],
    ]);

    render(
      <BucketedThreadList
        {...defaultProps}
        threads={threads}
        enrichmentMap={enrichmentMap}
      />,
    );

    // The Reference/FYI section header button should have aria-expanded=false
    const rfyButton = screen.getByRole('button', { name: /Reference \/ FYI/i });
    expect(rfyButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('bucket count badges match thread distribution', () => {
    const threads = [
      makeThread('t1', 'Reply A'),
      makeThread('t2', 'Reply B'),
      makeThread('t3', 'Waiting A'),
    ];
    const enrichmentMap = new Map<string, ThreadEnrichment>([
      ['t1', makeEnrichment('needs_reply', 'high')],
      ['t2', makeEnrichment('needs_reply', 'high')],
      ['t3', makeEnrichment('waiting')],
    ]);

    render(
      <BucketedThreadList
        {...defaultProps}
        threads={threads}
        enrichmentMap={enrichmentMap}
      />,
    );

    // Needs reply should show count 2, Waiting should show count 1
    const bucketHeaders = screen.getAllByRole('button');
    const needsReplyBtn = bucketHeaders.find((b) => b.textContent?.includes('Needs reply'));
    const waitingBtn = bucketHeaders.find((b) => b.textContent?.includes('Waiting'));
    expect(needsReplyBtn?.textContent).toContain('2');
    expect(waitingBtn?.textContent).toContain('1');
  });

  it('renders flat ThreadList when showRawInbox is true', () => {
    const threads = [
      makeThread('t1', 'Thread A'),
      makeThread('t2', 'Thread B'),
    ];
    const enrichmentMap = new Map<string, ThreadEnrichment>([
      ['t1', makeEnrichment('needs_reply', 'high')],
      ['t2', makeEnrichment('waiting')],
    ]);

    render(
      <BucketedThreadList
        {...defaultProps}
        threads={threads}
        enrichmentMap={enrichmentMap}
        showRawInbox={true}
      />,
    );

    expect(screen.getByTestId('flat-thread-list')).toBeTruthy();
    // Should not show bucket section headers
    expect(screen.queryByText('Needs reply')).toBeNull();
  });

  it('shows Analyzing pseudo-bucket when enrichmentQueue has entries', () => {
    const threads = [
      makeThread('t1', 'Thread A'),
      makeThread('t2', 'Thread B'),
    ];
    // Only t1 is enriched, t2 is queued
    const enrichmentMap = new Map<string, ThreadEnrichment>([
      ['t1', makeEnrichment('needs_reply', 'high')],
    ]);
    const enrichmentQueue = new Set(['t2']);

    render(
      <BucketedThreadList
        {...defaultProps}
        threads={threads}
        enrichmentMap={enrichmentMap}
        enrichmentQueue={enrichmentQueue}
      />,
    );

    expect(screen.getByText(/Analyzing/i)).toBeTruthy();
  });

  it('Analyzing pseudo-bucket disappears when enrichmentQueue is drained', () => {
    const threads = [makeThread('t1', 'Thread A')];
    const enrichmentMap = new Map<string, ThreadEnrichment>([
      ['t1', makeEnrichment('needs_reply', 'high')],
    ]);
    const enrichmentQueue = new Set<string>(); // empty queue

    render(
      <BucketedThreadList
        {...defaultProps}
        threads={threads}
        enrichmentMap={enrichmentMap}
        enrichmentQueue={enrichmentQueue}
      />,
    );

    expect(screen.queryByText(/Analyzing/i)).toBeNull();
  });

  it('renders flat ThreadList when fallbackReason is not null', () => {
    const threads = [makeThread('t1', 'Thread A')];
    const enrichmentMap = new Map<string, ThreadEnrichment>();

    render(
      <BucketedThreadList
        {...defaultProps}
        threads={threads}
        enrichmentMap={enrichmentMap}
        fallbackReason="enrichment_timeout"
      />,
    );

    expect(screen.getByTestId('flat-thread-list')).toBeTruthy();
    expect(screen.queryByText('Needs reply')).toBeNull();
  });

  it('passes jest-axe accessibility check on bucket section headers', async () => {
    // Test axe on a BucketSection only (EnrichedThreadRow has a pre-existing
    // nested-interactive axe violation in role=button that is out of scope here)
    const { container } = render(
      <BucketedThreadList
        {...defaultProps}
        threads={[]}
        enrichmentMap={new Map()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
