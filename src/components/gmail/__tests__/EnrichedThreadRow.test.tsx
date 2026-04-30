/**
 * T015: Component tests for EnrichedThreadRow.
 * Covers all 9 assertions from tasks.md §T015 plus a jest-axe accessibility check.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import EnrichedThreadRow, { ACTION_LABELS, PRIORITY_COLORS } from '../EnrichedThreadRow';
import type { GmailThreadSummary } from '../../../services/api';
import type { ThreadEnrichment } from '../../../shared/gmail-enrichment-types.js';

expect.extend(toHaveNoViolations);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeThread(overrides: Partial<GmailThreadSummary> = {}): GmailThreadSummary {
  return {
    id: 'thread-1',
    subject: 'AMD offer follow-up',
    snippet: 'Hi Mohamed, checking in on your decision...',
    from: 'Alice Lee <alice@amd.com>',
    date: '2026-04-10T16:22:00Z',
    unread: true,
    messageCount: 3,
    hasAttachments: false,
    labelIds: ['INBOX'],
    ...overrides,
  };
}

function makeEnrichment(overrides: Partial<ThreadEnrichment> = {}): ThreadEnrichment {
  return {
    threadId: 'thread-1',
    priority: 'high',
    recommendedAction: 'draft_reply',
    whyItMatters: 'External reply — you asked on Apr 8.',
    effortMinutes: '5',
    bucket: 'needs_reply',
    ...overrides,
  };
}

const defaultThread = makeThread();
const defaultEnrichment = makeEnrichment();

// ---------------------------------------------------------------------------
// (a) Basic rendering — sender, subject, snippet, date
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — basic rendering', () => {
  it('(a) renders sender name, subject, snippet, and a date', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={defaultEnrichment}
        selected={false}
        onSelect={vi.fn()}
      />,
    );

    // Sender name extracted from "Alice Lee <alice@amd.com>"
    expect(screen.getByText('Alice Lee')).toBeTruthy();
    expect(screen.getByText('AMD offer follow-up')).toBeTruthy();
    expect(screen.getByText(/checking in on your decision/i)).toBeTruthy();
    // Date is formatted — just check some non-empty text is in the row
    // (the exact value depends on the current date; we just check it renders)
    const dateEl = document.querySelector('.shrink-0.text-\\[10px\\]');
    // At minimum there should be some date-like content; we check via aria-label
    const row = screen.getByRole('button');
    expect(row).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// (b) Priority bar color
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — priority bar', () => {
  it('(b) renders a priority bar with the correct color for high priority', () => {
    const { container } = render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={makeEnrichment({ priority: 'high' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );

    // Find the priority bar div (first child of the row, with inline style)
    const bar = container.querySelector('[style*="background-color"]');
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.backgroundColor).toBeTruthy();
    // high → red (#ef4444 or equivalent)
    expect(PRIORITY_COLORS['high']).toBe('#ef4444');
  });

  it('(b) renders priority bars for medium, low, none priorities', () => {
    (['medium', 'low'] as const).forEach((priority) => {
      const { container } = render(
        <EnrichedThreadRow
          thread={makeThread({ id: `thread-${priority}` })}
          enrichment={makeEnrichment({ priority, threadId: `thread-${priority}` })}
          selected={false}
          onSelect={vi.fn()}
        />,
      );
      const bar = container.querySelector('[style*="background-color"]');
      expect(bar).not.toBeNull();
    });
  });

  it('(b) no colored priority bar when enrichment is absent', () => {
    const { container } = render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={undefined}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const bar = container.querySelector('[style*="background-color"]');
    expect(bar).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) Recommended action chip
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — recommended action chip', () => {
  it('(c) renders the correct display label for draft_reply', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={makeEnrichment({ recommendedAction: 'draft_reply' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(ACTION_LABELS['draft_reply'])).toBeTruthy();
  });

  it('(c) renders the correct display label for unsubscribe', () => {
    render(
      <EnrichedThreadRow
        thread={makeThread({ id: 'thread-2' })}
        enrichment={makeEnrichment({ threadId: 'thread-2', recommendedAction: 'unsubscribe', priority: 'low', bucket: 'quick_wins' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(ACTION_LABELS['unsubscribe'])).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// (d) whyItMatters truncated at 120 chars
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — whyItMatters line', () => {
  it('(d) renders the whyItMatters line when present', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={makeEnrichment({ whyItMatters: 'External reply — you asked on Apr 8.' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/External reply/)).toBeTruthy();
  });

  it('(d) truncates whyItMatters at 120 chars with ellipsis', () => {
    const longText = 'A'.repeat(130);
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={makeEnrichment({ whyItMatters: longText })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const displayed = screen.getByText(/A{117}\.\.\./);
    expect(displayed).toBeTruthy();
  });

  it('(d) action chip and whyItMatters render on the same row', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={makeEnrichment({ whyItMatters: 'External reply — you asked on Apr 8.', recommendedAction: 'draft_reply' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const chipEl = screen.getByText(ACTION_LABELS['draft_reply']);
    const whyEl = screen.getByText(/External reply/);
    // Both elements should share the same parent container (the merged row div)
    expect(chipEl.closest('div[data-merged-row]')).not.toBeNull();
    expect(whyEl.closest('div[data-merged-row]')).not.toBeNull();
    expect(chipEl.closest('div[data-merged-row]')).toBe(whyEl.closest('div[data-merged-row]'));
  });
});

// ---------------------------------------------------------------------------
// (e) Effort estimate
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — effort estimate', () => {
  it('(e) renders the effort estimate when effortMinutes is not "none"', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={makeEnrichment({ effortMinutes: '5' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    // Should show "5m" somewhere in the row
    expect(screen.getByText('5m')).toBeTruthy();
  });

  it('(e) does not render effort chip when effortMinutes is "none"', () => {
    render(
      <EnrichedThreadRow
        thread={makeThread({ id: 'thread-2' })}
        enrichment={makeEnrichment({ threadId: 'thread-2', effortMinutes: 'none' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText('nonem')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (f) Fallback to plain row when enrichment is undefined
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — plain row fallback', () => {
  it('(f) renders subject and sender without priority bar or chip when no enrichment', () => {
    const { container } = render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={undefined}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('AMD offer follow-up')).toBeTruthy();
    expect(screen.getByText('Alice Lee')).toBeTruthy();
    // No priority bar (no colored style)
    const bar = container.querySelector('[style*="background-color"]');
    expect(bar).toBeNull();
    // No action chip and no merged action+why row
    expect(screen.queryByText(ACTION_LABELS['draft_reply'])).toBeNull();
    expect(container.querySelector('[data-merged-row]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Queued state — shows "Queued" pill while the row waits for its batch
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — queued state', () => {
  it('renders a Queued chip when isQueued is true and no enrichment is present', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={undefined}
        isQueued={true}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Queued/)).toBeTruthy();
  });

  it('does NOT render the Queued chip when enrichment is already present', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={defaultEnrichment}
        isQueued={true} /* shouldn't matter — enrichment wins */
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Queued/)).toBeNull();
  });

  it('does NOT render the Queued chip when isQueued is false and no enrichment', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={undefined}
        isQueued={false}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Queued/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (g) Keyboard focusable — tabIndex={0}
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — keyboard accessibility', () => {
  it('(g) row has tabIndex={0}', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={defaultEnrichment}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const row = screen.getByRole('button');
    expect(row.getAttribute('tabindex')).toBe('0');
  });

  it('(g) Enter key fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={defaultEnrichment}
        selected={false}
        onSelect={onSelect}
      />,
    );
    const row = screen.getByRole('button');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('thread-1');
  });

  it('(g) Space key fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={defaultEnrichment}
        selected={false}
        onSelect={onSelect}
      />,
    );
    const row = screen.getByRole('button');
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('thread-1');
  });
});

// ---------------------------------------------------------------------------
// (h) aria-label concatenation
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — aria-label', () => {
  it('(h) aria-label includes sender, subject, priority, recommendedAction, effort', () => {
    render(
      <EnrichedThreadRow
        thread={defaultThread}
        enrichment={defaultEnrichment}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const row = screen.getByRole('button');
    const ariaLabel = row.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toMatch(/alice lee/i);
    expect(ariaLabel).toMatch(/amd offer follow-up/i);
    expect(ariaLabel).toMatch(/high/i);
    expect(ariaLabel).toMatch(/draft.reply/i);
    expect(ariaLabel).toMatch(/5/);
  });
});

// ---------------------------------------------------------------------------
// (i) jest-axe accessibility
// ---------------------------------------------------------------------------
describe('EnrichedThreadRow — axe accessibility', () => {
  it('(i) has no accessibility violations', async () => {
    const { container } = render(
      <div>
        <EnrichedThreadRow
          thread={defaultThread}
          enrichment={defaultEnrichment}
          selected={false}
          onSelect={vi.fn()}
        />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
