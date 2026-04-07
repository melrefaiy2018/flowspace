import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type TaskItem, type TaskStatus } from '../services/api';
import { sortTasks } from '../lib/tasks';

type StatusFilter = 'all' | Exclude<TaskStatus, 'completed'>;

export interface TasksPageState {
  tasks: TaskItem[];
  visibleTasks: TaskItem[];
  selectedTask: TaskItem | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  showCompleted: boolean;
  statusFilter: StatusFilter;
  mutatingTaskId: string | null;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setShowCompleted: (value: boolean) => void;
  selectTask: (taskId: string) => void;
  refresh: () => Promise<void>;
  completeTask: (task: TaskItem) => Promise<void>;
  reopenTask: (task: TaskItem) => Promise<void>;
  snoozeTask: (task: TaskItem, due: string) => Promise<void>;
}

function matchesSearch(task: TaskItem, query: string): boolean {
  if (!query.trim()) return true;
  const lower = query.toLowerCase();
  return [
    task.title,
    task.notes,
    task.taskListTitle,
    task.subject,
    task.recipient,
  ].some((value) => value?.toLowerCase().includes(lower));
}

export function useTasksPage(accountKey?: string): TasksPageState {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [mutatingTaskId, setMutatingTaskId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getTasks();
      setTasks(sortTasks(response.tasks));
    } catch (err: any) {
      setError(err.message ?? 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [accountKey, refresh]);

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!showCompleted && task.status === 'completed') return false;
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;
      return matchesSearch(task, searchQuery);
    });
  }, [searchQuery, showCompleted, statusFilter, tasks]);

  useEffect(() => {
    if (visibleTasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId || !visibleTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(visibleTasks[0].id);
    }
  }, [selectedTaskId, visibleTasks]);

  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
  }, []);

  const runMutation = useCallback(async (task: TaskItem, action: () => Promise<unknown>) => {
    setMutatingTaskId(task.id);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err: any) {
      setError(err.message ?? 'Task update failed');
    } finally {
      setMutatingTaskId(null);
    }
  }, [refresh]);

  const completeTask = useCallback(async (task: TaskItem) => {
    await runMutation(task, () => api.completeTask(task.id, task.taskListId));
  }, [runMutation]);

  const reopenTask = useCallback(async (task: TaskItem) => {
    await runMutation(task, () => api.reopenTask(task.id, task.taskListId));
  }, [runMutation]);

  const snoozeTask = useCallback(async (task: TaskItem, due: string) => {
    await runMutation(task, () => api.snoozeTask(task.id, task.taskListId, due));
  }, [runMutation]);

  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId) ?? null;

  return {
    tasks,
    visibleTasks,
    selectedTask,
    loading,
    error,
    searchQuery,
    showCompleted,
    statusFilter,
    mutatingTaskId,
    setSearchQuery,
    setStatusFilter,
    setShowCompleted,
    selectTask,
    refresh,
    completeTask,
    reopenTask,
    snoozeTask,
  };
}
