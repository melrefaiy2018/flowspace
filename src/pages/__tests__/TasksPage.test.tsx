/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TasksPage from '../TasksPage';

const tasksState = {
  tasks: [],
  visibleTasks: [
    {
      id: 'task-1',
      title: 'Review security alert',
      notes: 'Use the notes field',
      due: '2026-03-14T00:00:00.000Z',
      completedAt: null,
      status: 'upcoming' as const,
      taskListId: 'list-1',
      taskListTitle: 'My Tasks',
      source: 'flowspace_task' as const,
      threadId: 'thread-123',
      recipient: 'Security team',
      subject: 'Review the alert',
    },
    {
      id: 'task-2',
      title: 'Send handoff',
      notes: '',
      due: '2026-03-10T00:00:00.000Z',
      completedAt: null,
      status: 'overdue' as const,
      taskListId: 'list-1',
      taskListTitle: 'FlowSpace Follow-ups',
      source: 'flowspace_followup' as const,
      recipient: 'Jane',
      subject: 'Handoff request',
    },
  ],
  selectedTask: null as any,
  loading: false,
  error: null as string | null,
  searchQuery: '',
  showCompleted: false,
  statusFilter: 'all' as const,
  mutatingTaskId: null as string | null,
  setSearchQuery: vi.fn(),
  setStatusFilter: vi.fn(),
  setShowCompleted: vi.fn(),
  selectTask: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  completeTask: vi.fn().mockResolvedValue(undefined),
  reopenTask: vi.fn().mockResolvedValue(undefined),
  snoozeTask: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../hooks/useTasksPage', () => ({
  useTasksPage: () => tasksState,
}));


describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksState.selectedTask = tasksState.visibleTasks[0];
    tasksState.statusFilter = 'all';
    tasksState.showCompleted = false;
  });

  it('renders grouped tasks and selected task details', () => {
    render(<TasksPage />);

    expect(screen.getByText('Task Board')).toBeTruthy();
    expect(screen.getAllByText('Review security alert')).toHaveLength(2);
    expect(screen.getByText('Send handoff')).toBeTruthy();
    expect(screen.getByRole('button', { name: /mark complete/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open in gmail/i })).toBeTruthy();
  });

  it('wires search, filter, and selection events', () => {
    render(<TasksPage />);

    fireEvent.change(screen.getByPlaceholderText('Search tasks, notes, people, lists'), {
      target: { value: 'security' },
    });
    expect(tasksState.setSearchQuery).toHaveBeenCalledWith('security');

    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    expect(tasksState.setStatusFilter).toHaveBeenCalledWith('overdue');

    fireEvent.click(screen.getByRole('button', { name: /review security alert/i }));
    expect(tasksState.selectTask).toHaveBeenCalledWith('task-1');
  });

  it('fires snooze and complete actions from the detail panel', () => {
    render(<TasksPage />);

    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    expect(tasksState.completeTask).toHaveBeenCalledWith(tasksState.selectedTask);

    fireEvent.click(screen.getByRole('button', { name: /tomorrow/i }));
    expect(tasksState.snoozeTask).toHaveBeenCalledTimes(1);
  });
});
