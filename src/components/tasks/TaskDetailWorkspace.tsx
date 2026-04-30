/**
 * TaskDetailWorkspace — right-panel canvas for a selected task.
 *
 * Card system rules (all cards share these):
 *   - corner radius: rounded-[16px]
 *   - horizontal padding: px-5
 *   - vertical padding: py-4
 *   - border: border border-[var(--border)]
 *   - background: bg-[var(--surface)]
 *
 * Section gap: gap-y-3 (12px) between every card.
 * Max content width: 560px, centred with auto margins.
 */

import { CalendarDays } from 'lucide-react';
import { formatTaskDueDate } from '../../lib/tasks';
import type { TaskItem, TaskSource, TaskStatus } from '../../services/api';
import { TaskSummaryCard } from './TaskSummaryCard';
import { TaskUrgencyCard } from './TaskUrgencyCard';
import { TaskActionPanel } from './TaskActionPanel';
import { TaskContextPanel } from './TaskContextPanel';
import { RawNotesSection } from './RawNotesSection';

// ─── shared style tokens ────────────────────────────────────────────────────

const sourceStyles: Record<TaskSource, { label: string; dot: string }> = {
  flowspace_followup: {
    label: 'Follow-up',
    dot: 'bg-[var(--blue)]',
  },
  flowspace_task: {
    label: 'FlowSpace',
    dot: 'bg-[var(--accent)]',
  },
  google_task: {
    label: 'Google Tasks',
    dot: 'bg-[var(--text-faint)]',
  },
};

function statusConfig(task: TaskItem): { label: string; cls: string } {
  switch (task.status) {
    case 'overdue':
      return {
        label: `${task.daysOverdue ?? 1}d overdue`,
        cls: 'bg-[var(--error-dim)]/60 text-[var(--error)]',
      };
    case 'due_today':
      return {
        label: 'Due today',
        cls: 'bg-[var(--warn-dim)]/50 text-[var(--warn)]',
      };
    case 'completed':
      return {
        label: 'Completed',
        cls: 'bg-[var(--accent-dim)]/60 text-[var(--accent)]',
      };
    case 'upcoming':
      return {
        label: `Due ${formatTaskDueDate(task.due)}`,
        cls: 'bg-[var(--surface2)] text-[var(--text-faint)]',
      };
    default:
      return {
        label: 'No due date',
        cls: 'bg-[var(--surface2)] text-[var(--text-faint)]',
      };
  }
}

function statusTextClass(task: TaskItem): string {
  switch (task.status) {
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

export function taskStatusLabel(task: TaskItem): string {
  return statusConfig(task).label;
}

export const statusLabels: Record<Exclude<TaskStatus, 'completed'>, string> = {
  overdue: 'Overdue',
  due_today: 'Today',
  upcoming: 'Upcoming',
  no_due_date: 'No due date',
};

// ─── prop types ─────────────────────────────────────────────────────────────

interface TaskDetailWorkspaceProps {
  task: TaskItem;
  mutatingTaskId: string | null;
  accountEmail?: string | null;
  onComplete: (task: TaskItem) => void;
  onReopen: (task: TaskItem) => void;
  onSnooze: (task: TaskItem, due: string) => void;
  onOpenInAI: (task: TaskItem, prompt?: string) => void;
  error?: string | null;
}

// ─── component ──────────────────────────────────────────────────────────────

export function TaskDetailWorkspace({
  task,
  mutatingTaskId,
  accountEmail,
  onComplete,
  onReopen,
  onSnooze,
  onOpenInAI,
  error,
}: TaskDetailWorkspaceProps) {
  const src = sourceStyles[task.source];
  const status = statusConfig(task);
  const statusText = statusTextClass(task);
  const mutating = mutatingTaskId === task.id;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <div className="flex-1 overflow-y-auto px-10 py-8">
        <div className="w-full max-w-[760px]">

        <div>
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className={`font-semibold ${statusText}`}>
              {status.label}
            </span>
            <span className="text-[var(--border2)]">/</span>
            <span className="flex items-center gap-1 font-medium text-[var(--text-dim)]">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${src.dot}`} aria-hidden />
              {src.label}
            </span>
            <span className="text-[var(--border2)]">/</span>
            <span className="font-medium text-[var(--text-faint)]">{task.taskListTitle}</span>
          </div>

          <h2 className="mt-4 max-w-[720px] text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[var(--text)]">
            {task.title}
          </h2>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--text-faint)]">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={11} aria-hidden />
              {formatTaskDueDate(task.due)}
            </span>
            {task.recipient && (
              <span className="max-w-[200px] truncate">{task.recipient}</span>
            )}
          </div>
        </div>

        <div className="mt-5">
          <TaskUrgencyCard task={task} />
        </div>

        <div className="mt-7">
          <TaskSummaryCard task={task} />
        </div>

        <div className="mt-8">
          <TaskContextPanel task={task} accountEmail={accountEmail} />
        </div>

        <div className="mt-6">
          <RawNotesSection notes={task.notes} />
        </div>

        {error && (
          <div
            className="mt-6 rounded-[12px] border border-[var(--error)]/25 bg-[var(--error-dim)]/20 px-4 py-3 text-[12px] text-[var(--text-dim)]"
            role="alert"
          >
            {error}
          </div>
        )}
        </div>
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--bg)] px-10 py-4">
        <div className="max-w-[760px]">
        <TaskActionPanel
          task={task}
          mutating={mutating}
          accountEmail={accountEmail}
          onComplete={() => onComplete(task)}
          onReopen={() => onReopen(task)}
          onSnooze={(due) => onSnooze(task, due)}
          onOpenInAI={(prompt) => onOpenInAI(task, prompt)}
        />
        </div>
      </div>
    </div>
  );
}
