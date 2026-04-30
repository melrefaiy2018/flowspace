/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';
import type { ThreadBrief } from '../../../../../shared/gmail-enrichment-types.js';
import type { ThreadType } from '../../../../../lib/gmail-work-registry.js';

expect.extend(toHaveNoViolations);

import FilePane from '../FilePane.js';

function makeWorkItem(type: ThreadType = 'promotional'): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type,
    title: '20% off your next order',
    subtitle: 'store@retailer.com',
    primaryActionLabel: 'Unsubscribe & archive',
    paneKind: 'file',
    enrichment: undefined,
    brief: undefined,
  };
}

function makeThreadDetail(): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: '20% off your next order',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'store@retailer.com',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Get 20% off!',
        bodyType: 'text',
        attachments: [],
      },
    ],
  };
}

function makeBrief(): ThreadBrief {
  return {
    threadId: 'thread-1',
    summary: 'A promotional email from the retailer.',
    recommendedAction: 'Unsubscribe to clean up inbox.',
    contextChips: [],
    firstClassActions: [],
    isFallback: false,
    cachedAt: '2026-04-01T10:00:00Z',
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FilePane', () => {
  it('renders Archive and Save to Drive buttons', () => {
    const item = makeWorkItem('receipt');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={noop}
      />
    );

    expect(screen.getByRole('button', { name: /archive/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /save to drive/i })).toBeTruthy();
  });

  it('shows Unsubscribe button for promotional type', () => {
    const item = makeWorkItem('promotional');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={noop}
      />
    );

    expect(screen.getByRole('button', { name: /unsubscribe/i })).toBeTruthy();
  });

  it('does NOT show Unsubscribe button for notification type', () => {
    const item = makeWorkItem('notification');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={noop}
      />
    );

    expect(screen.queryByRole('button', { name: /unsubscribe/i })).toBeNull();
  });

  it('Archive button fires onDirectAction("archive", threadId) when provided', () => {
    const onDirectAction = vi.fn();
    const item = makeWorkItem('promotional');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={onDirectAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onDirectAction).toHaveBeenCalledWith('archive', 'thread-1');
  });

  it('Archive button is disabled when onDirectAction is undefined', () => {
    const item = makeWorkItem('promotional');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    const archiveBtn = screen.getByRole('button', { name: /^archive$/i });
    expect(archiveBtn).toHaveProperty('disabled', true);
  });

  it('Save to Drive fires onAgentAction("save_to_drive")', () => {
    const onAgentAction = vi.fn();
    const item = makeWorkItem('receipt');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={onAgentAction}
        onDirectAction={noop}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save to drive/i }));
    expect(onAgentAction).toHaveBeenCalledWith('save_to_drive');
  });

  it('Archive button fires both onDirectAction and onComplete when clicked', () => {
    const onDirectAction = vi.fn();
    const onComplete = vi.fn();
    const item = makeWorkItem('promotional');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={onDirectAction}
        onComplete={onComplete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onDirectAction).toHaveBeenCalledWith('archive', 'thread-1');
    expect(onComplete).toHaveBeenCalledWith(expect.stringContaining('Archived'));
  });

  it('Save to Drive does NOT fire onComplete (async chat flow)', () => {
    const onComplete = vi.fn();
    const onAgentAction = vi.fn();
    const item = makeWorkItem('receipt');
    render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={onAgentAction}
        onDirectAction={noop}
        onComplete={onComplete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save to drive/i }));
    expect(onAgentAction).toHaveBeenCalledWith('save_to_drive');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const item = makeWorkItem('promotional');

    const { container } = render(
      <FilePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBrief()}
        briefLoading={false}
        onAgentAction={noop}
        onDirectAction={noop}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
