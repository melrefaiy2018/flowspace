/**
 * TaskActionPanel — action card with clear three-tier hierarchy:
 *
 *   Tier 1 (dominant):   Ask FlowSpace — full width, green filled
 *   Tier 2 (secondary):  Task controls — compact ghost pills
 *   Tier 3 (tertiary):   FlowSpace prompts — icon + label chips, lighter weight
 *
 * All enclosed in a single shared card so the action area reads as one block.
 */

import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  ListTodo,
  MessageSquare,
  RotateCcw,
  Scissors,
  Search,
} from 'lucide-react';
import type { TaskItem } from '../../services/api';
import { gmailThreadUrl, googleTasksUrl } from '../../lib/google-account-links';
import { formatTaskDueDate } from '../../lib/tasks';

interface TaskActionPanelProps {
  task: TaskItem;
  mutating: boolean;
  accountEmail?: string | null;
  onComplete: () => void;
  onReopen: () => void;
  onSnooze: (due: string) => void;
  onOpenInAI: (prompt?: string) => void;
}

function snoozeDate(daysFromNow: number): string {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

// ─── button style tokens ─────────────────────────────────────────────────────

/** Tier 1: dominant primary CTA */
const primaryCls =
  'flex w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 py-2.5 text-[13px] font-semibold text-black transition-opacity hover:opacity-90 cursor-pointer disabled:opacity-40';

/** Tier 2: secondary task control — ghost pill */
const ghostCls =
  'inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-transparent px-3 py-1.5 text-[12px] font-medium text-[var(--text-dim)] transition-colors hover:border-[var(--border2)] hover:bg-[var(--surface2)] cursor-pointer disabled:opacity-40';

/** Tier 2: accent ghost pill for completion */
const accentGhostCls =
  'inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-dim)]/60 px-3 py-1.5 text-[12px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-dim)] cursor-pointer disabled:opacity-40';

/** Tier 2: blue ghost for external link */
const blueCls =
  'inline-flex items-center gap-1.5 rounded-full border border-[var(--blue-border)] bg-[var(--blue-dim)]/50 px-3 py-1.5 text-[12px] font-medium text-[var(--blue)] transition-colors hover:bg-[var(--blue-dim)] cursor-pointer';

/** Tier 3: FlowSpace prompt chip — very light, icon first */
const chipCls =
  'inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)]/50 px-2.5 py-1 text-[11px] font-medium text-[var(--text-faint)] transition-colors hover:border-[var(--border2)] hover:text-[var(--text-dim)] cursor-pointer';

// ─── component ───────────────────────────────────────────────────────────────

export function TaskActionPanel({
  task,
  mutating,
  accountEmail,
  onComplete,
  onReopen,
  onSnooze,
  onOpenInAI,
}: TaskActionPanelProps) {
  const isCompleted = task.status === 'completed';

  const externalHref = task.threadId
    ? gmailThreadUrl(task.threadId, accountEmail)
    : googleTasksUrl(accountEmail);
  const externalLabel = task.threadId ? 'Open in Gmail' : 'Open Google Tasks';

  // Context payload for FlowSpace prompt chips
  const ctx = [
    `Task: ${task.title}`,
    `Due: ${formatTaskDueDate(task.due)}`,
    task.recipient ? `Recipient: ${task.recipient}` : null,
    task.subject ? `Related email: ${task.subject}` : null,
    task.notes ? `\nNotes:\n${task.notes}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4 space-y-4">

      {/* ── Tier 1: Ask FlowSpace ── */}
      <button
        type="button"
        onClick={() => onOpenInAI()}
        className={primaryCls}
        aria-label="Ask FlowSpace about this task"
      >
        <Bot size={14} aria-hidden />
        Ask FlowSpace
      </button>

      {/* ── Tier 2: Task controls ── */}
      <div>
        <SectionLabel>Task actions</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-2">
          {isCompleted ? (
            <button
              type="button"
              onClick={onReopen}
              disabled={mutating}
              className={ghostCls}
              aria-label="Reopen task"
            >
              <RotateCcw size={12} aria-hidden />
              Reopen
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onComplete}
                disabled={mutating}
                className={accentGhostCls}
                aria-label="Mark task complete"
              >
                <CheckCircle2 size={12} aria-hidden />
                Mark complete
              </button>
              <button
                type="button"
                onClick={() => onSnooze(snoozeDate(1))}
                disabled={mutating}
                className={ghostCls}
                aria-label="Snooze to tomorrow"
              >
                <CalendarDays size={12} aria-hidden />
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => onSnooze(snoozeDate(7))}
                disabled={mutating}
                className={ghostCls}
                aria-label="Snooze to next week"
              >
                Next week
              </button>
            </>
          )}
          <a
            href={externalHref}
            target="_blank"
            rel="noreferrer"
            className={blueCls}
            aria-label={externalLabel}
          >
            <ExternalLink size={12} aria-hidden />
            {externalLabel}
          </a>
        </div>
      </div>

      {/* ── Tier 3: FlowSpace prompt chips — only for open tasks ── */}
      {!isCompleted && (
        <div className="border-t border-[var(--border)] pt-3">
          <SectionLabel>FlowSpace prompts</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AIChip
              icon={<ListTodo size={11} aria-hidden />}
              label="Break into subtasks"
              prompt={`Break this task into concrete, actionable subtasks:\n\n${ctx}`}
              onOpenInAI={onOpenInAI}
            />
            <AIChip
              icon={<MessageSquare size={11} aria-hidden />}
              label="Draft reminder"
              prompt={`Draft a short, professional follow-up reminder for this task:\n\n${ctx}`}
              onOpenInAI={onOpenInAI}
            />
            <AIChip
              icon={<Search size={11} aria-hidden />}
              label="Find related docs"
              prompt={`Search for related documents or emails for this task and summarize what you find:\n\n${ctx}`}
              onOpenInAI={onOpenInAI}
            />
            <AIChip
              icon={<Scissors size={11} aria-hidden />}
              label="Identify blockers"
              prompt={`Identify what might be blocking progress on this task and suggest concrete ways to unblock:\n\n${ctx}`}
              onOpenInAI={onOpenInAI}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
      {children}
    </div>
  );
}

function AIChip({
  icon,
  label,
  prompt,
  onOpenInAI,
}: {
  icon: React.ReactNode;
  label: string;
  prompt: string;
  onOpenInAI: (prompt?: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenInAI(prompt)}
      className={chipCls}
      aria-label={label}
    >
      {icon}
      {label}
    </button>
  );
}
