import { useMemo } from 'react';
import type { CalendarEventDetail } from '../../services/api';
import type { DateRange } from '../../hooks/useCalendarPage';
import TimeGrid, { timeToY, getHourHeight } from './TimeGrid';
import EventBlock from './EventBlock';

interface Props {
  events: CalendarEventDetail[];
  dateRange: DateRange;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  onSlotClick?: (date: Date, hour: number) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function getDayIndex(eventStart: Date, weekStart: Date): number {
  const diff = Math.floor((eventStart.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, Math.min(6, diff));
}

interface PositionedEvent {
  event: CalendarEventDetail;
  dayIndex: number;
  top: number;
  height: number;
  // For overlapping events
  column: number;
  totalColumns: number;
}

function positionEvents(events: CalendarEventDetail[], weekStart: Date, startHour: number): PositionedEvent[] {
  // Group by day
  const byDay: Map<number, CalendarEventDetail[]> = new Map();
  for (const ev of events) {
    if (ev.allDay) continue;
    const evStart = new Date(ev.start);
    const dayIdx = getDayIndex(evStart, weekStart);
    const existing = byDay.get(dayIdx) ?? [];
    byDay.set(dayIdx, [...existing, ev]);
  }

  const positioned: PositionedEvent[] = [];

  for (const [dayIndex, dayEvents] of byDay) {
    // Sort by start time, then by duration (longer first)
    const sorted = [...dayEvents].sort((a, b) => {
      const diff = new Date(a.start).getTime() - new Date(b.start).getTime();
      if (diff !== 0) return diff;
      return (new Date(b.end).getTime() - new Date(b.start).getTime()) -
             (new Date(a.end).getTime() - new Date(a.start).getTime());
    });

    // Greedy column assignment for overlapping events
    const columns: { end: number }[] = [];

    for (const ev of sorted) {
      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end);
      const top = timeToY(evStart.getHours(), evStart.getMinutes(), startHour);
      const bottom = timeToY(evEnd.getHours(), evEnd.getMinutes(), startHour);
      const height = Math.max(bottom - top, 22);
      const evStartMs = evStart.getTime();

      // Find first column where event fits
      let col = 0;
      while (col < columns.length && columns[col].end > evStartMs) {
        col++;
      }
      if (col >= columns.length) {
        columns.push({ end: evEnd.getTime() });
      } else {
        columns[col] = { end: evEnd.getTime() };
      }

      positioned.push({
        event: ev,
        dayIndex,
        top,
        height,
        column: col,
        totalColumns: 0, // computed in second pass
      });
    }

    // Second pass: assign totalColumns
    const totalCols = columns.length;
    for (const p of positioned) {
      if (p.dayIndex === dayIndex) {
        p.totalColumns = totalCols;
      }
    }
  }

  return positioned;
}

export default function WeekView({ events, dateRange, selectedEventId, onSelectEvent, onSlotClick }: Props) {
  const startHour = 0;
  const endHour = 24;
  const weekStart = dateRange.start;

  const headers = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return {
        label: `${dayNames[d.getDay()]} ${d.getDate()}`,
        date: new Date(d),
        isToday: isToday(d),
      };
    });
  }, [weekStart.toISOString()]);

  const allDayEvents = useMemo(
    () => events.filter((ev) => ev.allDay),
    [events]
  );

  const positioned = useMemo(
    () => positionEvents(events, weekStart, startHour),
    [events, weekStart.toISOString(), startHour]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* All-day events strip */}
      {allDayEvents.length > 0 && (
        <div className="flex border-b border-[var(--border)] bg-[var(--surface1)]">
          <div className="w-14 shrink-0 flex items-center justify-end pr-2">
            <span className="text-[9px] text-[var(--text-faint)]">ALL DAY</span>
          </div>
          <div className="flex-1 flex gap-1 py-1.5 px-1 overflow-x-auto">
            {allDayEvents.map((ev) => (
              <button
                key={ev.id}
                onClick={() => onSelectEvent(ev.id)}
                className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                  selectedEventId === ev.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--surface3)] text-[var(--text-dim)] hover:bg-[var(--surface2)]'
                }`}
              >
                {ev.summary}
              </button>
            ))}
          </div>
        </div>
      )}

      <TimeGrid
        columns={7}
        headers={headers}
        startHour={startHour}
        endHour={endHour}
        onSlotClick={onSlotClick}
      >
        {positioned.map((p) => {
          const colWidth = 100 / 7;
          const eventWidth = colWidth / p.totalColumns;
          const leftPct = p.dayIndex * colWidth + p.column * eventWidth;

          return (
            <EventBlock
              key={p.event.id}
              event={p.event}
              top={p.top}
              height={p.height}
              left={`${leftPct}%`}
              width={`calc(${eventWidth}% - 2px)`}
              isSelected={selectedEventId === p.event.id}
              onClick={() => onSelectEvent(p.event.id)}
            />
          );
        })}
      </TimeGrid>
    </div>
  );
}
