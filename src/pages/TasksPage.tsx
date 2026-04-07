import { useMemo } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useTasksPage } from '../hooks/useTasksPage';
import type { TaskItem, TaskSource, TaskStatus } from '../services/api';
import { formatTaskDueDate } from '../lib/tasks';
import { gmailThreadUrl, googleTasksUrl } from '../lib/google-account-links';

const statusLabels: Record<Exclude<TaskStatus, 'completed'>, string> = {
  overdue: 'Overdue',
  due_today: 'Today',
  upcoming: 'Upcoming',
  no_due_date: 'No due date',
};

const sourceStyles: Record<TaskSource, { label: string; className: string }> = {
  flowspace_followup: {
    label: 'Follow-up',
    className: 'border-[var(--blue-border)] bg-[var(--blue-dim)]/70 text-[var(--blue)]',
  },
  flowspace_task: {
    label: 'FlowSpace',
    className: 'border-[var(--accent-border)] bg-[var(--accent-dim)]/70 text-[var(--accent)]',
  },
  google_task: {
    label: 'Google Tasks',
    className: 'border-[var(--border2)] bg-[var(--surface2)] text-[var(--text-dim)]',
  },
};

function formatDueDate(value: string | null): string {
  return formatTaskDueDate(value);
}

function taskStatusLabel(task: TaskItem): string {
  if (task.status === 'completed') return 'Completed';
  if (task.status === 'overdue') return `${task.daysOverdue ?? 1}d overdue`;
  if (task.status === 'due_today') return 'Due today';
  if (task.status === 'upcoming') return `Due ${formatDueDate(task.due)}`;
  return 'No due date';
}

function statusAccent(task: TaskItem): string {
  switch (task.status) {
    case 'overdue':
      return 'border-[var(--error)]/60 bg-[var(--error-dim)]/40 text-[var(--error)]';
    case 'due_today':
      return 'border-[var(--warn)]/60 bg-[var(--warn-dim)]/50 text-[var(--warn)]';
    case 'completed':
      return 'border-[var(--accent-border)]/70 bg-[var(--accent-dim)]/60 text-[var(--accent)]';
    default:
      return 'border-[var(--border2)] bg-[var(--surface2)] text-[var(--text-dim)]';
  }
}

function dueShortcut(days: number): string {
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function TaskRow({
  task,
  selected,
  onClick,
}: {
  task: TaskItem;
  selected: boolean;
  onClick: () => void;
}) {
  const source = sourceStyles[task.source];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full rounded-[16px] border p-4 text-left transition-all cursor-pointer ${
        selected
          ? 'border-[var(--accent)]/40 bg-[linear-gradient(180deg,rgba(34,197,94,0.08),rgba(31,32,35,0.98))] shadow-[0_0_0_1px_rgba(34,197,94,0.08)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border2)] hover:bg-[var(--surface2)]'
      }`}
    >
      <div
        className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${
          task.status === 'overdue'
            ? 'bg-[var(--error)]'
            : task.status === 'due_today'
              ? 'bg-[var(--warn)]'
              : task.source !== 'google_task'
                ? 'bg-[var(--accent)]'
                : 'bg-[var(--border2)]'
        }`}
      />
      <div className="ml-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[var(--text)] leading-snug">{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${source.className}`}>
              {source.label}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusAccent(task)}`}>
              {taskStatusLabel(task)}
            </span>
          </div>
          <div className="mt-2 text-[12px] text-[var(--text-faint)]">
            {task.taskListTitle}
            {task.recipient ? ` • ${task.recipient}` : ''}
          </div>
          {task.notes && (
            <div className="mt-2 line-clamp-2 text-[12px] text-[var(--text-dim)]">
              {task.notes}
            </div>
          )}
        </div>
        <div className="pt-0.5">
          {task.status === 'completed' ? (
            <CheckCircle2 size={16} className="text-[var(--accent)]" />
          ) : (
            <Circle size={16} className="text-[var(--text-faint)] group-hover:text-[var(--text-dim)]" />
          )}
        </div>
      </div>
    </button>
  );
}

export default function TasksPage({ accountEmail, accountKey }: { accountEmail?: string | null; accountKey?: string }) {
  const tasks = useTasksPage(accountKey);

  const groupedTasks = useMemo(() => {
    return {
      overdue: tasks.visibleTasks.filter((task) => task.status === 'overdue'),
      due_today: tasks.visibleTasks.filter((task) => task.status === 'due_today'),
      upcoming: tasks.visibleTasks.filter((task) => task.status === 'upcoming'),
      no_due_date: tasks.visibleTasks.filter((task) => task.status === 'no_due_date'),
      completed: tasks.visibleTasks.filter((task) => task.status === 'completed'),
    };
  }, [tasks.visibleTasks]);

  const openGroups = (['overdue', 'due_today', 'upcoming', 'no_due_date'] as const)
    .filter((status) => groupedTasks[status].length > 0);

  return (
    <div className="flex h-full min-h-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.08),transparent_28%),linear-gradient(180deg,rgba(7,7,8,0.9),rgba(27,27,29,1)_12%)]">
      <div className="flex min-w-0 flex-1 flex-col border-r border-[var(--border)] bg-[rgba(7,7,8,0.32)] backdrop-blur-sm md:w-[380px] md:max-w-[420px]">
        <div className="border-b border-[var(--border)] px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--text)]">Task Board</div>
              <div className="mt-1 text-[12px] text-[var(--text-faint)]">
                Review every Google Task, with FlowSpace work called out separately.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void tasks.refresh()}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer"
              title="Refresh tasks"
            >
              <RefreshCw size={14} className={tasks.loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="relative mt-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              value={tasks.searchQuery}
              onChange={(event) => tasks.setSearchQuery(event.target.value)}
              placeholder="Search tasks, notes, people, lists"
              className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface)] py-3 pl-9 pr-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--border2)]"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => tasks.setStatusFilter('all')}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-medium cursor-pointer ${
                tasks.statusFilter === 'all'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)]'
              }`}
            >
              All open
            </button>
            {(Object.entries(statusLabels) as Array<[Exclude<TaskStatus, 'completed'>, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => tasks.setStatusFilter(value)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-medium cursor-pointer ${
                  tasks.statusFilter === value
                    ? 'border-[var(--accent-border)] bg-[var(--accent-dim)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--text-dim)]">
            <input
              type="checkbox"
              checked={tasks.showCompleted}
              onChange={(event) => tasks.setShowCompleted(event.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Show completed tasks
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {tasks.loading && tasks.tasks.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-[92px] animate-pulse rounded-[16px] border border-[var(--border)] bg-[var(--surface)]" />
              ))}
            </div>
          ) : tasks.error && tasks.tasks.length === 0 ? (
            <div className="rounded-[16px] border border-[var(--error)]/30 bg-[var(--error-dim)]/30 p-4 text-[var(--text-dim)]">
              <div className="flex items-center gap-2 text-[var(--error)]">
                <AlertCircle size={15} />
                <span className="text-[13px] font-medium">Couldn&apos;t load tasks</span>
              </div>
              <p className="mt-2 text-[12px] text-[var(--text-dim)]">{tasks.error}</p>
            </div>
          ) : tasks.visibleTasks.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)]/70 px-5 py-10 text-center">
              <Clock3 size={22} className="mx-auto text-[var(--text-faint)]" />
              <div className="mt-3 text-[13px] font-medium text-[var(--text)]">No tasks match this view</div>
              <div className="mt-1 text-[12px] text-[var(--text-faint)]">Try a broader search or change the filters.</div>
            </div>
          ) : (
            <div className="space-y-5">
              {openGroups.map((status) => (
                <section key={status} aria-label={statusLabels[status]}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <div className="h-px flex-1 bg-[var(--border)]" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                      {statusLabels[status]}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {groupedTasks[status].map((task) => (
                      <TaskRow
                        key={`${task.taskListId}:${task.id}`}
                        task={task}
                        selected={tasks.selectedTask?.id === task.id}
                        onClick={() => tasks.selectTask(task.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {tasks.showCompleted && groupedTasks.completed.length > 0 && (
                <section aria-label="Completed">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <div className="h-px flex-1 bg-[var(--border)]" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                      Completed
                    </span>
                  </div>
                  <div className="space-y-2">
                    {groupedTasks.completed.map((task) => (
                      <TaskRow
                        key={`${task.taskListId}:${task.id}`}
                        task={task}
                        selected={tasks.selectedTask?.id === task.id}
                        onClick={() => tasks.selectTask(task.id)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        {tasks.selectedTask ? (
          <div className="flex h-full flex-col px-8 py-8">
            <div className="max-w-[720px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${sourceStyles[tasks.selectedTask.source].className}`}>
                  {sourceStyles[tasks.selectedTask.source].label}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusAccent(tasks.selectedTask)}`}>
                  {taskStatusLabel(tasks.selectedTask)}
                </span>
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-faint)]">
                  {tasks.selectedTask.taskListTitle}
                </span>
              </div>

              <h2 className="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-[var(--text)]">
                {tasks.selectedTask.title}
              </h2>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Due</div>
                  <div className="mt-2 text-[14px] font-medium text-[var(--text)]">{formatDueDate(tasks.selectedTask.due)}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Recipient</div>
                  <div className="mt-2 text-[14px] font-medium text-[var(--text)]">{tasks.selectedTask.recipient || 'Not attached'}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Source thread</div>
                  <div className="mt-2 text-[14px] font-medium text-[var(--text)]">{tasks.selectedTask.subject || 'Standalone task'}</div>
                </div>
              </div>

              <div className="mt-6 rounded-[18px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(37,38,42,0.8),rgba(31,32,35,0.96))] p-5">
                <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Notes</div>
                <div className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-[var(--text-dim)]">
                  {tasks.selectedTask.notes || 'No notes attached.'}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {tasks.selectedTask.status === 'completed' ? (
                  <button
                    type="button"
                    onClick={() => void tasks.reopenTask(tasks.selectedTask!)}
                    disabled={tasks.mutatingTaskId === tasks.selectedTask.id}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] font-medium text-[var(--text)] disabled:opacity-50 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2">
                      <RotateCcw size={13} />
                      Reopen
                    </span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void tasks.completeTask(tasks.selectedTask!)}
                      disabled={tasks.mutatingTaskId === tasks.selectedTask.id}
                      className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-dim)] px-4 py-2 text-[12px] font-medium text-[var(--accent)] disabled:opacity-50 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2">
                        <CheckCircle2 size={13} />
                        Mark complete
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void tasks.snoozeTask(tasks.selectedTask!, dueShortcut(1))}
                      disabled={tasks.mutatingTaskId === tasks.selectedTask.id}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] font-medium text-[var(--text)] disabled:opacity-50 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays size={13} />
                        Tomorrow
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void tasks.snoozeTask(tasks.selectedTask!, dueShortcut(7))}
                      disabled={tasks.mutatingTaskId === tasks.selectedTask.id}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] font-medium text-[var(--text)] disabled:opacity-50 cursor-pointer"
                    >
                      Next week
                    </button>
                  </>
                )}
                {tasks.selectedTask.threadId ? (
                  <a
                    href={gmailThreadUrl(tasks.selectedTask.threadId, accountEmail)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-[var(--blue-border)] bg-[var(--blue-dim)] px-4 py-2 text-[12px] font-medium text-[var(--blue)]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ExternalLink size={13} />
                      Open in Gmail
                    </span>
                  </a>
                ) : (
                  <a
                    href={googleTasksUrl(accountEmail)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] font-medium text-[var(--text)]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ExternalLink size={13} />
                      Open Google Tasks
                    </span>
                  </a>
                )}
              </div>

              {tasks.error && (
                <div className="mt-4 rounded-[14px] border border-[var(--error)]/30 bg-[var(--error-dim)]/30 px-4 py-3 text-[12px] text-[var(--text-dim)]">
                  {tasks.error}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-[360px] text-center">
              <Clock3 size={26} className="mx-auto text-[var(--text-faint)]" />
              <div className="mt-4 text-[15px] font-medium text-[var(--text)]">Select a task to inspect the details</div>
              <div className="mt-2 text-[13px] text-[var(--text-faint)]">
                Use the board to browse overdue work, agent-created tasks, and follow-ups from your email.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
