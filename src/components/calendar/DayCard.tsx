import type { DayLoad } from './calendarUtils';

interface Props {
  dayLoad: DayLoad;
  isSelected: boolean;
  isToday: boolean;
  onClick: () => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Semantic day state — one clear label per day
function getDayState(dl: DayLoad): { label: string; labelCls: string; barCls: string } {
  if (dl.eventCount === 0) return { label: 'Free', labelCls: 'text-[var(--text-faint)]', barCls: 'bg-[var(--border2)]' };
  if (dl.isOverloaded) return { label: 'Heavy', labelCls: 'text-[var(--error)]', barCls: 'bg-[var(--error)]' };
  if (dl.hasExternalMeeting && dl.hasImportantMeeting) return { label: 'Key day', labelCls: 'text-[var(--warn)]', barCls: 'bg-[var(--warn)]' };
  if (dl.hasFocusBlock && dl.eventCount <= 2) return { label: 'Focus', labelCls: 'text-[var(--accent)]', barCls: 'bg-[var(--accent)]' };
  if (dl.eventCount >= 4) return { label: 'Busy', labelCls: 'text-[var(--text-dim)]', barCls: 'bg-[var(--text-faint)]' };
  return { label: `${dl.eventCount} mtg`, labelCls: 'text-[var(--text-faint)]', barCls: 'bg-[var(--text-faint)]/50' };
}

// Single horizontal bar whose fill encodes load — no AM/PM breakdown to reduce noise
function LoadBar({ load, barCls }: { load: number; barCls: string }) {
  const pct = Math.min(100, Math.round(load * 100));
  return (
    <div className="h-[3px] w-full rounded-full bg-[var(--surface3)]">
      <div
        className={`h-full rounded-full transition-all duration-300 ${barCls}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// Overall day load — morning + afternoon averaged
function overallLoad(dl: DayLoad): number {
  return Math.max(dl.morningLoad, dl.middayLoad, dl.afternoonLoad);
}

export default function DayCard({ dayLoad, isSelected, isToday, onClick }: Props) {
  const dayName = DAY_NAMES[dayLoad.date.getDay()];
  const dayNum = dayLoad.date.getDate();
  const { label, labelCls, barCls } = getDayState(dayLoad);
  const load = overallLoad(dayLoad);

  return (
    <button
      onClick={onClick}
      aria-label={`${dayName} ${dayNum}, ${label}`}
      className={`w-full text-left rounded-lg border px-2.5 py-2 transition-all duration-150 cursor-pointer ${
        isSelected
          ? 'bg-[var(--accent-dim)]/20 border-[var(--accent-border)]'
          : isToday
            ? 'bg-[var(--surface2)] border-[var(--border)]'
            : 'bg-[var(--surface1)] border-transparent hover:bg-[var(--surface2)] hover:border-[var(--border2)]'
      }`}
    >
      {/* Day name + number */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-baseline gap-1">
          <span className={`text-[9px] font-semibold uppercase tracking-wider ${
            isToday ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'
          }`}>
            {dayName}
          </span>
          <span className={`text-[14px] font-bold leading-none ${
            isToday ? 'text-[var(--accent)]' : isSelected ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
          }`}>
            {dayNum}
          </span>
        </div>
        {/* Single semantic label — no icon cluster */}
        <span className={`text-[9px] font-medium ${labelCls}`}>{label}</span>
      </div>

      {/* Single load bar */}
      <LoadBar load={load} barCls={barCls} />
    </button>
  );
}
