import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarView, EventFilter } from '../../hooks/useCalendarPage';

interface Props {
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  filter: EventFilter;
  onFilterChange: (f: EventFilter) => void;
  rangeLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

const VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'grid', label: 'Grid' },
  { value: 'agenda', label: 'Agenda' },
];

const FILTER_OPTIONS: { value: EventFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'team', label: 'Team' },
];

export default function CalendarToolbar({ view, onViewChange, filter, onFilterChange, rangeLabel, onPrev, onNext, onToday }: Props) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
      {/* Left: date navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToday}
          className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[var(--border2)] bg-[var(--surface2)] text-[var(--text-dim)] hover:bg-[var(--surface3)] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          Today
        </button>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onPrev}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={onNext}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="text-[14px] font-semibold text-[var(--text)] ml-1">
          {rangeLabel}
        </span>
      </div>

      {/* Right: filter + view switcher */}
      <div className="flex items-center gap-3">
        {/* Event filter */}
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border2)] bg-[var(--surface1)] p-0.5">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onFilterChange(opt.value)}
              className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors cursor-pointer ${
                filter === opt.value
                  ? 'bg-[var(--surface3)] text-[var(--text)] shadow-sm'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* View switcher */}
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border2)] bg-[var(--surface1)] p-0.5">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onViewChange(opt.value)}
              className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors cursor-pointer ${
                view === opt.value
                  ? 'bg-[var(--surface3)] text-[var(--text)] shadow-sm'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
