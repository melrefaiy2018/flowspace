/**
 * SummaryPane — readable agent-produced brief/extract for newsletter threads.
 *
 * States:
 * - Loading: skeleton shimmer
 * - Ready: summary card + recommended action + chips + secondary action row
 * - Fallback: "No summary yet" with prompt to ask the agent
 */
import { FileText, ListTodo, Archive } from 'lucide-react';
import type { ContextChip } from '../../../../shared/gmail-enrichment-types.js';
import type { PaneProps } from './types.js';

// ── Skeleton ────────────────────────────────────────────────────────────────

function SummaryPaneSkeleton() {
  return (
    <div data-testid="summary-pane-skeleton" className="flex flex-col gap-4 p-5">
      {/* Summary card placeholder */}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] px-4 py-4 flex flex-col gap-2">
        <div className="h-4 w-full bg-[var(--surface3)] animate-pulse rounded" />
        <div className="h-4 w-5/6 bg-[var(--surface3)] animate-pulse rounded" />
        <div className="h-4 w-4/6 bg-[var(--surface3)] animate-pulse rounded" />
      </div>
      {/* Recommended action placeholder */}
      <div className="h-8 w-3/4 bg-[var(--surface3)] animate-pulse rounded-[8px]" />
      {/* Chip row placeholder */}
      <div className="flex gap-1.5">
        <div className="h-5 w-20 bg-[var(--surface3)] animate-pulse rounded-full" />
        <div className="h-5 w-16 bg-[var(--surface3)] animate-pulse rounded-full" />
        <div className="h-5 w-24 bg-[var(--surface3)] animate-pulse rounded-full" />
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

// ── Main component ───────────────────────────────────────────────────────────

export default function SummaryPane({ item, brief, briefLoading, onAgentAction, onDirectAction }: PaneProps) {
  const threadId = item.source.threadId;

  if (briefLoading) {
    return <SummaryPaneSkeleton />;
  }

  if (!brief) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <div className="rounded-[12px] bg-[var(--surface)] border border-[var(--border)] px-6 py-5 max-w-sm text-center flex flex-col gap-3">
          <p className="text-[14px] text-[var(--text-dim)] leading-relaxed">
            No summary yet — click Extract to ask the agent to summarize this thread.
          </p>
          <button
            type="button"
            aria-label="Ask agent to summarize"
            onClick={() => onAgentAction('ask_agent', 'Summarize this thread')}
            className="self-center px-4 py-2 rounded-[8px] bg-[var(--accent)] text-black text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
          >
            Ask agent to summarize
          </button>
        </div>
      </div>
    );
  }

  const handleArchive = () => {
    if (onDirectAction) {
      onDirectAction('archive', threadId);
    } else {
      onAgentAction('ask_agent', 'Archive this thread');
    }
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Summary card — prominent readable prose */}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] px-4 py-4">
        <p className="text-[16px] text-[var(--text)] leading-relaxed">
          {brief.summary || 'No summary available.'}
        </p>
      </div>

      {/* Recommended action — subtle callout */}
      {brief.recommendedAction && (
        <div className="border-l-2 border-[var(--accent)] pl-3 py-1">
          <p className="text-[13px] text-[var(--text-dim)] leading-snug">
            {brief.recommendedAction}
          </p>
        </div>
      )}

      {/* Context chips */}
      {brief.contextChips.length > 0 && (
        <ChipRow chips={brief.contextChips} />
      )}

      {/* Divider */}
      <div className="border-t border-[var(--border)]" />

      {/* Secondary action row */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="Draft reply"
          onClick={() => onAgentAction('draft_follow_up')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] text-[12px] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
        >
          <FileText size={13} />
          Draft reply
        </button>

        <button
          type="button"
          aria-label="Extract tasks"
          onClick={() => onAgentAction('create_task')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] text-[12px] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
        >
          <ListTodo size={13} />
          Extract tasks
        </button>

        <button
          type="button"
          aria-label="Archive"
          onClick={handleArchive}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] text-[12px] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
        >
          <Archive size={13} />
          Archive
        </button>
      </div>
    </div>
  );
}
