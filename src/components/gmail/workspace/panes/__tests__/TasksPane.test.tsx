/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';
import type { ThreadBrief } from '../../../../../shared/gmail-enrichment-types.js';

expect.extend(toHaveNoViolations);

import TasksPane from '../TasksPane.js';

function makeWorkItem(): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'personal_reply_needed',
    title: 'Project update needed',
    subtitle: 'Carol Jones',
    primaryActionLabel: 'Create task',
    paneKind: 'tasks',
    enrichment: undefined,
    brief: undefined,
  };
}

function makeThreadDetail(): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Project update needed',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Carol Jones <carol@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Please review the project by Friday.',
        bodyType: 'text',
        attachments: [],
      },
    ],
  };
}

function makeBriefWithAction(recommendedAction = 'Review project by Friday'): ThreadBrief {
  return {
    threadId: 'thread-1',
    summary: 'Carol is requesting a project review by Friday.',
    recommendedAction,
    contextChips: [],
    firstClassActions: [{ kind: 'draft_reply' }],
    isFallback: false,
    cachedAt: '2026-04-01T10:00:00Z',
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TasksPane', () => {
  it('Extract button fires onAgentAction("create_task")', () => {
    const onAgentAction = vi.fn();
    const item = makeWorkItem();
    render(
      <TasksPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={onAgentAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /extract tasks/i }));
    expect(onAgentAction).toHaveBeenCalledWith('create_task');
  });

  it('shows recommended action suggestion above button when brief has recommendedAction', () => {
    const item = makeWorkItem();
    render(
      <TasksPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBriefWithAction('Review project by Friday')}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.getByText(/Suggested:/i)).toBeTruthy();
    expect(screen.getByText(/Review project by Friday/i)).toBeTruthy();
  });

  it('does not show suggestion when brief is null', () => {
    const item = makeWorkItem();
    render(
      <TasksPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    expect(screen.queryByText(/Suggested:/i)).toBeNull();
    // Extract button is still shown
    expect(screen.getByRole('button', { name: /extract tasks/i })).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const item = makeWorkItem();

    const { container } = render(
      <TasksPane
        item={item}
        threadDetail={makeThreadDetail()}
        brief={makeBriefWithAction('Review project by Friday')}
        briefLoading={false}
        onAgentAction={noop}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
