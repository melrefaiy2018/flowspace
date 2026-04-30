import { Video, Users, Sparkles, Clock } from 'lucide-react';
import type { CalendarEventDetail } from '../../services/api';
import type { EventMeta } from './calendarUtils';
import { formatTime, formatDuration } from './calendarUtils';
import type { InsightFilter } from '../../hooks/useCalendarPage';

interface Props {
  event: CalendarEventDetail;
  meta: EventMeta;
  isSelected: boolean;
  insightFilter: InsightFilter;
  isPinned?: boolean; // "most important" slot in day header
  onClick: () => void;
  onAskAI?: (prompt: string) => void;
}

function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function attendeeSummary(event: CalendarEventDetail): string | null {
  if (event.attendees.length === 0) return null;
  if (event.attendees.length <= 2)
    return event.attendees.map((a) => a.name ?? a.email.split('@')[0]).join(', ');
  return `${event.attendees[0].name ?? event.attendees[0].email.split('@')[0]} +${event.attendees.length - 1}`;
}

// ── Card variants ─────────────────────────────────────────────────────

// Focus block — calm, restorative, no action chrome
function FocusCard({ event, isSelected, past }: { event: CalendarEventDetail; isSelected: boolean; past: boolean; onClick: () => void }) {
  return (
    <div className={`rounded-lg px-3 py-2 border transition-colors ${
      past ? 'opacity-40' : ''
    } ${isSelected
      ? 'bg-[var(--surface2)] border-[var(--border)]'
      : 'bg-[var(--surface1)]/60 border-transparent'
    }`}>
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]/40 shrink-0" />
        <span className="text-[11px] text-[var(--text-faint)]">{event.summary}</span>
        <span className="text-[10px] text-[var(--text-faint)]/60 ml-auto font-mono">
          {formatTime(event.start)} – {formatTime(event.end)}
        </span>
      </div>
    </div>
  );
}

// Routine internal — neutral, compact
function RoutineCard({
  event, meta, isSelected, past, onClick, onAskAI,
}: { event: CalendarEventDetail; meta: EventMeta; isSelected: boolean; past: boolean; onClick: () => void; onAskAI?: (p: string) => void }) {
  const summary = attendeeSummary(event);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-150 cursor-pointer group ${
        past ? 'opacity-40' : ''
      } ${isSelected
        ? 'bg-[var(--surface2)] border-[var(--border)]'
        : 'bg-[var(--surface1)] border-[var(--border2)] hover:border-[var(--border)] hover:bg-[var(--surface2)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]/70 font-mono shrink-0">
          <Clock size={8} />
          {formatTime(event.start)}
          <span className="text-[var(--text-faint)]/40">·</span>
          {formatDuration(event.start, event.end)}
        </div>
        {event.hangoutLink && !past && (
          <a
            href={event.hangoutLink}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 text-[9px] text-[var(--accent)] hover:underline transition-opacity shrink-0"
          >
            Join
          </a>
        )}
      </div>
      <div className="text-[12px] text-[var(--text-dim)] font-medium mt-0.5 leading-tight truncate">
        {event.summary}
      </div>
      {summary && (
        <div className="flex items-center gap-1 mt-0.5 text-[9px] text-[var(--text-faint)]/60 truncate">
          <Users size={8} />
          {summary}
        </div>
      )}
    </button>
  );
}

// Prep-needed meeting — amber accent, visible action
function PrepNeededCard({
  event, meta, isSelected, past, onClick, onAskAI,
}: { event: CalendarEventDetail; meta: EventMeta; isSelected: boolean; past: boolean; onClick: () => void; onAskAI?: (p: string) => void }) {
  const summary = attendeeSummary(event);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border-l-2 border border-[var(--warn)]/30 px-3 py-2.5 transition-all duration-150 cursor-pointer group ${
        past ? 'opacity-40' : ''
      } ${isSelected
        ? 'bg-[var(--warn)]/10 border-l-[var(--warn)] border-[var(--warn)]/40'
        : 'bg-[var(--warn)]/5 border-l-[var(--warn)]/60 hover:bg-[var(--warn)]/8 hover:border-l-[var(--warn)]'
      }`}
      style={{ borderLeftColor: isSelected ? 'var(--warn)' : undefined }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]/70 font-mono">
          <Clock size={8} />
          {formatTime(event.start)}
          <span className="text-[var(--text-faint)]/40">·</span>
          {formatDuration(event.start, event.end)}
          {meta.isExternal && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-medium bg-[var(--surface3)] text-[var(--text-faint)]">Ext</span>
          )}
        </div>
        <span className="text-[9px] font-medium text-[var(--warn)] bg-[var(--warn)]/15 px-1.5 py-0.5 rounded shrink-0">
          Needs prep
        </span>
      </div>
      <div className="text-[13px] text-[var(--text)] font-semibold leading-tight truncate mb-1">
        {event.summary}
      </div>
      {summary && (
        <div className="flex items-center gap-1 text-[9px] text-[var(--text-faint)] mb-1.5 truncate">
          <Users size={8} />
          {summary}
        </div>
      )}
      {onAskAI && !past && (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onAskAI(`Prepare for my meeting: ${event.summary}${summary ? ` with ${summary}` : ''}`); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAskAI(`Prepare for my meeting: ${event.summary}`); } }}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--purple-dim)] text-[var(--purple)] hover:bg-[var(--purple)] hover:text-white transition-colors cursor-pointer ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          } transition-opacity`}
        >
          <Sparkles size={9} />
          Prepare
        </div>
      )}
    </button>
  );
}

// High-importance meeting — strongest visual presence
function ImportantCard({
  event, meta, isSelected, past, isPinned, onClick, onAskAI,
}: { event: CalendarEventDetail; meta: EventMeta; isSelected: boolean; past: boolean; isPinned?: boolean; onClick: () => void; onAskAI?: (p: string) => void }) {
  const summary = attendeeSummary(event);
  const hasBrief = meta.prepStatus === 'ready';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border-l-[3px] px-4 py-3 transition-all duration-150 cursor-pointer group ${
        past ? 'opacity-45' : ''
      } ${isPinned
        ? 'border border-[var(--accent)]/40 bg-[var(--accent-dim)]/20 shadow-sm'
        : isSelected
          ? 'border border-[var(--accent)]/30 bg-[var(--accent-dim)]/15'
          : 'border border-[var(--accent)]/20 bg-[var(--accent-dim)]/10 hover:bg-[var(--accent-dim)]/18 hover:border-[var(--accent)]/35'
      }`}
      style={{ borderLeftColor: 'var(--accent)' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)] font-mono">
          <Clock size={8} />
          {formatTime(event.start)}
          <span className="text-[var(--text-faint)]/40">·</span>
          {formatDuration(event.start, event.end)}
          {meta.isExternal && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-medium bg-[var(--surface3)] text-[var(--text-faint)]">Ext</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasBrief && (
            <span className="flex items-center gap-0.5 text-[9px] font-medium text-[var(--purple)] bg-[var(--purple-dim)] px-1.5 py-0.5 rounded">
              <Sparkles size={8} />
              Brief ready
            </span>
          )}
          {isPinned && (
            <span className="text-[9px] font-semibold text-[var(--accent)] bg-[var(--accent-dim)] px-1.5 py-0.5 rounded">
              Key
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-[14px] font-bold text-[var(--text)] leading-tight mb-1.5">
        {event.summary}
      </div>

      {/* Attendees */}
      {summary && (
        <div className="flex items-center gap-1 text-[10px] text-[var(--text-faint)] mb-2">
          <Users size={9} />
          {summary}
        </div>
      )}

      {/* Actions */}
      {!past && (
        <div className={`flex items-center gap-1.5 transition-opacity duration-150 ${
          isSelected || isPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          {onAskAI && (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onAskAI(`Prepare for my meeting: ${event.summary}${summary ? ` with ${summary}` : ''}`); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAskAI(`Prepare for my meeting: ${event.summary}`); } }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-[var(--purple-dim)] text-[var(--purple)] hover:bg-[var(--purple)] hover:text-white transition-colors cursor-pointer"
            >
              <Sparkles size={9} />
              {hasBrief ? 'Open prep' : 'Prepare'}
            </div>
          )}
          {event.hangoutLink && (
            <a
              href={event.hangoutLink}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors"
            >
              <Video size={9} />
              Join
            </a>
          )}
        </div>
      )}
    </button>
  );
}

// ── Insight-filter overlay helpers ────────────────────────────────────

function applyFilterDim(meta: EventMeta, insightFilter: InsightFilter): boolean {
  if (!insightFilter) return false;
  if (insightFilter === 'external') return !meta.isExternal;
  if (insightFilter === 'needs-prep') return meta.prepStatus === 'ready';
  if (insightFilter === 'back-to-back') return !meta.isBackToBack;
  if (insightFilter === 'conflicts') return meta.conflictsWith.length === 0;
  return false;
}

// ── Root export ───────────────────────────────────────────────────────

export default function EventCard({ event, meta, isSelected, insightFilter, isPinned, onClick, onAskAI }: Props) {
  const past = !event.allDay && isPast(event.end);
  const dimmed = applyFilterDim(meta, insightFilter);

  const conflictHighlight = insightFilter === 'conflicts' && meta.conflictsWith.length > 0;
  const wrapCls = `${dimmed ? 'opacity-30 pointer-events-none' : ''} ${conflictHighlight ? 'ring-1 ring-[var(--error)] rounded-xl' : ''}`;

  const cardProps = { event, meta, isSelected, past, isPinned, onClick, onAskAI };

  return (
    <div className={wrapCls}>
      {meta.eventType === 'focus'
        ? <FocusCard {...cardProps} />
        : meta.isImportant
          ? <ImportantCard {...cardProps} />
          : (meta.prepStatus === 'none' || meta.prepStatus === 'suggested') && !past
            ? <PrepNeededCard {...cardProps} />
            : <RoutineCard {...cardProps} />
      }
    </div>
  );
}
