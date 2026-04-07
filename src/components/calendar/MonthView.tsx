import { useMemo } from 'react';
import type { CalendarEventDetail } from '../../services/api';

interface Props {
  events: CalendarEventDetail[];
  currentDate: Date;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  onDayClick: (date: Date) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const result = new Date(d);
  result.setDate(result.getDate() - diff);
  return new Date(result.getFullYear(), result.getMonth(), result.getDate());
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const MAX_VISIBLE_EVENTS = 3;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MonthView({ events, currentDate, selectedEventId, onSelectEvent, onDayClick }: Props) {
  const currentMonth = currentDate.getMonth();

  // Build 6-week grid
  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(currentDate));
    const result: Date[][] = [];
    let cursor = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(cursor));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
      result.push(week);
    }
    return result;
  }, [currentDate.getFullYear(), currentDate.getMonth()]);

  // Group events by date string
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventDetail[]>();
    for (const ev of events) {
      const d = new Date(ev.start);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const existing = map.get(key) ?? [];
      map.set(key, [...existing, ev]);
    }
    return map;
  }, [events]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* Day name headers */}
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center py-2 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
            {name}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex-1 grid grid-rows-6">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-[var(--border)] min-h-[100px]">
            {week.map((day, di) => {
              const dateKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
              const dayEvents = eventsByDate.get(dateKey) ?? [];
              const isCurrentMonth = day.getMonth() === currentMonth;
              const today = isToday(day);

              return (
                <div
                  key={di}
                  className={`border-l border-[var(--border)] first:border-l-0 p-1 cursor-pointer hover:bg-[var(--surface2)]/50 transition-colors ${
                    !isCurrentMonth ? 'opacity-40' : ''
                  } ${today ? 'bg-[var(--accent-dim)]/15' : ''}`}
                  onClick={() => onDayClick(day)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[12px] font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                        today
                          ? 'bg-[var(--accent)] text-white'
                          : isCurrentMonth
                            ? 'text-[var(--text)]'
                            : 'text-[var(--text-faint)]'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {dayEvents.length > MAX_VISIBLE_EVENTS && (
                      <span className="text-[9px] text-[var(--text-faint)]">
                        +{dayEvents.length - MAX_VISIBLE_EVENTS}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, MAX_VISIBLE_EVENTS).map((ev) => (
                      <button
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); onSelectEvent(ev.id); }}
                        className={`w-full text-left px-1 py-0.5 rounded text-[10px] truncate transition-colors cursor-pointer ${
                          selectedEventId === ev.id
                            ? 'bg-[var(--accent)] text-white'
                            : 'bg-[var(--surface3)] text-[var(--text-dim)] hover:bg-[var(--surface2)]'
                        }`}
                      >
                        {ev.allDay ? ev.summary : `${formatTime(ev.start)} ${ev.summary}`}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
