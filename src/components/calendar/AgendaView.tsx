import { Calendar, MapPin, Users, Video, Sparkles } from 'lucide-react';
import type { CalendarEventDetail } from '../../services/api';

interface Props {
  events: CalendarEventDetail[];
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  onAskAI?: (prompt: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateHeader(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

interface DayGroup {
  date: Date;
  events: CalendarEventDetail[];
}

function groupByDate(events: CalendarEventDetail[]): DayGroup[] {
  const map = new Map<string, { date: Date; events: CalendarEventDetail[] }>();

  for (const ev of events) {
    const d = new Date(ev.start);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) {
      map.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), events: [] });
    }
    map.get(key)!.events.push(ev);
  }

  return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function EventRow({
  event,
  isSelected,
  onClick,
  onAskAI,
}: {
  event: CalendarEventDetail;
  isSelected: boolean;
  onClick: () => void;
  onAskAI?: (prompt: string) => void;
}) {
  const past = !event.allDay && isPast(event.end);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left group flex gap-3 rounded-[18px] border px-4 py-3.5 transition-all duration-200 cursor-pointer ${
        isSelected
          ? 'border-[var(--accent-border)] bg-[var(--accent-dim)]/30'
          : past
            ? 'border-white/4 bg-white/[0.015] opacity-50'
            : 'border-white/6 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.05]'
      }`}
    >
      {/* Time column */}
      <div className="w-16 shrink-0 flex flex-col items-end pt-0.5">
        {event.allDay ? (
          <span className="text-[11px] font-medium text-[var(--accent)]">All day</span>
        ) : (
          <>
            <span className="font-mono text-[11px] text-[var(--text-faint)]">{formatTime(event.start)}</span>
            <span className="font-mono text-[10px] text-[var(--text-faint)]/60">{formatTime(event.end)}</span>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-[var(--text)] leading-tight truncate">
          {event.summary}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-faint)]">
          {event.attendees.length > 0 && (
            <span className="flex items-center gap-0.5">
              <Users size={10} />
              {event.attendees.length}
            </span>
          )}
          {event.location && (
            <span className="flex items-center gap-0.5 truncate max-w-[140px]">
              <MapPin size={10} />
              {event.location}
            </span>
          )}
          {event.hangoutLink && (
            <a
              href={event.hangoutLink}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-0.5 text-[var(--accent)] hover:underline"
            >
              <Video size={10} />
              Join
            </a>
          )}
          <span className="text-[var(--text-faint)]/50">{event.calendarName}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
        {onAskAI && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onAskAI(`Prepare for my meeting: ${event.summary}`); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAskAI(`Prepare for my meeting: ${event.summary}`); } }}
            className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--purple-dim)] flex items-center justify-center text-[var(--purple)] hover:bg-[var(--purple)] hover:text-black transition-colors cursor-pointer"
            title="Prep with AI"
          >
            <Sparkles size={11} />
          </div>
        )}
      </div>
    </button>
  );
}

export default function AgendaView({ events, selectedEventId, onSelectEvent, onAskAI }: Props) {
  const groups = groupByDate(events);

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-faint)] gap-2 py-16">
        <Calendar size={28} strokeWidth={1.5} />
        <p className="text-[13px]">No events in this range</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {groups.map((group) => (
        <div key={group.date.toISOString()} className="mb-6 last:mb-0">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`text-[13px] font-semibold ${
                isToday(group.date) ? 'text-[var(--accent)]' : 'text-[var(--text)]'
              }`}
            >
              {formatDateHeader(group.date)}
            </span>
            <span className="text-[11px] text-[var(--text-faint)]">
              {group.events.length} event{group.events.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {group.events.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                isSelected={selectedEventId === ev.id}
                onClick={() => onSelectEvent(ev.id)}
                onAskAI={onAskAI}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
