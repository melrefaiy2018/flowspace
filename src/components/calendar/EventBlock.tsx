import { Video, Users } from 'lucide-react';
import type { CalendarEventDetail } from '../../services/api';

interface Props {
  event: CalendarEventDetail;
  top: number;
  height: number;
  left: string;
  width: string;
  isSelected: boolean;
  onClick: () => void;
}

const CALENDAR_COLORS: Record<string, string> = {
  '1': '#7986CB', // Lavender
  '2': '#33B679', // Sage
  '3': '#8E24AA', // Grape
  '4': '#E67C73', // Flamingo
  '5': '#F6BF26', // Banana
  '6': '#F4511E', // Tangerine
  '7': '#039BE5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3F51B5', // Blueberry
  '10': '#0B8043', // Basil
  '11': '#D50000', // Tomato
};

function eventColor(event: CalendarEventDetail): string {
  if (event.colorId && CALENDAR_COLORS[event.colorId]) {
    return CALENDAR_COLORS[event.colorId];
  }
  // Hash calendar name to get a consistent color
  let hash = 0;
  for (let i = 0; i < event.calendarName.length; i++) {
    hash = ((hash << 5) - hash + event.calendarName.charCodeAt(i)) | 0;
  }
  const keys = Object.keys(CALENDAR_COLORS);
  return CALENDAR_COLORS[keys[Math.abs(hash) % keys.length]];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function EventBlock({ event, top, height, left, width, isSelected, onClick }: Props) {
  const color = eventColor(event);
  const isShort = height < 40;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`absolute rounded-lg overflow-hidden text-left transition-all duration-150 cursor-pointer group ${
        isSelected
          ? 'ring-2 ring-[var(--accent)] shadow-lg z-10'
          : 'hover:brightness-110 hover:shadow-md hover:z-10'
      }`}
      style={{
        top,
        height: Math.max(height, 22),
        left,
        width,
        background: `${color}22`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className={`px-2 ${isShort ? 'py-0.5 flex items-center gap-2' : 'py-1.5'}`}>
        <div
          className={`font-medium truncate ${isShort ? 'text-[10px]' : 'text-[11px]'}`}
          style={{ color }}
        >
          {event.summary}
        </div>
        {!isShort && (
          <div className="text-[10px] text-[var(--text-faint)] mt-0.5 flex items-center gap-1.5">
            <span className="font-mono">{formatTime(event.start)}</span>
            {event.attendees.length > 0 && (
              <span className="flex items-center gap-0.5">
                <Users size={9} />
                {event.attendees.length}
              </span>
            )}
            {event.hangoutLink && (
              <Video size={9} className="text-[var(--accent)]" />
            )}
          </div>
        )}
      </div>
    </button>
  );
}
