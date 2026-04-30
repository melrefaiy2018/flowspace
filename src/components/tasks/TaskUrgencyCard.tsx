/**
 * TaskUrgencyCard — compact single-row alert strip.
 * Renders nothing for completed tasks or non-urgent upcoming tasks.
 * Height: 36px (py-2 + content). Feels like an annotation, not a banner.
 */

import { AlertTriangle, Clock } from 'lucide-react';
import type { TaskItem } from '../../services/api';
import { formatTaskDueDate } from '../../lib/tasks';

interface UrgencyInfo {
  level: 'critical' | 'warn';
  headline: string;
  detail: string | null;
}

function getUrgency(task: TaskItem): UrgencyInfo | null {
  if (task.status === 'completed') return null;

  if (task.status === 'overdue') {
    const days = task.daysOverdue ?? 1;
    return {
      level: 'critical',
      headline: `${days} day${days !== 1 ? 's' : ''} overdue`,
      detail: task.due ? `Was due ${formatTaskDueDate(task.due)}` : null,
    };
  }

  if (task.status === 'due_today') {
    return {
      level: 'warn',
      headline: 'Due today',
      detail: 'Complete or reschedule before end of day.',
    };
  }

  if (task.status === 'upcoming' && task.due) {
    const daysUntil = Math.ceil(
      (new Date(task.due).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil <= 3) {
      return {
        level: 'warn',
        headline: `Due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`,
        detail: null,
      };
    }
  }

  return null;
}

export function TaskUrgencyCard({ task }: { task: TaskItem }) {
  const urgency = getUrgency(task);
  if (!urgency) return null;

  const isCritical = urgency.level === 'critical';
  const Icon = isCritical ? AlertTriangle : Clock;

  const strip = isCritical
    ? 'border-[var(--error)]/25 bg-[var(--error-dim)]/20'
    : 'border-[var(--warn)]/25 bg-[var(--warn-dim)]/15';

  const iconCls = isCritical ? 'text-[var(--error)]' : 'text-[var(--warn)]';

  const headlineCls = isCritical
    ? 'text-[var(--error)] font-semibold'
    : 'text-[var(--warn)] font-semibold';

  return (
    <div
      className={`flex items-center gap-2 rounded-[16px] border px-5 py-2.5 ${strip}`}
      role="status"
      aria-label={urgency.headline}
    >
      <Icon size={13} className={iconCls} aria-hidden />
      <span className={`text-[12px] ${headlineCls}`}>{urgency.headline}</span>
      {urgency.detail && (
        <span className="text-[12px] text-[var(--text-faint)]">·  {urgency.detail}</span>
      )}
    </div>
  );
}
