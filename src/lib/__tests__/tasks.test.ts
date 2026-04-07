import { describe, expect, it } from 'vitest';
import {
  buildFlowSpaceTaskNotes,
  classifyTaskStatus,
  formatTaskDueDate,
  normalizeGoogleTask,
  parseTaskNotes,
  sortTasks,
} from '../tasks';

describe('parseTaskNotes', () => {
  it('parses follow-up JSON notes and hides metadata from display notes', () => {
    const result = parseTaskNotes(JSON.stringify({
      source: 'flowspace-followup',
      thread_id: 'thread-123',
      recipient: 'Jane',
      subject: 'Quarterly update',
    }));

    expect(result.displayNotes).toBe('');
    expect(result.metadata?.source).toBe('flowspace-followup');
    expect(result.metadata?.thread_id).toBe('thread-123');
  });

  it('parses FlowSpace task footer metadata and keeps user notes visible', () => {
    const raw = buildFlowSpaceTaskNotes('Send the revised deck.', { thread_id: 'thread-1' });
    const result = parseTaskNotes(raw);

    expect(result.displayNotes).toBe('Send the revised deck.');
    expect(result.metadata?.source).toBe('flowspace-task');
    expect(result.metadata?.thread_id).toBe('thread-1');
  });

  it('treats plain notes as user-visible notes', () => {
    const result = parseTaskNotes('Normal task notes');
    expect(result.displayNotes).toBe('Normal task notes');
    expect(result.metadata).toBeNull();
  });
});

describe('classifyTaskStatus', () => {
  const now = new Date('2026-03-13T12:00:00.000Z');

  it('classifies overdue, due today, upcoming, and no due date', () => {
    expect(classifyTaskStatus({ due: '2026-03-11T00:00:00.000Z' }, now)).toEqual({ status: 'overdue', daysOverdue: 2 });
    expect(classifyTaskStatus({ due: '2026-03-13T18:00:00.000Z' }, now)).toEqual({ status: 'due_today' });
    expect(classifyTaskStatus({ due: '2026-03-14T00:00:00.000Z' }, now)).toEqual({ status: 'upcoming' });
    expect(classifyTaskStatus({ due: null }, now)).toEqual({ status: 'no_due_date' });
  });

  it('prefers completed state even when due exists', () => {
    expect(classifyTaskStatus({ due: '2026-03-10T00:00:00.000Z', completed: '2026-03-12T00:00:00.000Z' }, now)).toEqual({ status: 'completed' });
  });

  it('treats Google Tasks due values as date-only instead of local timestamps', () => {
    const chicagoEvening = new Date('2026-03-13T20:00:00.000-05:00');
    expect(classifyTaskStatus({ due: '2026-03-14T00:00:00.000Z' }, chicagoEvening)).toEqual({ status: 'upcoming' });
    expect(formatTaskDueDate('2026-03-14T00:00:00.000Z')).toContain('Mar 14');
  });
});

describe('normalizeGoogleTask', () => {
  it('normalizes follow-up metadata into a task item', () => {
    const task = normalizeGoogleTask({
      id: 'task-1',
      title: 'Send report → Jane',
      notes: JSON.stringify({
        source: 'flowspace-followup',
        thread_id: 'thread-1',
        recipient: 'Jane',
        subject: 'Need report',
      }),
      due: '2026-03-12T00:00:00.000Z',
      selfLink: 'https://tasks.example/task-1',
    }, {
      taskListId: 'list-1',
      taskListTitle: 'FlowSpace Follow-ups',
      now: new Date('2026-03-13T12:00:00.000Z'),
    });

    expect(task.source).toBe('flowspace_followup');
    expect(task.threadId).toBe('thread-1');
    expect(task.status).toBe('overdue');
    expect(task.taskListTitle).toBe('FlowSpace Follow-ups');
  });
});

describe('sortTasks', () => {
  it('sorts by status priority and due date', () => {
    const result = sortTasks([
      normalizeGoogleTask({ id: '3', title: 'Later', due: '2026-03-20T00:00:00.000Z' }, { taskListId: 'l', taskListTitle: 'Default', now: new Date('2026-03-13T12:00:00.000Z') }),
      normalizeGoogleTask({ id: '1', title: 'Old', due: '2026-03-10T00:00:00.000Z' }, { taskListId: 'l', taskListTitle: 'Default', now: new Date('2026-03-13T12:00:00.000Z') }),
      normalizeGoogleTask({ id: '2', title: 'Today', due: '2026-03-13T18:00:00.000Z' }, { taskListId: 'l', taskListTitle: 'Default', now: new Date('2026-03-13T12:00:00.000Z') }),
    ]);

    expect(result.map((item) => item.id)).toEqual(['1', '2', '3']);
  });
});
