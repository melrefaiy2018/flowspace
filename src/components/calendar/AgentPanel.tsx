import DOMPurify from 'dompurify';
import { Sparkles, FileText, Video, ExternalLink, Users, Clock, ArrowRight, MessageSquare, FileEdit, X } from 'lucide-react';
import type { CalendarEventDetail, DayEvent } from '../../services/api';
import type { Conversation } from '../../context/ChatContext';
import type { EventMeta } from './calendarUtils';
import { formatTime, formatTimeUntil, formatDuration, getNeedsPrepEvents } from './calendarUtils';
import { AGENT_NAME } from '../../lib/branding';

interface Props {
  selectedEvent: CalendarEventDetail | null;
  aiInsight?: DayEvent;
  events: CalendarEventDetail[];
  eventMetas: Map<string, EventMeta>;
  onAskAI: (prompt: string) => void;
  onSelectEvent: (id: string | null) => void;
  onPrepareEvent: (event: CalendarEventDetail) => void;
  findConversationByEventId: (eventId: string) => Conversation | null;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}
const AVATAR_COLORS = ['#7c3aed', '#0369a1', '#b45309', '#0f766e', '#be185d', '#4338ca', '#c2410c'];

// ── Recommended Action Card — the main copilot surface ────────────────

interface RecommendedCardProps {
  event: CalendarEventDetail;
  meta: EventMeta;
  aiInsight?: DayEvent;
  onAskAI: (prompt: string) => void;
  onSelect: () => void;
  onPrepareEvent: (event: CalendarEventDetail) => void;
  existingConv: Conversation | null;
}

function RecommendedCard({ event, meta, aiInsight, onAskAI, onSelect, onPrepareEvent, existingConv }: RecommendedCardProps) {
  const timeLabel = meta.timeUntilStart > 0 ? formatTimeUntil(meta.timeUntilStart) : 'In progress';
  const hasBrief = meta.prepStatus === 'ready';
  const needsPrep = meta.prepStatus === 'none' || meta.prepStatus === 'suggested';
  const linkedDocs = aiInsight?.linked_docs ?? [];

  // "Why it matters now" — one short reason
  function whyNow(): string {
    if (meta.conflictsWith.length > 0) return 'Scheduling conflict';
    if (meta.isImportant && needsPrep) return 'High priority · No brief yet';
    if (meta.isImportant) return 'High priority meeting';
    if (meta.isExternal && needsPrep) return 'External · Needs preparation';
    if (needsPrep) return 'No preparation started';
    if (hasBrief) return 'Brief ready to review';
    return 'Coming up soon';
  }

  return (
    <div className="mx-4 mt-4 mb-1 rounded-2xl border border-[var(--border)] bg-[var(--surface1)] overflow-hidden">
      {/* Header band */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2 border-b border-[var(--border2)]">
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} className="text-[var(--purple)]" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">
            Recommended action
          </span>
        </div>
        <span className={`text-[10px] font-semibold ${meta.timeUntilStart < 2 * 60 * 60 * 1000 && meta.timeUntilStart > 0 ? 'text-[var(--warn)]' : 'text-[var(--accent)]'}`}>
          {timeLabel}
        </span>
      </div>

      {/* Event info */}
      <button onClick={onSelect} className="w-full text-left px-4 py-3 cursor-pointer hover:bg-[var(--surface2)] transition-colors">
        <div className="text-[15px] font-bold text-[var(--text)] leading-snug mb-1">
          {event.summary}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)] mb-1.5">
          <Clock size={9} />
          {formatTime(event.start)} · {formatDuration(event.start, event.end)}
          {meta.isExternal && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--surface3)] text-[var(--text-faint)]">Ext</span>
          )}
        </div>
        {/* Why it matters */}
        <div className={`text-[11px] font-medium ${
          needsPrep ? 'text-[var(--warn)]' : hasBrief ? 'text-[var(--purple)]' : 'text-[var(--text-faint)]'
        }`}>
          {whyNow()}
        </div>
      </button>

      {/* Context signals */}
      {(linkedDocs.length > 0 || aiInsight?.prep_note || event.attendees.length > 0) && (
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {aiInsight?.prep_note && (
            <p className="text-[11px] text-[var(--text-dim)] italic bg-[var(--purple-dim)]/20 rounded-lg px-3 py-2 leading-relaxed">
              {aiInsight.prep_note}
            </p>
          )}
          {linkedDocs.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {linkedDocs.slice(0, 3).map((doc, i) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-[10px] text-[var(--blue)] hover:underline"
                >
                  <FileText size={9} />
                  {doc.name}
                </a>
              ))}
              {linkedDocs.length > 3 && (
                <span className="text-[10px] text-[var(--text-faint)]">+{linkedDocs.length - 3} docs</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Primary CTA */}
      <div className="px-4 pb-4">
        <button
          onClick={() => onPrepareEvent(event)}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--purple-dim)] text-[var(--purple)] text-[12px] font-semibold hover:bg-[var(--purple)] hover:text-white transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            {existingConv ? <MessageSquare size={12} /> : <Sparkles size={12} />}
            {existingConv ? 'Resume prep' : hasBrief ? 'Review prep brief' : 'Prepare this meeting'}
          </span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Prep Queue ────────────────────────────────────────────────────────

interface PrepQueueProps {
  events: CalendarEventDetail[];
  metas: Map<string, EventMeta>;
  // skip the first event (shown in RecommendedCard)
  skipId?: string;
  onSelect: (id: string) => void;
  onAskAI: (prompt: string) => void;
}

function PrepQueue({ events, metas, skipId, onSelect, onAskAI }: PrepQueueProps) {
  const items = events.filter((e) => e.id !== skipId).slice(0, 4);
  if (items.length === 0) return null;

  return (
    <div className="px-4 py-3.5 border-t border-[var(--border)]">
      <h3 className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-2.5">
        Also needs prep
      </h3>
      <div className="flex flex-col gap-1.5">
        {items.map((ev) => {
          const meta = metas.get(ev.id);
          if (!meta) return null;
          return (
            <div key={ev.id} className="flex items-center gap-2">
              <button
                onClick={() => onSelect(ev.id)}
                className="flex-1 text-left min-w-0 py-1"
              >
                <div className="text-[11px] font-medium text-[var(--text-dim)] truncate">{ev.summary}</div>
                <div className="text-[9px] text-[var(--text-faint)]">
                  {formatTime(ev.start)} · {formatTimeUntil(meta.timeUntilStart)}
                  {meta.isExternal ? ' · Ext' : ''}
                </div>
              </button>
              <button
                onClick={() => onAskAI(`Prepare for my meeting: ${ev.summary}`)}
                className="shrink-0 flex items-center gap-0.5 px-2 py-1 rounded-lg text-[9px] font-medium bg-[var(--purple-dim)] text-[var(--purple)] hover:bg-[var(--purple)] hover:text-white transition-colors cursor-pointer"
              >
                <Sparkles size={8} />
                Prep
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Context Bundle — for selected event ──────────────────────────────

interface ContextBundleProps {
  event: CalendarEventDetail;
  meta: EventMeta;
  aiInsight?: DayEvent;
  onAskAI: (prompt: string) => void;
  onClose: () => void;
  onPrepareEvent: (event: CalendarEventDetail) => void;
  existingConv: Conversation | null;
}

function ContextBundle({ event, meta, aiInsight, onAskAI, onClose, onPrepareEvent, existingConv }: ContextBundleProps) {
  const gcalUrl = `https://calendar.google.com/calendar/event?eid=${btoa(`${event.id} ${event.calendarId}`)}`;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-start gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-bold text-[var(--text)] leading-snug">{event.summary}</h2>
            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--text-faint)]">
              <Clock size={9} />
              {formatTime(event.start)} · {formatDuration(event.start, event.end)}
              {meta.isExternal && <span className="px-1.5 py-0.5 rounded bg-[var(--surface3)]">Ext</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:bg-[var(--surface2)] transition-colors cursor-pointer shrink-0"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {event.hangoutLink && (
            <a href={event.hangoutLink} target="_blank" rel="noopener"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors">
              <Video size={10} /> Join
            </a>
          )}
          <button
            onClick={() => onPrepareEvent(event)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--purple-dim)] text-[var(--purple)] hover:bg-[var(--purple)] hover:text-white transition-colors cursor-pointer">
            {existingConv ? <MessageSquare size={10} /> : <Sparkles size={10} />}
            {existingConv ? 'Resume' : 'Prepare'}
          </button>
          <a href={gcalUrl} target="_blank" rel="noopener"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--surface2)] text-[var(--text-faint)] hover:bg-[var(--surface3)] hover:text-[var(--text)] transition-colors">
            <ExternalLink size={10} /> Open
          </a>
        </div>
      </div>

      {/* AI Prep */}
      {aiInsight?.prep_note && (
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h4 className="text-[9px] font-semibold uppercase tracking-widest text-[var(--purple)] mb-2 flex items-center gap-1">
            <Sparkles size={9} /> AI Prep
          </h4>
          <p className="text-[12px] text-[var(--text-dim)] italic leading-relaxed bg-[var(--purple-dim)]/25 rounded-lg px-3 py-2">
            {aiInsight.prep_note}
          </p>
          {aiInsight.linked_docs && aiInsight.linked_docs.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {aiInsight.linked_docs.map((doc, i) => (
                <a key={i} href={doc.url} target="_blank" rel="noopener"
                  className="flex items-center gap-1.5 text-[11px] text-[var(--blue)] hover:underline">
                  <FileText size={10} /> {doc.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Attendees */}
      {event.attendees.length > 0 && (
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h4 className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-2 flex items-center gap-1">
            <Users size={9} /> Attendees ({event.attendees.length})
          </h4>
          <div className="flex flex-col gap-1.5">
            {event.attendees.slice(0, 5).map((a, i) => {
              const name = a.name ?? a.email;
              return (
                <div key={a.email} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                    style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                    {initials(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[var(--text)] truncate">{name}</div>
                    {a.name && <div className="text-[9px] text-[var(--text-faint)] truncate">{a.email}</div>}
                  </div>
                  <span className="text-[9px] text-[var(--text-faint)] capitalize shrink-0">{a.responseStatus}</span>
                </div>
              );
            })}
            {event.attendees.length > 5 && <div className="text-[10px] text-[var(--text-faint)]">+{event.attendees.length - 5} more</div>}
          </div>
        </div>
      )}

      {/* Description */}
      {event.description && (
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h4 className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-1.5">Notes</h4>
          <div className="text-[11px] text-[var(--text-dim)] leading-relaxed break-words max-h-28 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(event.description) }} />
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3">
        <h4 className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-2">Actions</h4>
        <div className="flex flex-col gap-1.5">
          <button onClick={() => onPrepareEvent(event)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border2)] bg-[var(--surface1)] text-[11px] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer text-left">
            {existingConv
              ? <><MessageSquare size={11} className="text-[var(--purple)] shrink-0" /> Resume prep</>
              : <><Sparkles size={11} className="text-[var(--purple)] shrink-0" /> Prepare this meeting</>
            }
          </button>
          {event.attendees.length > 0 && (
            <button onClick={() => onAskAI(`Summarize recent email threads with ${event.attendees.map((a) => a.name ?? a.email).slice(0, 3).join(', ')}`)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border2)] bg-[var(--surface1)] text-[11px] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer text-left">
              <MessageSquare size={11} className="text-[var(--blue)] shrink-0" /> Summarize last thread
            </button>
          )}
          <button onClick={() => onAskAI(`Draft a follow-up email after: ${event.summary}`)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border2)] bg-[var(--surface1)] text-[11px] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer text-left">
            <FileEdit size={11} className="text-[var(--accent)] shrink-0" /> Draft follow-up
          </button>
          <button onClick={() => onAskAI(`Open a chat workspace for: ${event.summary} — include attendee context, recent emails, and prep notes.`)}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--border2)] bg-[var(--surface1)] text-[11px] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer text-left">
            <span className="flex items-center gap-2">
              <ArrowRight size={11} className="text-[var(--text-faint)] shrink-0" /> Continue in chat
            </span>
            <ArrowRight size={9} className="text-[var(--text-faint)] shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────

export default function AgentPanel({ selectedEvent, aiInsight, events, eventMetas, onAskAI, onSelectEvent, onPrepareEvent, findConversationByEventId }: Props) {
  const needsPrepEvents = getNeedsPrepEvents(events, eventMetas);
  const selectedMeta = selectedEvent ? eventMetas.get(selectedEvent.id) : undefined;

  // Top recommended event — most important upcoming needing prep (or next up)
  const recommendedEvent = (() => {
    const upcoming = events
      .filter((ev) => {
        if (ev.allDay) return false;
        const meta = eventMetas.get(ev.id);
        return meta && meta.timeUntilStart > -30 * 60 * 1000;
      })
      .sort((a, b) => {
        const ma = eventMetas.get(a.id)!;
        const mb = eventMetas.get(b.id)!;
        // Important + needs prep first, then important, then needs prep, then chronological
        const scoreA = (ma.isImportant ? 0 : 2) + (ma.prepStatus !== 'ready' ? 0 : 1);
        const scoreB = (mb.isImportant ? 0 : 2) + (mb.prepStatus !== 'ready' ? 0 : 1);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return new Date(a.start).getTime() - new Date(b.start).getTime();
      });
    return upcoming[0] ?? null;
  })();

  const recommendedMeta = recommendedEvent ? eventMetas.get(recommendedEvent.id) : undefined;
  const recommendedExistingConv = recommendedEvent ? findConversationByEventId(recommendedEvent.id) : null;
  const selectedExistingConv = selectedEvent ? findConversationByEventId(selectedEvent.id) : null;

  return (
    <div className="w-[300px] shrink-0 border-l border-[var(--border)] bg-[var(--bg)] flex flex-col h-full overflow-hidden">
      {/* Panel label */}
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-1.5 shrink-0">
        <Sparkles size={11} className="text-[var(--purple)]" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">{AGENT_NAME}</span>
      </div>

      {selectedEvent && selectedMeta ? (
        <ContextBundle
          event={selectedEvent}
          meta={selectedMeta}
          aiInsight={aiInsight}
          onAskAI={onAskAI}
          onClose={() => onSelectEvent(null)}
          onPrepareEvent={onPrepareEvent}
          existingConv={selectedExistingConv}
        />
      ) : (
        <div className="flex-1 flex flex-col overflow-y-auto">
          {recommendedEvent && recommendedMeta ? (
            <>
              <RecommendedCard
                event={recommendedEvent}
                meta={recommendedMeta}
                aiInsight={undefined}
                onAskAI={onAskAI}
                onSelect={() => onSelectEvent(recommendedEvent.id)}
                onPrepareEvent={onPrepareEvent}
                existingConv={recommendedExistingConv}
              />
              <PrepQueue
                events={needsPrepEvents}
                metas={eventMetas}
                skipId={recommendedEvent.id}
                onSelect={onSelectEvent}
                onAskAI={onAskAI}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center">
              <div className="w-10 h-10 rounded-full bg-[var(--purple-dim)] flex items-center justify-center mb-3">
                <Sparkles size={16} className="text-[var(--purple)]" />
              </div>
              <p className="text-[12px] font-medium text-[var(--text-dim)] mb-1">All clear</p>
              <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
                No prep needed for upcoming meetings.
              </p>
              <button
                onClick={() => onAskAI('What do I have coming up this week that needs preparation?')}
                className="mt-4 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-[var(--purple-dim)] text-[var(--purple)] hover:bg-[var(--purple)] hover:text-white transition-colors cursor-pointer"
              >
                <Sparkles size={10} /> Ask about this week
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
