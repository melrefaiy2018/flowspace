import { useState } from 'react';
import { Calendar, FileText, ExternalLink, ChevronDown, User, UsersRound, Sparkles } from 'lucide-react';
import type { DayEvent } from '../services/api';
import type { EventFilter } from '../hooks/useCalendarPage';

interface Props {
  events: DayEvent[];
  onCreateDoc: (event: DayEvent) => void;
  filter?: EventFilter;
  onFilterChange?: (f: EventFilter) => void;
  onAskAgent?: () => void;
  kanbanMode?: boolean;
}

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

const AVATAR_COLORS = ['#7c3aed', '#0369a1', '#b45309', '#0f766e', '#be185d'];

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const GROUP_CONFIG = {
  needs_prep: { label: 'Needs prep', color: 'var(--amber)', dotColor: 'var(--amber)' },
  show_up: { label: 'Just show up', color: 'var(--text-dim)', dotColor: 'var(--text-faint)' },
  fyi: { label: 'FYI', color: 'var(--text-faint)', dotColor: 'var(--text-faint)' },
} as const;

function EventRow({ ev, creatingDoc, onCreateDoc }: { ev: DayEvent; creatingDoc: string | null; onCreateDoc: (ev: DayEvent) => void }) {
  const group = ev.priority_group || 'show_up';
  const dotColor = GROUP_CONFIG[group]?.dotColor ?? 'var(--text-faint)';

  return (
    <div
      className="mx-4 mb-3 flex gap-3 rounded-[22px] border border-white/6 bg-white/[0.03] px-4 py-4 last:mb-0 transition-transform hover:-translate-y-px"
      style={{ borderLeft: `3px solid ${dotColor}` }}
    >
      <div className="w-11 shrink-0 flex flex-col items-end gap-1 pt-0.5">
        <span className="font-mono text-[11px] text-[var(--text-faint)] whitespace-nowrap">
          {ev.time}
        </span>
        <div className="w-2 h-2 rounded-full ml-auto" style={{ background: dotColor }} />
      </div>

      <div className="flex-1 flex flex-col gap-[5px] min-w-0">
        <div className="text-[13px] font-semibold text-[var(--text)] leading-tight">
          {ev.title}
        </div>

        {ev.attendees.length > 0 && (
          <div className="flex items-center gap-1">
            {ev.attendees.slice(0, 3).map((name, i) => (
              <div
                key={i}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white border border-[var(--bg)]"
                style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                title={name}
              >
                {initials(name)}
              </div>
            ))}
            {ev.attendees.length > 3 && (
              <span className="text-[10px] text-[var(--text-faint)] ml-0.5">
                +{ev.attendees.length - 3} others
              </span>
            )}
          </div>
        )}

        {ev.prep_note && (
          <div className="rounded-[10px] border border-white/6 bg-black/20 px-3 py-2 text-[11px] italic leading-snug text-[var(--text-dim)]">
            {ev.prep_note}
          </div>
        )}

        {/* Linked docs */}
        {ev.linked_docs && ev.linked_docs.length > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {ev.linked_docs.map((doc, i) => (
              <a
                key={i}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium px-[8px] py-[3px] rounded-[5px] bg-[var(--surface2)] border border-[var(--border2)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)] transition-all"
              >
                <FileText size={10} />
                {doc.name}
                <ExternalLink size={9} className="ml-0.5 opacity-50" />
              </a>
            ))}
          </div>
        )}

        <div className="flex gap-[6px] mt-0.5">
          {ev.has_notes_doc ? (
            <button
              onClick={() => {
                const doc = ev.linked_docs?.find(d => d.type === 'notes') || ev.linked_docs?.[0];
                if (doc) window.open(doc.url, '_blank');
              }}
              className="flex items-center gap-1 text-[11px] font-medium px-[10px] py-1 rounded-[6px] bg-[var(--surface3)] border border-[var(--border2)] text-[var(--text-dim)] hover:text-[var(--text)] transition-all cursor-pointer"
            >
              <FileText size={11} />
              View notes
            </button>
          ) : (
            <button
              onClick={() => onCreateDoc(ev)}
              disabled={creatingDoc === ev.event_id}
              className="flex items-center gap-1 text-[11px] font-medium px-[10px] py-1 rounded-[6px] bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[var(--accent)] cursor-pointer hover:brightness-125 transition-all disabled:opacity-50"
            >
              <FileText size={11} />
              {creatingDoc === ev.event_id ? 'Creating...' : 'Create notes doc'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function YourDayPanel({ events, onCreateDoc, filter = 'all', onFilterChange, onAskAgent, kanbanMode = false }: Props) {
  const [creatingDoc, setCreatingDoc] = useState<string | null>(null);
  const [fyiExpanded, setFyiExpanded] = useState(false);

  const handleCreateDoc = async (event: DayEvent) => {
    setCreatingDoc(event.event_id);
    try {
      await onCreateDoc(event);
    } finally {
      setCreatingDoc(null);
    }
  };

  // Cap at 8 events (defensive, backend already caps)
  const capped = events.slice(0, 8);

  // If 3 or fewer events, render flat (no grouping needed)
  const useGrouping = capped.length > 3;

  const needsPrep = capped.filter((e) => e.priority_group === 'needs_prep');
  const showUp = capped.filter((e) => e.priority_group === 'show_up' || !e.priority_group);
  const fyi = capped.filter((e) => e.priority_group === 'fyi');

  const fyiVisible = fyiExpanded ? fyi : fyi.slice(0, 2);
  const fyiHidden = fyi.length - fyiVisible.length;

  const filterToggle = onFilterChange && (
    <div className="flex rounded-lg bg-[var(--surface1)] p-0.5">
      {(['all', 'mine', 'team'] as const).map((f) => (
        <button
          key={f}
          onClick={() => onFilterChange(f)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
            filter === f
              ? f === 'mine'
                ? 'bg-[var(--accent-dim)] text-[var(--accent)] shadow-sm'
                : f === 'team'
                  ? 'bg-[var(--purple-dim)] text-[var(--purple)] shadow-sm'
                  : 'bg-[var(--surface2)] text-[var(--text-dim)] shadow-sm'
              : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
          }`}
        >
          {f === 'mine' && <User size={9} />}
          {f === 'team' && <UsersRound size={9} />}
          {f === 'all' ? 'All' : f === 'mine' ? 'Mine' : 'Team'}
        </button>
      ))}
    </div>
  );

  return (
    <div className={kanbanMode ? 'flex flex-col' : 'home-panel overflow-hidden flex flex-col h-full'}>
      {!kanbanMode && (
        <div className="home-section-header" style={{ '--section-accent': 'var(--blue)' } as React.CSSProperties}>
          <div>
            <div className="home-section-kicker">Primary workspace</div>
            <h3 className="home-section-title">Your Day</h3>
          </div>
          <div className="flex items-center gap-3">
            {filterToggle}
            <span className="font-mono text-[11px] text-[var(--text-faint)]">{formatDate()}</span>
            {onAskAgent && (
              <button
                onClick={onAskAgent}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] cursor-pointer"
                title="Ask AI about your day"
                aria-label="Ask AI about your day"
              >
                <Sparkles size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {kanbanMode && filterToggle && (
        <div className="sticky top-0 z-10 bg-[var(--surface)] px-3 py-2 border-b border-[var(--border)]">
          {filterToggle}
        </div>
      )}

      {capped.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 text-center">
          <div className="relative inline-flex items-center justify-center mb-3">
            <div className="absolute w-10 h-10 rounded-full bg-[var(--accent)] opacity-10 blur-md" />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)]">
              <Calendar size={20} className="text-[var(--accent)]" />
            </div>
          </div>
          <div className="text-[13px] font-semibold text-[var(--text-dim)]">Clear day ahead</div>
          <div className="text-[12px] mt-1 text-[var(--text-faint)]">No meetings scheduled</div>
        </div>
      ) :!useGrouping ? (
        <div className="flex flex-col py-4">
          {capped.map((ev) => (
            <EventRow key={ev.event_id} ev={ev} creatingDoc={creatingDoc} onCreateDoc={handleCreateDoc} />
          ))}
          {capped.length < 4 && (
            <div className="mx-4 mt-1 rounded-[16px] border border-[var(--accent-border)]/40 bg-[var(--accent-dim)]/60 px-4 py-2.5 text-center text-[12px] text-[var(--accent)]/70">
              You&apos;re clear for the rest of the day
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col py-4">
          {/* Needs prep group */}
          {needsPrep.length > 0 && (
            <>
              <div className="px-4 pb-2 pt-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] font-semibold" style={{ color: 'var(--amber)' }}>
                  Needs prep
                </span>
              </div>
              {needsPrep.map((ev) => (
                <EventRow key={ev.event_id} ev={ev} creatingDoc={creatingDoc} onCreateDoc={handleCreateDoc} />
              ))}
            </>
          )}

          {/* Just show up group */}
          {showUp.length > 0 && (
            <>
              <div className="px-4 pb-2 pt-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--text-dim)]">
                  Just show up
                </span>
              </div>
              {showUp.map((ev) => (
                <EventRow key={ev.event_id} ev={ev} creatingDoc={creatingDoc} onCreateDoc={handleCreateDoc} />
              ))}
            </>
          )}

          {/* FYI group */}
          {fyi.length > 0 && (
            <>
              <div className="px-4 pb-2 pt-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--text-faint)]">
                  FYI
                </span>
              </div>
              {fyiVisible.map((ev) => (
                <EventRow key={ev.event_id} ev={ev} creatingDoc={creatingDoc} onCreateDoc={handleCreateDoc} />
              ))}
              {fyiHidden > 0 && (
                <button
                  onClick={() => setFyiExpanded(!fyiExpanded)}
                  className="flex items-center gap-1.5 px-4 py-2 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
                >
                  <ChevronDown size={10} className={fyiExpanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  {fyiExpanded ? 'Show less' : `${fyiHidden} more`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
