import DOMPurify from 'dompurify';
import { X, MapPin, Users, Video, ExternalLink, Sparkles, FileText, Clock, User, UsersRound, RotateCcw } from 'lucide-react';
import type { CalendarEventDetail } from '../../services/api';
import type { DayEvent } from '../../services/api';
import type { EventClassification } from '../../hooks/useEventClassification';

interface Props {
  event: CalendarEventDetail;
  /** AI-enriched data from briefing (matched by event_id) */
  aiInsight?: DayEvent;
  onClose: () => void;
  onAskAI?: (prompt: string) => void;
  classification?: EventClassification;
  onClassify?: (c: EventClassification) => void;
  hasOverride?: boolean;
  onClearOverride?: () => void;
}

function formatDateTime(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

const RESPONSE_LABELS: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Accepted', color: 'var(--accent)' },
  declined: { label: 'Declined', color: 'var(--error)' },
  tentative: { label: 'Maybe', color: 'var(--warn)' },
  needsAction: { label: 'Pending', color: 'var(--text-faint)' },
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

const AVATAR_COLORS = ['#7c3aed', '#0369a1', '#b45309', '#0f766e', '#be185d', '#4338ca', '#c2410c'];

export default function EventDetailPanel({ event, aiInsight, onClose, onAskAI, classification, onClassify, hasOverride, onClearOverride }: Props) {
  const gcalUrl = `https://calendar.google.com/calendar/event?eid=${btoa(`${event.id} ${event.calendarId}`)}`;

  return (
    <div className="w-[340px] shrink-0 border-l border-[var(--border)] bg-[var(--bg)] flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-[var(--border)]">
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--text)] leading-tight">
            {event.summary}
          </h3>
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--text-faint)]">
            <Clock size={11} />
            <span>{formatDateTime(event.start, event.allDay)}</span>
            {!event.allDay && (
              <span className="text-[var(--text-faint)]/50">({formatDuration(event.start, event.end)})</span>
            )}
          </div>
          <div className="text-[10px] text-[var(--text-faint)]/60 mt-0.5">
            {event.calendarName}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer shrink-0 ml-2"
        >
          <X size={14} />
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 px-4 py-3 border-b border-[var(--border)]">
        {event.hangoutLink && (
          <a
            href={event.hangoutLink}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors"
          >
            <Video size={12} />
            Join meeting
          </a>
        )}
        {onAskAI && (
          <button
            onClick={() => onAskAI(`Prepare for my meeting: ${event.summary} with ${event.attendees.map((a) => a.name ?? a.email).join(', ')}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--purple-dim)] text-[var(--purple)] hover:bg-[var(--purple)] hover:text-white transition-colors cursor-pointer"
          >
            <Sparkles size={12} />
            AI prep
          </button>
        )}
        <a
          href={gcalUrl}
          target="_blank"
          rel="noopener"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--surface2)] text-[var(--text-dim)] hover:bg-[var(--surface3)] hover:text-[var(--text)] transition-colors"
        >
          <ExternalLink size={12} />
          Open
        </a>
      </div>

      {/* Classification toggle */}
      {onClassify && classification && (
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Classify
            </h4>
            {hasOverride && onClearOverride && (
              <button
                onClick={onClearOverride}
                className="flex items-center gap-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
              >
                <RotateCcw size={9} />
                Reset
              </button>
            )}
          </div>
          <div className="flex rounded-lg bg-[var(--surface1)] p-0.5">
            <button
              onClick={() => onClassify('mine')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                classification === 'mine'
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)] shadow-sm'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
              }`}
            >
              <User size={11} />
              Mine
            </button>
            <button
              onClick={() => onClassify('team')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                classification === 'team'
                  ? 'bg-[var(--purple-dim)] text-[var(--purple)] shadow-sm'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
              }`}
            >
              <UsersRound size={11} />
              Team
            </button>
          </div>
          {event.recurring && (
            <p className="text-[10px] text-[var(--text-faint)]/60 mt-1.5 text-center">
              Applied to all instances of this event
            </p>
          )}
        </div>
      )}

      {/* AI Prep (from briefing) */}
      {aiInsight && (
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--purple)] mb-2 flex items-center gap-1">
            <Sparkles size={11} />
            AI Prep
          </h4>
          {aiInsight.prep_note && (
            <p className="text-[12px] text-[var(--text-dim)] italic bg-[var(--purple-dim)]/30 rounded-lg px-3 py-2 mb-2">
              {aiInsight.prep_note}
            </p>
          )}
          {aiInsight.linked_docs && aiInsight.linked_docs.length > 0 && (
            <div className="flex flex-col gap-1">
              {aiInsight.linked_docs.map((doc, i) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-1.5 text-[11px] text-[var(--blue)] hover:underline"
                >
                  <FileText size={10} />
                  {doc.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Location */}
      {event.location && (
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5 flex items-center gap-1">
            <MapPin size={11} />
            Location
          </h4>
          <p className="text-[12px] text-[var(--text-dim)]">{event.location}</p>
        </div>
      )}

      {/* Attendees */}
      {event.attendees.length > 0 && (
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2 flex items-center gap-1">
            <Users size={11} />
            Attendees ({event.attendees.length})
          </h4>
          <div className="flex flex-col gap-1.5">
            {event.attendees.map((a, i) => {
              const displayName = a.name ?? a.email;
              const resp = RESPONSE_LABELS[a.responseStatus] ?? RESPONSE_LABELS.needsAction;
              const bgColor = AVATAR_COLORS[i % AVATAR_COLORS.length];

              return (
                <div key={a.email} className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ background: bgColor }}
                  >
                    {initials(displayName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[var(--text)] truncate">{displayName}</div>
                    {a.name && (
                      <div className="text-[10px] text-[var(--text-faint)] truncate">{a.email}</div>
                    )}
                  </div>
                  <span
                    className="text-[9px] font-medium shrink-0"
                    style={{ color: resp.color }}
                  >
                    {resp.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Description */}
      {event.description && (
        <div className="px-4 py-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5">
            Description
          </h4>
          <div
            className="text-[12px] text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words"
            // Description may contain HTML from Google Calendar — sanitize to prevent XSS
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(event.description) }}
          />
        </div>
      )}
    </div>
  );
}
