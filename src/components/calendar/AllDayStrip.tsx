import type { CalendarEventDetail } from '../../services/api';

interface Props {
  events: CalendarEventDetail[];
  onSelect: (id: string) => void;
  selectedEventId: string | null;
}

const MAX_VISIBLE = 4;

export default function AllDayStrip({ events, onSelect, selectedEventId }: Props) {
  if (events.length === 0) return null;

  const visible = events.slice(0, MAX_VISIBLE);
  const overflow = events.length - MAX_VISIBLE;

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-2">
      {visible.map((ev) => (
        <button
          key={ev.id}
          onClick={() => onSelect(ev.id)}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer border ${
            selectedEventId === ev.id
              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
              : 'bg-[var(--surface2)] text-[var(--text-dim)] border-[var(--border2)] hover:bg-[var(--surface3)] hover:text-[var(--text)]'
          }`}
        >
          {ev.summary}
        </button>
      ))}
      {overflow > 0 && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-[var(--text-faint)] bg-[var(--surface1)] border border-[var(--border2)]">
          +{overflow}
        </span>
      )}
    </div>
  );
}
