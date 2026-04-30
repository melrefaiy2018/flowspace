import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { CalendarView, EventFilter, InsightFilter } from '../../hooks/useCalendarPage';

interface Props {
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  filter: EventFilter;
  onFilterChange: (f: EventFilter) => void;
  insightFilter: InsightFilter;
  onInsightFilterChange: (f: InsightFilter) => void;
  rangeLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  lastFetchedAt: Date | null;
}

const VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'focus', label: 'Focus' },
  { value: 'prep', label: 'Prep' },
  { value: 'grid', label: 'Grid' },
  { value: 'agenda', label: 'Agenda' },
];

const FILTER_OPTIONS: { value: EventFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'team', label: 'Team' },
];

function formatFreshness(lastFetchedAt: Date | null): string {
  if (!lastFetchedAt) return 'Loading…';
  const diffMs = Date.now() - lastFetchedAt.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Updated just now';
  if (diffMin === 1) return 'Updated 1m ago';
  if (diffMin < 60) return `Updated ${diffMin}m ago`;
  return `Updated ${Math.floor(diffMin / 60)}h ago`;
}

export default function CalendarHeader({
  view,
  onViewChange,
  filter,
  onFilterChange,
  insightFilter,
  onInsightFilterChange,
  rangeLabel,
  onPrev,
  onNext,
  onToday,
  lastFetchedAt,
}: Props) {
  const isSemanticView = view === 'timeline' || view === 'focus' || view === 'prep';

  return (
    <div className="flex flex-col border-b border-[var(--border)] bg-[var(--bg)] shrink-0">
      {/* Main toolbar row */}
      <div className="flex items-center justify-between px-5 py-3">
        {/* Left: navigation */}
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
              aria-label="Previous period"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={onNext}
              aria-label="Next period"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <span className="text-[14px] font-semibold text-[var(--text)] ml-1">
            {rangeLabel}
          </span>

          {/* Active insight filter badge */}
          {insightFilter && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] border border-[var(--accent-border)] ml-1">
              {insightFilter.replace(/-/g, ' ')}
            </span>
          )}
        </div>

        {/* Right: scope filter + view switcher + freshness */}
        <div className="flex items-center gap-3">
          {/* Freshness */}
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-faint)] hidden md:flex">
            <RefreshCw size={9} />
            {formatFreshness(lastFetchedAt)}
          </span>

          {/* Scope filter */}
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

      {/* Quick filter chips — only shown in semantic views */}
      {isSemanticView && (
        <div className="flex items-center gap-1.5 px-5 pb-2.5 overflow-x-auto">
          <span className="text-[10px] text-[var(--text-faint)] shrink-0 mr-0.5">Filter:</span>
          {([
            { value: 'external', label: 'External' },
            { value: 'needs-prep', label: 'Needs prep' },
            { value: 'back-to-back', label: 'Back to back' },
            { value: 'focus-protected', label: 'Focus time' },
            { value: 'conflicts', label: 'Conflicts' },
          ] as const).map((chip) => (
            <button
              key={chip.value}
              onClick={() => onInsightFilterChange(insightFilter === chip.value ? null : chip.value)}
              aria-pressed={insightFilter === chip.value}
              className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer border ${
                insightFilter === chip.value
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent-border)]'
                  : 'bg-[var(--surface1)] text-[var(--text-faint)] border-[var(--border2)] hover:text-[var(--text-dim)] hover:border-[var(--border)]'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
