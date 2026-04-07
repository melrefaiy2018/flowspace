import { useState } from 'react';
import { Calendar, Video, Sparkles, CheckSquare, ChevronDown, ChevronRight, User, UsersRound } from 'lucide-react';
import type { CalendarEvent, WorkspaceStats } from '../services/api';
import type { EventFilter } from '../hooks/useCalendarPage';

interface Props {
  events: CalendarEvent[];
  stats: WorkspaceStats | null;
  onAction: (prompt: string, autoSend: boolean) => void;
  filter?: EventFilter;
  onFilterChange?: (f: EventFilter) => void;
  kanbanMode?: boolean;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function isNow(start: string, end: string): boolean {
  const now = Date.now();
  return new Date(start).getTime() <= now && new Date(end).getTime() > now;
}

function isPast(end: string): boolean {
  return new Date(end).getTime() < Date.now();
}

function isWithinHours(iso: string, hours: number): boolean {
  const diff = new Date(iso).getTime() - Date.now();
  return diff > 0 && diff < hours * 60 * 60 * 1000;
}

function EventRow({ ev, onAction, highlight }: { ev: CalendarEvent; onAction: Props['onAction']; highlight?: 'now' | 'soon' }) {
  return (
    <div
      className="group flex items-center gap-3 rounded-[18px] border border-white/5 bg-white/[0.03] px-3 py-3 transition-all duration-200 hover:border-white/10 hover:bg-white/[0.05]"
      style={highlight === 'now' ? {
        background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.13), rgba(255,255,255,0.03))',
        borderColor: 'rgba(var(--accent-rgb), 0.22)',
      } : highlight === 'soon' ? {
        background: 'linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(255,255,255,0.03))',
        borderColor: 'rgba(245, 158, 11, 0.22)',
      } : {}}
    >
      <span className="text-[11px] font-mono text-[var(--text-faint)] w-[60px] shrink-0">
        {timeLabel(ev.start)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--text)] truncate">{ev.summary}</div>
        <div className="text-[10px] text-[var(--text-faint)] flex items-center gap-1">
          {ev.attendeeCount > 0 && <span>{ev.attendeeCount} attendees</span>}
          {highlight === 'now' && <span className="text-[var(--accent)] font-medium ml-1">Now</span>}
          {highlight === 'soon' && <span className="text-[var(--amber)] font-medium ml-1">Soon</span>}
        </div>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {ev.hangoutLink && (
          <a
            href={ev.hangoutLink}
            target="_blank"
            rel="noopener"
            className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--accent-dim)] flex items-center justify-center text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-colors"
            title="Join meeting"
          >
            <Video size={11} />
          </a>
        )}
        <button
          onClick={() => onAction(`Prepare for my meeting: ${ev.summary}`, true)}
          className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--purple-dim)] flex items-center justify-center text-[var(--purple)] hover:bg-[var(--purple)] hover:text-black transition-colors cursor-pointer"
          title="Prep with AI"
        >
          <Sparkles size={11} />
        </button>
      </div>
    </div>
  );
}

export default function TodayPanel({ events, stats, onAction, filter = 'all', onFilterChange, kanbanMode = false }: Props) {
  const [showAll, setShowAll] = useState(false);

  // Split events into categories
  const now = events.filter((ev) => isNow(ev.start, ev.end));
  const past = events.filter((ev) => isPast(ev.end) && !isNow(ev.start, ev.end));
  const upcoming = events.filter((ev) => !isPast(ev.end) && !isNow(ev.start, ev.end));
  const soon = upcoming.filter((ev) => isWithinHours(ev.start, 2));
  const later = upcoming.filter((ev) => !isWithinHours(ev.start, 2));

  // Show: now + soon + first 3 of later (unless expanded)
  const MAX_LATER = 3;
  const visibleLater = showAll ? later : later.slice(0, MAX_LATER);
  const hiddenCount = later.length - MAX_LATER;

  return (
    <div className={kanbanMode ? 'flex flex-col' : 'home-panel home-panel-secondary overflow-hidden flex flex-col'}>
      {!kanbanMode && (
        <div className="home-section-header">
          <div>
            <div className="home-section-kicker">Fallback agenda</div>
            <h3 className="home-section-title">Today</h3>
          </div>
          <div className="flex items-center gap-3">
            {onFilterChange && (
              <div className="flex rounded-lg bg-[var(--surface1)] p-0.5">
                {(['all', 'mine', 'team'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => onFilterChange(f)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                      filter === f
                        ? f === 'mine'
                          ? 'bg-[var(--accent-dim)] text-[var(--accent)] shadow-sm'
                          : f === 'team'
                            ? 'bg-[var(--purple-dim)] text-[var(--purple)] shadow-sm'
                            : 'bg-[var(--surface2)] text-[var(--text-dim)] shadow-sm'
                        : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
                    }`}
                  >
                    {f === 'mine' && <User size={9} />}
                    {f === 'team' && <UsersRound size={9} />}
                    {f === 'all' ? 'All' : f === 'mine' ? 'Mine' : 'Team'}
                  </button>
                ))}
              </div>
            )}
            <span className="font-mono text-[11px] text-[var(--text-faint)]">
              {events.length} event{events.length !== 1 ? 's' : ''} &middot; {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>
      )}

      {/* Events */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[22px] border border-dashed border-[var(--border)] bg-white/[0.02] py-10 text-[var(--text-faint)]">
            <Calendar size={24} className="mb-2 opacity-40" />
            <span className="text-[12px]">Clear day ahead</span>
          </div>
        ) : (
          <>
            {/* Currently happening */}
            {now.map((ev) => (
              <EventRow key={ev.id} ev={ev} onAction={onAction} highlight="now" />
            ))}

            {/* Coming up within 2 hours */}
            {soon.map((ev) => (
              <EventRow key={ev.id} ev={ev} onAction={onAction} highlight="soon" />
            ))}

            {/* Later today */}
            {visibleLater.map((ev) => (
              <EventRow key={ev.id} ev={ev} onAction={onAction} />
            ))}

            {/* Expand/collapse for rest */}
            {hiddenCount > 0 && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <ChevronRight size={11} />
                {hiddenCount} more event{hiddenCount !== 1 ? 's' : ''} later today
              </button>
            )}

            {showAll && later.length > MAX_LATER && (
              <button
                onClick={() => setShowAll(false)}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <ChevronDown size={11} />
                Show less
              </button>
            )}

            {/* Past events summary */}
            {past.length > 0 && (
              <div className="px-3 py-1.5 text-[10px] text-[var(--text-faint)] italic">
                {past.length} event{past.length !== 1 ? 's' : ''} earlier today
              </div>
            )}
          </>
        )}
      </div>

      {/* Tasks summary */}
      {stats && stats.openTasks > 0 && (
        <div className="border-t border-[var(--section-divider)] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-dim)]">
            <CheckSquare size={12} className="text-[var(--amber)]" />
            {stats.openTasks} open task{stats.openTasks !== 1 ? 's' : ''}
          </div>
          <button
            onClick={() => onAction('List my open tasks', true)}
            className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
          >
            Review
          </button>
        </div>
      )}
    </div>
  );
}
