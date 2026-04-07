import { useMemo } from 'react';
import type { CalendarEventDetail } from '../../services/api';
import TimeGrid, { timeToY } from './TimeGrid';
import EventBlock from './EventBlock';

interface Props {
  events: CalendarEventDetail[];
  currentDate: Date;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  onSlotClick?: (date: Date, hour: number) => void;
}

function isToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

interface PositionedEvent {
  event: CalendarEventDetail;
  top: number;
  height: number;
  column: number;
  totalColumns: number;
}

function positionDayEvents(events: CalendarEventDetail[], startHour: number): PositionedEvent[] {
  const timed = events.filter((ev) => !ev.allDay);
  const sorted = [...timed].sort((a, b) => {
    const diff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (diff !== 0) return diff;
    return (new Date(b.end).getTime() - new Date(b.start).getTime()) -
           (new Date(a.end).getTime() - new Date(a.start).getTime());
  });

  const columns: { end: number }[] = [];
  const positioned: PositionedEvent[] = [];

  for (const ev of sorted) {
    const evStart = new Date(ev.start);
    const evEnd = new Date(ev.end);
    const top = timeToY(evStart.getHours(), evStart.getMinutes(), startHour);
    const bottom = timeToY(evEnd.getHours(), evEnd.getMinutes(), startHour);
    const height = Math.max(bottom - top, 22);
    const evStartMs = evStart.getTime();

    let col = 0;
    while (col < columns.length && columns[col].end > evStartMs) {
      col++;
    }
    if (col >= columns.length) {
      columns.push({ end: evEnd.getTime() });
    } else {
      columns[col] = { end: evEnd.getTime() };
    }

    positioned.push({ event: ev, top, height, column: col, totalColumns: 0 });
  }

  const totalCols = Math.max(1, columns.length);
  return positioned.map((p) => ({ ...p, totalColumns: totalCols }));
}

export default function DayView({ events, currentDate, selectedEventId, onSelectEvent, onSlotClick }: Props) {
  const startHour = 0;
  const endHour = 24;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const headers = useMemo(() => [{
    label: `${dayNames[currentDate.getDay()]} ${currentDate.getDate()}`,
    date: new Date(currentDate),
    isToday: isToday(currentDate),
  }], [currentDate.toISOString()]);

  const allDayEvents = useMemo(
    () => events.filter((ev) => ev.allDay),
    [events]
  );

  const positioned = useMemo(
    () => positionDayEvents(events, startHour),
    [events, startHour]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="flex border-b border-[var(--border)] bg-[var(--surface1)]">
          <div className="w-14 shrink-0 flex items-center justify-end pr-2">
            <span className="text-[9px] text-[var(--text-faint)]">ALL DAY</span>
          </div>
          <div className="flex-1 flex gap-1 py-1.5 px-1 flex-wrap">
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
        columns={1}
        headers={headers}
        startHour={startHour}
        endHour={endHour}
        onSlotClick={onSlotClick}
      >
        {positioned.map((p) => {
          const eventWidth = 100 / p.totalColumns;
          const leftPct = p.column * eventWidth;

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
