/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';
import type { ThreadBrief, ContextChip } from '../../../../../shared/gmail-enrichment-types.js';

expect.extend(toHaveNoViolations);

import SchedulePane from '../SchedulePane.js';

function makeWorkItem(): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'meeting_request',
    title: 'Can we chat next week?',
    subtitle: 'Bob Smith',
    primaryActionLabel: 'Pick times',
    paneKind: 'schedule',
    enrichment: undefined,
    brief: undefined,
  };
}

function makeThreadDetail(): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Can we chat next week?',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Bob Smith <bob@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Are you free next week for a quick call?',
        bodyType: 'text',
        attachments: [],
      },
    ],
  };
}

function makeBriefWithChip(chips: ContextChip[] = []): ThreadBrief {
  return {
    threadId: 'thread-1',
    summary: 'Bob wants to schedule a call.',
    recommendedAction: 'Pick times and draft a reply.',
    contextChips: chips,
    firstClassActions: [{ kind: 'pick_times' }],
    isFallback: false,
    cachedAt: '2026-04-01T10:00:00Z',
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SchedulePane', () => {
  it('renders the slot picker placeholder and primary button', () => {
    const item = makeWorkItem();
    render(
      <SchedulePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    // Should show a placeholder indicating slot picker is coming
    expect(screen.getByTestId('schedule-pane-slot-placeholder')).toBeTruthy();

    // Should show primary action button
    expect(screen.getByRole('button', { name: /open in chat to pick times/i })).toBeTruthy();
  });

  it('primary button fires onAgentAction("pick_times")', () => {
    const onAgentAction = vi.fn();
    const item = makeWorkItem();
    render(
      <SchedulePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={onAgentAction}
      />
    );

    const btn = screen.getByRole('button', { name: /open in chat to pick times/i });
    fireEvent.click(btn);

    expect(onAgentAction).toHaveBeenCalledWith('pick_times');
  });

  it('renders thread_age or last_message_age context chip at the top when present in brief', () => {
    const item = makeWorkItem();
    const chips: ContextChip[] = [
      { label: '3 days old', kind: 'thread_age' },
    ];
    render(
      <SchedulePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBriefWithChip(chips)}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.getByText(/Thread context:/i)).toBeTruthy();
    expect(screen.getByText(/3 days old/i)).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const item = makeWorkItem();

    const { container } = render(
      <SchedulePane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
