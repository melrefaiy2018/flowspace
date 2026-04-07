import { Clock, CalendarDays, AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import type { CalendarEventDetail } from '../../services/api';

interface Props {
  events: CalendarEventDetail[];
}

function computeInsights(events: CalendarEventDetail[]) {
  const timedEvents = events.filter((ev) => !ev.allDay);

  let totalMinutes = 0;
  for (const ev of timedEvents) {
    const ms = new Date(ev.end).getTime() - new Date(ev.start).getTime();
    totalMinutes += Math.max(0, Math.round(ms / 60000));
  }

  // Back-to-back: events within 15 min of each other
  let backToBack = 0;
  const sorted = [...timedEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].start).getTime() - new Date(sorted[i - 1].end).getTime();
    if (gap >= 0 && gap <= 15 * 60 * 1000) {
      backToBack++;
    }
  }

  return { totalMinutes, eventCount: timedEvents.length, backToBack };
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export default function ScheduleInsights({ events }: Props) {
  const insights = useMemo(() => computeInsights(events), [events]);

  if (insights.eventCount === 0) return null;

  return (
    <div className="flex items-center gap-4 px-5 py-2 border-b border-[var(--border)] bg-[var(--surface1)] text-[11px]">
      <span className="flex items-center gap-1.5 text-[var(--text-dim)]">
        <Clock size={11} />
        <span className="font-medium">{formatMinutes(insights.totalMinutes)}</span>
        <span className="text-[var(--text-faint)]">in meetings</span>
      </span>

      <span className="flex items-center gap-1.5 text-[var(--text-dim)]">
        <CalendarDays size={11} />
        <span className="font-medium">{insights.eventCount}</span>
        <span className="text-[var(--text-faint)]">events</span>
      </span>

      {insights.backToBack > 0 && (
        <span className="flex items-center gap-1 text-[var(--warn)]">
          <AlertTriangle size={11} />
          <span className="font-medium">{insights.backToBack}</span>
          <span>back-to-back</span>
        </span>
      )}
    </div>
  );
}
