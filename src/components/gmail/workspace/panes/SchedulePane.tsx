/**
 * SchedulePane — calendar slot picker + draft reply composer.
 *
 * Used for meeting_request type. v1 bridges to chat via onAgentAction('pick_times')
 * since there is no /api/calendar/free-slots endpoint yet.
 * Shows a placeholder 7-day grid indicating where the native slot picker will go.
 */
import { Calendar } from 'lucide-react';
import type { ContextChip } from '../../../../shared/gmail-enrichment-types.js';
import type { PaneProps } from './types.js';

// ── Slot placeholder grid ────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function SlotPlaceholder() {
  return (
    <div
      data-testid="schedule-pane-slot-placeholder"
      className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] opacity-50 overflow-hidden"
      aria-label="Slot picker placeholder — coming soon"
    >
      {/* Placeholder header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface2)]">
        <Calendar size={13} className="text-[var(--text-faint)]" />
        <span className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">
          Available slots (coming soon)
        </span>
      </div>

      {/* 7-day column headers */}
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {DAYS.map((day) => (
          <div
            key={day}
            className="py-1.5 text-center text-[10px] text-[var(--text-faint)] border-r border-[var(--border)] last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Slot rows — placeholder shimmer blocks */}
      {Array.from({ length: 3 }).map((_, row) => (
        <div key={row} className="grid grid-cols-7 border-b border-[var(--border)] last:border-b-0">
          {DAYS.map((day) => (
            <div
              key={day}
              className="h-8 border-r border-[var(--border)] last:border-r-0 flex items-center justify-center"
            >
              <div className="w-10 h-4 rounded bg-[var(--surface3)]" />
            </div>
          ))}
        </div>
      ))}

      {/* "Slot picker coming soon" overlay text */}
      <div className="py-2 text-center text-[11px] text-[var(--text-faint)] italic">
        Slot picker coming soon
      </div>
    </div>
  );
}

// ── Thread context chip ──────────────────────────────────────────────────────

function ThreadContextBadge({ chip }: { chip: ContextChip }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-dim)]">
      <span className="font-medium">Thread context:</span>
      <span
        className="inline-flex px-2 py-0.5 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-[11px]"
      >
        {chip.label}
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function SchedulePane({ brief, onAgentAction }: PaneProps) {
  // Find thread_age or last_message_age chip if present
  const contextChip = brief?.contextChips.find(
    (c) => c.kind === 'thread_age' || c.kind === 'last_message_age',
  );

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Context chip (thread freshness) */}
      {contextChip && <ThreadContextBadge chip={contextChip} />}

      {/* Info card */}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
        <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">
          The agent can find available meeting times in your calendar and draft a reply with
          specific slots.
        </p>
      </div>

      {/* Slot picker placeholder */}
      <SlotPlaceholder />

      {/* Primary action button */}
      <button
        type="button"
        aria-label="Open in chat to pick times"
        onClick={() => onAgentAction('pick_times')}
        className="self-start px-4 py-2 rounded-[8px] bg-[var(--accent)] text-black text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
      >
        Open in chat to pick times
      </button>

      {/* Secondary info */}
      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
        FlowSpace will suggest 3 available 30-minute slots based on your calendar, then draft a
        reply proposing them.
      </p>
    </div>
  );
}
