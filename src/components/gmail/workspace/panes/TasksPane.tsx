/**
 * TasksPane — extract actionable items and save them as Google Tasks.
 *
 * v1: bridges to chat via onAgentAction('create_task').
 * Shows a suggestion above the Extract button when brief.recommendedAction
 * contains task-shaped phrasing.
 */
import { ListTodo } from 'lucide-react';
import type { PaneProps } from './types.js';

// ── Main component ───────────────────────────────────────────────────────────

export default function TasksPane({ brief, onAgentAction }: PaneProps) {
  const suggestion = brief?.recommendedAction ?? null;

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Info card */}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
        <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">
          Extract actionable items from this thread and save them as Google Tasks.
        </p>
      </div>

      {/* Suggested action from brief */}
      {suggestion && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-[8px] bg-[var(--surface2)] border border-[var(--border)]">
          <ListTodo size={14} className="text-[var(--accent)] mt-0.5 shrink-0" />
          <p className="text-[12px] text-[var(--text-dim)] leading-relaxed">
            <span className="font-medium text-[var(--text)]">Suggested: </span>
            {suggestion}
          </p>
        </div>
      )}

      {/* Extract button */}
      <button
        type="button"
        aria-label="Extract tasks"
        onClick={() => onAgentAction('create_task')}
        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-[10px] bg-[var(--accent)] text-black text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
      >
        <ListTodo size={15} />
        Extract tasks
      </button>

      {/* Placeholder task list */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <p className="text-[11px] text-[var(--text-faint)] italic">Tasks extracted: (none yet)</p>
      </div>

      {/* Secondary info */}
      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
        The agent will open chat to review and confirm the extracted tasks before saving.
      </p>
    </div>
  );
}
