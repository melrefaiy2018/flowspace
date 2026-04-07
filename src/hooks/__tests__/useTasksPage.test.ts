/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTasksPage } from '../useTasksPage';
import { api, type TaskItem } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    getTasks: vi.fn(),
    completeTask: vi.fn(),
    reopenTask: vi.fn(),
    snoozeTask: vi.fn(),
  },
}));

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
    title: 'Follow up with Jane',
    notes: 'Send the revised plan',
    due: '2026-03-14T00:00:00.000Z',
    completedAt: null,
    status: 'upcoming',
    taskListId: 'list-1',
    taskListTitle: 'My Tasks',
    source: 'flowspace_task',
    ...overrides,
  };
}

describe('useTasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTasks).mockResolvedValue({
      tasks: [
        makeTask({ id: 'task-overdue', title: 'Old follow-up', due: '2026-03-10T00:00:00.000Z', status: 'overdue' }),
        makeTask({ id: 'task-1' }),
        makeTask({ id: 'task-done', title: 'Closed loop', status: 'completed', completedAt: '2026-03-12T00:00:00.000Z', due: '2026-03-11T00:00:00.000Z' }),
      ],
    });
    vi.mocked(api.completeTask).mockResolvedValue({ success: true });
    vi.mocked(api.reopenTask).mockResolvedValue({ success: true });
    vi.mocked(api.snoozeTask).mockResolvedValue({ success: true });
  });

  it('loads tasks and auto-selects the first visible task', async () => {
    const { result } = renderHook(() => useTasksPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.visibleTasks.map((task) => task.id)).toEqual(['task-overdue', 'task-1']);
    expect(result.current.selectedTask?.id).toBe('task-overdue');
  });

  it('filters tasks by search and completed toggle', async () => {
    const { result } = renderHook(() => useTasksPage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSearchQuery('Jane');
    });
    expect(result.current.visibleTasks.map((task) => task.id)).toEqual(['task-1']);

    act(() => {
      result.current.setShowCompleted(true);
      result.current.setSearchQuery('Closed');
    });
    expect(result.current.visibleTasks.map((task) => task.id)).toEqual(['task-done']);
  });

  it('filters tasks by due-state chip', async () => {
    const { result } = renderHook(() => useTasksPage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setStatusFilter('overdue');
    });

    expect(result.current.visibleTasks.map((task) => task.id)).toEqual(['task-overdue']);
  });

  it('runs task mutations against the selected task list id and refreshes', async () => {
    const { result } = renderHook(() => useTasksPage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.completeTask(result.current.visibleTasks[0]);
    });
    expect(api.completeTask).toHaveBeenCalledWith('task-overdue', 'list-1');

    await act(async () => {
      await result.current.reopenTask(makeTask({ id: 'task-done', status: 'completed' }));
    });
    expect(api.reopenTask).toHaveBeenCalledWith('task-done', 'list-1');

    await act(async () => {
      await result.current.snoozeTask(result.current.visibleTasks[0], '2026-03-20T00:00:00.000Z');
    });
    expect(api.snoozeTask).toHaveBeenCalledWith('task-overdue', 'list-1', '2026-03-20T00:00:00.000Z');
    expect(api.getTasks).toHaveBeenCalledTimes(4);
  });
});
