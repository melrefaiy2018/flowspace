import type { DayLoad } from './calendarUtils';
import DayCard from './DayCard';

interface Props {
  dayLoads: DayLoad[];
  selectedDay: Date | null;
  onSelectDay: (d: Date | null) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

export default function WeekRhythm({ dayLoads, selectedDay, onSelectDay }: Props) {
  function handleClick(d: Date) {
    if (selectedDay && isSameDay(d, selectedDay)) {
      onSelectDay(null); // deselect
    } else {
      onSelectDay(d);
    }
  }

  return (
    <div className="w-[152px] shrink-0 border-r border-[var(--border)] flex flex-col gap-1.5 p-2.5 overflow-y-auto hidden lg:flex">
      <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-faint)] px-1 mb-0.5">
        Week
      </div>
      {dayLoads.map((dl) => (
        <DayCard
          key={dl.date.toISOString()}
          dayLoad={dl}
          isSelected={selectedDay ? isSameDay(dl.date, selectedDay) : false}
          isToday={isToday(dl.date)}
          onClick={() => handleClick(dl.date)}
        />
      ))}
    </div>
  );
}
