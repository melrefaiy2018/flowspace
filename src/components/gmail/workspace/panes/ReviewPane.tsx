/**
 * ReviewPane — read-only display pane for security alerts and informational threads.
 *
 * Shows brief summary, recommended action, context chips, and an ask-follow-up
 * input that routes through onAgentAction.
 */
import { useState } from 'react';
import type { ContextChip } from '../../../../shared/gmail-enrichment-types.js';
import type { PaneProps } from './types.js';

// ── Skeleton ────────────────────────────────────────────────────────────────

function ReviewPaneSkeleton() {
  return (
    <div data-testid="review-pane-skeleton" className="flex flex-col gap-3 p-5">
      <div className="h-5 w-3/4 bg-[var(--surface3)] animate-pulse rounded" />
      <div className="h-4 w-1/2 bg-[var(--surface3)] animate-pulse rounded" />
      <div className="flex gap-1.5 mt-1">
        <div className="h-5 w-20 bg-[var(--surface3)] animate-pulse rounded-full" />
        <div className="h-5 w-20 bg-[var(--surface3)] animate-pulse rounded-full" />
        <div className="h-5 w-20 bg-[var(--surface3)] animate-pulse rounded-full" />
      </div>
    </div>
  );
}

// ── Chip row ────────────────────────────────────────────────────────────────

function ChipRow({ chips }: { chips: ContextChip[] }) {
  if (chips.length === 0) return null;
  const visible = chips.slice(0, 4);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((chip, i) => (
        <span
          key={i}
          className="inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface2)] text-[var(--text-dim)] border border-[var(--border)]"
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

// ── Ask follow-up form ───────────────────────────────────────────────────────

function AskFollowUpForm({ onSubmit }: { onSubmit: (question: string) => void }) {
  const [value, setValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  }

  return (
    <form className="flex items-center gap-2" onSubmit={handleSubmit}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask a follow-up question…"
        className="flex-1 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12px] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)]"
      />
      <button
        type="submit"
        aria-label="Ask"
        className="border border-[var(--border)] bg-transparent text-[var(--text-dim)] rounded-[8px] px-3 py-1.5 text-[12px] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
      >
        Ask
      </button>
    </form>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ReviewPane({ brief, briefLoading, onAgentAction }: PaneProps) {
  const handleFollowUp = (question: string) => {
    onAgentAction('ask_agent', question);
  };

  if (briefLoading) {
    return <ReviewPaneSkeleton />;
  }

  if (!brief) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <p className="text-[14px] text-[var(--text-dim)]">No detailed analysis yet</p>
        <AskFollowUpForm onSubmit={handleFollowUp} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Summary card */}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] px-4 py-4">
        <p className="text-[16px] text-[var(--text)] leading-relaxed">
          {brief.summary || 'No summary available.'}
        </p>
      </div>

      {/* Recommended action card */}
      {brief.recommendedAction && (
        <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
          <p className="text-[14px]">
            <span className="text-[var(--text-dim)]">Recommended: </span>
            <span className="text-[var(--accent)]">{brief.recommendedAction}</span>
          </p>
        </div>
      )}

      {/* Context chips */}
      {brief.contextChips.length > 0 && (
        <ChipRow chips={brief.contextChips} />
      )}

      {/* Divider */}
      <div className="border-t border-[var(--border)]" />

      {/* Ask follow-up */}
      <AskFollowUpForm onSubmit={handleFollowUp} />
    </div>
  );
}
