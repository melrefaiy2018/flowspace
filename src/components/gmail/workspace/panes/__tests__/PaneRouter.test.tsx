/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkItem } from '../../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../../services/api.js';
import type { PaneKind } from '../../../../../lib/gmail-work-registry.js';

// Mock each pane with a data-testid so PaneRouter.test can verify dispatch
vi.mock('../DraftPane.js', () => ({
  default: () => <div data-testid="pane-draft">DraftPane</div>,
}));
vi.mock('../ReviewPane.js', () => ({
  default: () => <div data-testid="pane-review">ReviewPane</div>,
}));
vi.mock('../DiscussPane.js', () => ({
  default: () => <div data-testid="pane-discuss">DiscussPane</div>,
}));
vi.mock('../SchedulePane.js', () => ({
  default: () => <div data-testid="pane-schedule">SchedulePane</div>,
}));
vi.mock('../FilePane.js', () => ({
  default: () => <div data-testid="pane-file">FilePane</div>,
}));
vi.mock('../TasksPane.js', () => ({
  default: () => <div data-testid="pane-tasks">TasksPane</div>,
}));
vi.mock('../SummaryPane.js', () => ({
  default: () => <div data-testid="pane-summary">SummaryPane</div>,
}));

import PaneRouter from '../PaneRouter.js';

function makeWorkItem(paneKind: PaneKind): WorkItem {
  return {
    id: 'thread-1',
    source: { kind: 'gmail', threadId: 'thread-1' },
    type: 'personal_reply_needed',
    title: 'Test thread',
    subtitle: 'Test sender',
    primaryActionLabel: 'Action',
    paneKind,
    enrichment: undefined,
    brief: undefined,
  };
}

function makeThreadDetail(): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Test thread',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'sender@example.com',
        to: 'me@example.com',
        cc: '',
        date: '2026-04-01T10:00:00Z',
        body: 'Test body.',
        bodyType: 'text',
        attachments: [],
      },
    ],
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaneRouter', () => {
  it('dispatches to DraftPane when paneKind is draft', () => {
    const item = makeWorkItem('draft');
    render(
      <PaneRouter
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );
    expect(screen.getByTestId('pane-draft')).toBeTruthy();
    expect(screen.queryByTestId('pane-review')).toBeNull();
    expect(screen.queryByTestId('pane-discuss')).toBeNull();
  });

  it('dispatches to ReviewPane when paneKind is review', () => {
    const item = makeWorkItem('review');
    render(
      <PaneRouter
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );
    expect(screen.getByTestId('pane-review')).toBeTruthy();
    expect(screen.queryByTestId('pane-draft')).toBeNull();
  });

  it('dispatches to DiscussPane when paneKind is discuss', () => {
    const item = makeWorkItem('discuss');
    render(
      <PaneRouter
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );
    expect(screen.getByTestId('pane-discuss')).toBeTruthy();
    expect(screen.queryByTestId('pane-draft')).toBeNull();
  });

  it('dispatches to SchedulePane when paneKind is schedule', () => {
    const item = makeWorkItem('schedule');
    render(
      <PaneRouter
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );
    expect(screen.getByTestId('pane-schedule')).toBeTruthy();
    expect(screen.queryByTestId('pane-discuss')).toBeNull();
  });

  it('dispatches to FilePane when paneKind is file', () => {
    const item = makeWorkItem('file');
    render(
      <PaneRouter
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );
    expect(screen.getByTestId('pane-file')).toBeTruthy();
    expect(screen.queryByTestId('pane-discuss')).toBeNull();
  });

  it('dispatches to TasksPane when paneKind is tasks', () => {
    const item = makeWorkItem('tasks');
    render(
      <PaneRouter
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );
    expect(screen.getByTestId('pane-tasks')).toBeTruthy();
    expect(screen.queryByTestId('pane-discuss')).toBeNull();
  });

  it('dispatches to SummaryPane when paneKind is summary', () => {
    const item = makeWorkItem('summary');
    render(
      <PaneRouter
        item={item}
        threadDetail={makeThreadDetail()}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
      />
    );
    expect(screen.getByTestId('pane-summary')).toBeTruthy();
    expect(screen.queryByTestId('pane-discuss')).toBeNull();
  });

  it('passes all props through to the rendered pane', () => {
    const item = makeWorkItem('discuss');
    const threadDetail = makeThreadDetail();

    // DiscussPane mock renders — just verify the router renders it without error
    render(
      <PaneRouter
        item={item}
        threadDetail={threadDetail}
        brief={null}
        briefLoading={false}
        onAgentAction={noop}
        onComplete={(s) => { void s; }}
      />
    );
    expect(screen.getByTestId('pane-discuss')).toBeTruthy();
  });
});
