import { useMemo, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock3,
  Inbox,
  ListChecks,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useTasksPage } from '../hooks/useTasksPage';
import { useChatContext } from '../context/ChatContext';
import type { TaskItem, TaskSource, TaskStatus } from '../services/api';
import { formatTaskDueDate } from '../lib/tasks';
import { TaskDetailWorkspace, statusLabels } from '../components/tasks/TaskDetailWorkspace';

const sourceStyles: Record<TaskSource, { label: string; textClassName: string }> = {
  flowspace_followup: {
    label: 'Follow-up',
    textClassName: 'font-medium text-[var(--blue)]',
  },
  flowspace_task: {
    label: 'FlowSpace',
    textClassName: 'font-medium text-[var(--accent)]',
  },
  google_task: {
    label: 'Google Tasks',
    textClassName: 'text-[var(--text-faint)]',
  },
};

function taskStatusLabel(task: TaskItem): string {
  if (task.status === 'completed') return 'Completed';
  if (task.status === 'overdue') return `${task.daysOverdue ?? 1}d overdue`;
  if (task.status === 'due_today') return 'Due today';
  if (task.status === 'upcoming') return `Due ${formatTaskDueDate(task.due)}`;
  return 'No due date';
}

function statusTone(status: TaskStatus): string {
  switch (status) {
    case 'overdue':
      return 'text-[var(--error)]';
    case 'due_today':
      return 'text-[var(--warn)]';
    case 'completed':
      return 'text-[var(--accent)]';
    default:
      return 'text-[var(--text-dim)]';
  }
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[10px] px-3 py-2 text-[12px] font-medium transition-colors cursor-pointer ${
        active
          ? 'bg-[var(--surface3)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border2)]'
          : 'text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--text-dim)]'
      }`}
    >
      {children}
    </button>
  );
}

function TaskMetric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0 border-r border-[var(--border)] px-3 last:border-r-0">
      <div className={`text-[18px] font-semibold leading-none tracking-[-0.03em] ${tone ?? 'text-[var(--text)]'}`}>{value}</div>
      <div className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-faint)]">{label}</div>
    </div>
  );
}

function buildAIHandoffPrompt(task: TaskItem): string {
  const lines: string[] = [
    `Task: ${task.title}`,
    `Status: ${taskStatusLabel(task)}`,
    `Due: ${formatTaskDueDate(task.due)}`,
    `List: ${task.taskListTitle}`,
    `Source: ${sourceStyles[task.source].label}`,
  ];
  if (task.recipient) lines.push(`Recipient: ${task.recipient}`);
  if (task.subject) lines.push(`Related email: ${task.subject}`);
  if (task.notes) lines.push(`\nNotes:\n${task.notes}`);
  lines.push('\nWhat should I do next with this task?');
  return lines.join('\n');
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
      className={`group relative w-full rounded-[12px] border px-3.5 py-3 text-left transition-all duration-200 cursor-pointer ${
        selected
          ? 'border-[var(--accent)]/45 bg-[rgba(34,197,94,0.08)] shadow-[inset_0_0_0_1px_rgba(34,197,94,0.08)]'
          : 'border-transparent bg-transparent hover:border-[var(--border)] hover:bg-[var(--surface)]'
      }`}
    >
      <div
        className={`absolute left-0 top-3 bottom-3 w-[2px] rounded-full ${
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
          <div className="truncate text-[13px] font-semibold leading-snug text-[var(--text)]">{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-faint)]">
            <span className={source.textClassName}>
              {source.label}
            </span>
            <span className="text-[var(--border2)]">/</span>
            <span className={statusTone(task.status)}>{taskStatusLabel(task)}</span>
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-faint)]">
            {task.taskListTitle}
            {task.recipient ? ` • ${task.recipient}` : ''}
          </div>
          {task.notes && (
            <div className="mt-2 line-clamp-2 text-[12px] leading-5 text-[var(--text-dim)]">
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
  const { sendMessage, openChatPanel, focusInput } = useChatContext();

  const taskCounts = useMemo(() => {
    const open = tasks.tasks.filter((task) => task.status !== 'completed');
    return {
      open: open.length,
      overdue: open.filter((task) => task.status === 'overdue').length,
      dueToday: open.filter((task) => task.status === 'due_today').length,
      upcoming: open.filter((task) => task.status === 'upcoming').length,
    };
  }, [tasks.tasks]);

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

  function handleOpenInAI(task: TaskItem, prompt?: string) {
    const content = prompt ?? buildAIHandoffPrompt(task);
    const displayContent = `Ask FlowSpace about: ${task.title}`;
    void sendMessage(content, { displayContent, forceNewChat: true });
    openChatPanel();
    requestAnimationFrame(() => focusInput());
  }

  return (
    <div className="flex h-full min-h-0 bg-[var(--bg)]">
      <div className="flex min-w-0 flex-1 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] md:w-[430px] md:max-w-[460px]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                <ListChecks size={13} aria-hidden />
                Task Board
              </div>
              <div className="mt-2 text-[20px] font-semibold tracking-[-0.04em] text-[var(--text)]">
                {countLabel(taskCounts.open, 'open task')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void tasks.refresh()}
              className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[var(--text-faint)] transition-colors hover:border-[var(--border2)] hover:text-[var(--text)] cursor-pointer"
              title="Refresh tasks"
              aria-label="Refresh tasks"
            >
              <RefreshCw size={14} className={tasks.loading ? 'animate-spin' : ''} aria-hidden />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface-soft)] py-3">
            <TaskMetric label="Open" value={taskCounts.open} />
            <TaskMetric label="Overdue" value={taskCounts.overdue} tone="text-[var(--error)]" />
            <TaskMetric label="Today" value={taskCounts.dueToday} tone="text-[var(--warn)]" />
            <TaskMetric label="Later" value={taskCounts.upcoming} />
          </div>

          <div className="relative mt-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" aria-hidden />
            <input
              value={tasks.searchQuery}
              onChange={(event) => tasks.setSearchQuery(event.target.value)}
              placeholder="Search tasks, notes, people, lists"
              aria-label="Search tasks"
              className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-9 pr-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--border2)]"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface-soft)] p-1" role="group" aria-label="Filter by status">
            <FilterButton active={tasks.statusFilter === 'all'} onClick={() => tasks.setStatusFilter('all')}>
              All open
            </FilterButton>
            {(Object.entries(statusLabels) as Array<[Exclude<TaskStatus, 'completed'>, string]>).map(([value, label]) => (
              <FilterButton
                key={value}
                active={tasks.statusFilter === value}
                onClick={() => tasks.setStatusFilter(value)}
              >
                {label}
              </FilterButton>
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

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tasks.loading && tasks.tasks.length === 0 ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading tasks">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-[92px] animate-pulse rounded-[12px] border border-[var(--border)] bg-[var(--surface)]" />
              ))}
            </div>
          ) : tasks.error && tasks.tasks.length === 0 ? (
            <div className="rounded-[12px] border border-[var(--error)]/30 bg-[var(--error-dim)]/30 p-4 text-[var(--text-dim)]" role="alert">
              <div className="flex items-center gap-2 text-[var(--error)]">
                <AlertCircle size={15} aria-hidden />
                <span className="text-[13px] font-medium">Couldn&apos;t load tasks</span>
              </div>
              <p className="mt-2 text-[12px] text-[var(--text-dim)]">{tasks.error}</p>
            </div>
          ) : tasks.visibleTasks.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--border2)] bg-[var(--surface)]/70 px-5 py-10 text-center">
              <Inbox size={22} className="mx-auto text-[var(--text-faint)]" aria-hidden />
              <div className="mt-3 text-[13px] font-medium text-[var(--text)]">No tasks match this view</div>
              <div className="mt-1 text-[12px] text-[var(--text-faint)]">Try a broader search or change the filters.</div>
            </div>
          ) : (
            <div className="space-y-4">
              {openGroups.map((status) => (
                <section key={status} aria-label={statusLabels[status]}>
                  <div className="mb-1 flex items-center justify-between px-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                      {statusLabels[status]}
                    </span>
                    <span className="text-[11px] text-[var(--text-faint)]">{groupedTasks[status].length}</span>
                  </div>
                  <div className="space-y-1">
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
                  <div className="mb-1 flex items-center justify-between px-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                      Completed
                    </span>
                    <span className="text-[11px] text-[var(--text-faint)]">{groupedTasks.completed.length}</span>
                  </div>
                  <div className="space-y-1">
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

      {/* Right: detail workspace */}
      <div className="hidden min-w-0 flex-1 bg-[var(--bg)] md:flex md:h-full md:flex-col">
        {tasks.selectedTask ? (
          <TaskDetailWorkspace
            task={tasks.selectedTask}
            mutatingTaskId={tasks.mutatingTaskId}
            accountEmail={accountEmail}
            onComplete={(task) => void tasks.completeTask(task)}
            onReopen={(task) => void tasks.reopenTask(task)}
            onSnooze={(task, due) => void tasks.snoozeTask(task, due)}
            onOpenInAI={handleOpenInAI}
            error={tasks.error}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-[360px] text-center">
              <Clock3 size={26} className="mx-auto text-[var(--text-faint)]" aria-hidden />
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
