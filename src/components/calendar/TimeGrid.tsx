import { useEffect, useRef } from 'react';

interface Props {
  /** Number of columns (1 for day view, 7 for week view) */
  columns: number;
  /** Column headers (day labels) */
  headers: { label: string; date: Date; isToday: boolean }[];
  /** Hour range to display */
  startHour?: number;
  endHour?: number;
  /** Render events positioned within the grid */
  children: React.ReactNode;
  /** Click on an empty time slot */
  onSlotClick?: (date: Date, hour: number) => void;
}

const HOUR_HEIGHT = 60; // px per hour

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

export function getHourHeight(): number {
  return HOUR_HEIGHT;
}

export function timeToY(hour: number, minute: number, startHour: number): number {
  return (hour - startHour + minute / 60) * HOUR_HEIGHT;
}

export default function TimeGrid({
  columns,
  headers,
  startHour = 0,
  endHour = 24,
  children,
  onSlotClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const totalHeight = hours.length * HOUR_HEIGHT;

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    const currentHour = now.getHours();
    const scrollTo = Math.max(0, (currentHour - startHour - 1) * HOUR_HEIGHT);
    scrollRef.current.scrollTop = scrollTo;
  }, [startHour]);

  // Current time indicator position
  const now = new Date();
  const nowY = timeToY(now.getHours(), now.getMinutes(), startHour);
  const showNowLine = now.getHours() >= startHour && now.getHours() < endHour;

  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0);
    const x = e.clientX - rect.left;
    const hour = Math.floor(y / HOUR_HEIGHT) + startHour;
    const colWidth = rect.width / columns;
    const colIndex = Math.floor(x / colWidth);
    if (colIndex >= 0 && colIndex < headers.length) {
      onSlotClick(headers[colIndex].date, hour);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div className="flex border-b border-[var(--border)] shrink-0">
        {/* Time gutter spacer */}
        <div className="w-14 shrink-0" />
        {headers.map((h, i) => (
          <div
            key={i}
            className={`flex-1 text-center py-2 border-l border-[var(--border)] ${
              h.isToday ? 'bg-[var(--accent-dim)]/30' : ''
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              {h.label.split(' ')[0]}
            </div>
            <div
              className={`text-[16px] font-semibold mt-0.5 ${
                h.isToday
                  ? 'text-[var(--accent)] bg-[var(--accent)] text-white w-7 h-7 rounded-full flex items-center justify-center mx-auto'
                  : 'text-[var(--text)]'
              }`}
            >
              {h.date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex relative" style={{ height: totalHeight }}>
          {/* Time labels gutter */}
          <div className="w-14 shrink-0 relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[10px] text-[var(--text-faint)] font-mono -translate-y-1/2"
                style={{ top: (hour - startHour) * HOUR_HEIGHT }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Grid area */}
          <div
            className="flex-1 relative cursor-pointer"
            onClick={handleGridClick}
          >
            {/* Hour lines */}
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 border-t border-[var(--border)]"
                style={{ top: (hour - startHour) * HOUR_HEIGHT }}
              />
            ))}

            {/* Column dividers */}
            {headers.slice(1).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-[var(--border)]"
                style={{ left: `${((i + 1) / columns) * 100}%` }}
              />
            ))}

            {/* Today column highlight */}
            {headers.map((h, i) =>
              h.isToday ? (
                <div
                  key={`today-${i}`}
                  className="absolute top-0 bottom-0 bg-[var(--accent-dim)]/10 pointer-events-none"
                  style={{
                    left: `${(i / columns) * 100}%`,
                    width: `${(1 / columns) * 100}%`,
                  }}
                />
              ) : null
            )}

            {/* Current time line */}
            {showNowLine && (
              <div
                className="absolute left-0 right-0 z-20 pointer-events-none"
                style={{ top: nowY }}
              >
                <div className="flex items-center">
                  <div className="w-2 h-2 rounded-full bg-[var(--error)] -ml-1" />
                  <div className="flex-1 h-[2px] bg-[var(--error)]" />
                </div>
              </div>
            )}

            {/* Event blocks (positioned by parent) */}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
