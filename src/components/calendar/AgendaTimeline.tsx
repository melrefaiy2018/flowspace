import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { CalendarEventDetail } from '../../services/api';
import type { EventMeta } from './calendarUtils';
import type { InsightFilter } from '../../hooks/useCalendarPage';
import { formatTime, formatDuration } from './calendarUtils';
import EventCard from './EventCard';
import AllDayStrip from './AllDayStrip';

interface Props {
  events: CalendarEventDetail[];
  eventMetas: Map<string, EventMeta>;
  insightFilter: InsightFilter;
  view: 'timeline' | 'focus' | 'prep';
  selectedEventId: string | null;
  selectedDay: Date | null;
  onSelectEvent: (id: string | null) => void;
  onAskAI?: (prompt: string) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}
function isToday(d: Date) { return isSameDay(d, new Date()); }
function isTomorrow(d: Date) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  return isSameDay(d, t);
}

function formatDayLabel(d: Date): string {
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function totalMins(evs: CalendarEventDetail[]): number {
  return evs.reduce((s, e) => {
    const ms = new Date(e.end).getTime() - new Date(e.start).getTime();
    return s + Math.max(0, ms / 60000);
  }, 0);
}

function fmtMins(m: number): string {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  if (h === 0) return `${r}m`;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

interface DayGroup {
  date: Date;
  timedEvents: CalendarEventDetail[];
  allDayEvents: CalendarEventDetail[];
}

function groupByDate(events: CalendarEventDetail[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const ev of events) {
    const d = new Date(ev.start);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) {
      map.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), timedEvents: [], allDayEvents: [] });
    }
    const g = map.get(key)!;
    if (ev.allDay) {
      map.set(key, { ...g, allDayEvents: [...g.allDayEvents, ev] });
    } else {
      map.set(key, { ...g, timedEvents: [...g.timedEvents, ev] });
    }
  }
  return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function shouldShow(ev: CalendarEventDetail, meta: EventMeta | undefined, view: 'timeline' | 'focus' | 'prep'): boolean {
  if (!meta) return true;
  if (view === 'focus') return meta.isImportant || meta.isExternal || meta.conflictsWith.length > 0;
  if (view === 'prep') {
    if (meta.timeUntilStart < 0) return false;
    return meta.prepStatus === 'none' || meta.prepStatus === 'suggested';
  }
  return true;
}

// Priority sort: important first → needs prep → external → chronological
function prioritySort(events: CalendarEventDetail[], metas: Map<string, EventMeta>): CalendarEventDetail[] {
  return [...events].sort((a, b) => {
    const ma = metas.get(a.id);
    const mb = metas.get(b.id);
    const scoreA = ma ? (ma.isImportant ? 0 : ma.prepStatus !== 'ready' && ma.prepStatus !== 'none' ? 0 : ma.prepStatus === 'none' ? 1 : ma.isExternal ? 2 : 3) : 3;
    const scoreB = mb ? (mb.isImportant ? 0 : mb.prepStatus !== 'ready' && mb.prepStatus !== 'none' ? 0 : mb.prepStatus === 'none' ? 1 : mb.isExternal ? 2 : 3) : 3;
    if (scoreA !== scoreB) return scoreA - scoreB;
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });
}

// Build clusters: runs of 3+ back-to-back events → one group
interface Segment {
  type: 'single' | 'cluster';
  events: CalendarEventDetail[];
  clusterId?: string;
}

function buildSegments(events: CalendarEventDetail[], metas: Map<string, EventMeta>): Segment[] {
  // Work in chronological order for clustering, then we'll re-sort by priority within singles
  const chrono = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const segments: Segment[] = [];
  let i = 0;
  while (i < chrono.length) {
    const cluster: CalendarEventDetail[] = [chrono[i]];
    let j = i + 1;
    while (j < chrono.length) {
      const gap = new Date(chrono[j].start).getTime() - new Date(chrono[j - 1].end).getTime();
      if (gap >= 0 && gap <= 15 * 60 * 1000) { cluster.push(chrono[j]); j++; }
      else break;
    }
    if (cluster.length >= 3 && cluster.every((e) => metas.get(e.id)?.isBackToBack)) {
      segments.push({ type: 'cluster', events: cluster, clusterId: `cluster-${i}` });
    } else {
      for (const ev of cluster) segments.push({ type: 'single', events: [ev] });
    }
    i = j;
  }
  return segments;
}

// ── Cluster block ─────────────────────────────────────────────────────

interface ClusterBlockProps {
  events: CalendarEventDetail[];
  metas: Map<string, EventMeta>;
  selectedEventId: string | null;
  insightFilter: InsightFilter;
  onSelectEvent: (id: string | null) => void;
  onAskAI?: (prompt: string) => void;
}

function ClusterBlock({ events, metas, selectedEventId, insightFilter, onSelectEvent, onAskAI }: ClusterBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const mins = totalMins(events);
  const start = formatTime(events[0].start);
  const end = formatTime(events[events.length - 1].end);
  const hasSelected = events.some((e) => e.id === selectedEventId);

  // Auto-expand if selected event is inside
  const shouldExpand = expanded || hasSelected;

  return (
    <div className="rounded-xl border border-[var(--warn)]/25 bg-[var(--warn)]/5 overflow-hidden">
      {/* Cluster header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-[var(--warn)]/8 transition-colors cursor-pointer"
      >
        <AlertTriangle size={11} className="text-[var(--warn)] shrink-0" />
        <div className="flex-1 text-left">
          <span className="text-[12px] font-semibold text-[var(--text)]">
            {events.length} back-to-back
          </span>
          <span className="text-[10px] text-[var(--text-faint)] ml-2">
            {start} – {end} · {fmtMins(mins)}
          </span>
        </div>
        {shouldExpand ? <ChevronDown size={12} className="text-[var(--text-faint)] shrink-0" /> : <ChevronRight size={12} className="text-[var(--text-faint)] shrink-0" />}
      </button>

      {/* Collapsed preview — show first 2 event names */}
      {!shouldExpand && (
        <div className="px-3.5 pb-2.5 flex flex-wrap gap-1">
          {events.slice(0, 3).map((ev) => (
            <span key={ev.id} className="text-[10px] text-[var(--text-faint)] bg-[var(--surface2)] px-2 py-0.5 rounded-full truncate max-w-[120px]">
              {ev.summary}
            </span>
          ))}
          {events.length > 3 && (
            <span className="text-[10px] text-[var(--text-faint)]">+{events.length - 3} more</span>
          )}
        </div>
      )}

      {/* Expanded event list */}
      {shouldExpand && (
        <div className="px-2.5 pb-2.5 flex flex-col gap-1.5">
          {events.map((ev) => {
            const meta = metas.get(ev.id);
            if (!meta) return null;
            return (
              <EventCard
                key={ev.id}
                event={ev}
                meta={meta}
                isSelected={selectedEventId === ev.id}
                insightFilter={insightFilter}
                onClick={() => onSelectEvent(selectedEventId === ev.id ? null : ev.id)}
                onAskAI={onAskAI}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Day section ───────────────────────────────────────────────────────

interface DaySectionProps {
  group: DayGroup;
  eventMetas: Map<string, EventMeta>;
  insightFilter: InsightFilter;
  view: 'timeline' | 'focus' | 'prep';
  selectedEventId: string | null;
  isExpanded: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  onSelectEvent: (id: string | null) => void;
  onAskAI?: (prompt: string) => void;
}

function DaySection({
  group, eventMetas, insightFilter, view, selectedEventId,
  isExpanded, isToday, isTomorrow, onSelectEvent, onAskAI,
}: DaySectionProps) {
  const visible = group.timedEvents.filter((ev) => shouldShow(ev, eventMetas.get(ev.id), view));
  const mins = totalMins(visible);
  const isOverloaded = visible.length >= 4 && visible.filter((e) => eventMetas.get(e.id)?.isBackToBack).length >= 3;

  // Priority-sorted visible events
  const sorted = prioritySort(visible, eventMetas);

  // First item in sorted order = "most important" gets pinned treatment
  const pinnedId = (isExpanded && sorted.length > 0 && (eventMetas.get(sorted[0].id)?.isImportant || eventMetas.get(sorted[0].id)?.prepStatus !== 'ready'))
    ? sorted[0].id
    : null;

  // Build segments from chronological for clusters, but render in priority order outside clusters
  const segments = buildSegments(visible, eventMetas);

  // Identify which event ids are in clusters
  const clusteredIds = new Set(
    segments.filter((s) => s.type === 'cluster').flatMap((s) => s.events.map((e) => e.id))
  );

  // Non-clustered events, in priority order
  const singles = sorted.filter((e) => !clusteredIds.has(e.id));

  // Cluster segments for rendering in chronological position
  const clusterSegments = segments.filter((s) => s.type === 'cluster');

  // Build final render order: weave singles and clusters by earliest event start
  type RenderItem = { kind: 'single'; ev: CalendarEventDetail } | { kind: 'cluster'; seg: Segment };
  const renderItems: RenderItem[] = [
    ...singles.map((ev) => ({ kind: 'single' as const, ev })),
    ...clusterSegments.map((seg) => ({ kind: 'cluster' as const, seg })),
  ].sort((a, b) => {
    const aTime = a.kind === 'single'
      ? new Date(a.ev.start).getTime()
      : new Date(a.seg.events[0].start).getTime();
    const bTime = b.kind === 'single'
      ? new Date(b.ev.start).getTime()
      : new Date(b.seg.events[0].start).getTime();
    // But: pinned item always first
    if (a.kind === 'single' && a.ev.id === pinnedId) return -1;
    if (b.kind === 'single' && b.ev.id === pinnedId) return 1;
    return aTime - bTime;
  });

  return (
    <div className={`transition-opacity ${!isExpanded ? 'opacity-70' : ''}`}>
      {/* Day header */}
      <div className="flex items-baseline gap-2 mb-3">
        <span className={`text-[15px] font-bold ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
          {formatDayLabel(group.date)}
        </span>
        {visible.length > 0 && (
          <span className="text-[11px] text-[var(--text-faint)]">
            {visible.length} meeting{visible.length !== 1 ? 's' : ''} · {fmtMins(mins)}
          </span>
        )}
        {isOverloaded && (
          <span className="flex items-center gap-0.5 text-[10px] font-medium text-[var(--warn)]">
            <AlertTriangle size={9} />
            Heavy
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--text-faint)]/60">
          {group.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* All-day strip */}
      {group.allDayEvents.length > 0 && (
        <div className="mb-2.5">
          <AllDayStrip events={group.allDayEvents} onSelect={onSelectEvent} selectedEventId={selectedEventId} />
        </div>
      )}

      {/* Events */}
      {visible.length === 0 ? (
        <p className="text-[11px] text-[var(--text-faint)] italic px-1 py-1 mb-1">
          {view === 'prep' ? 'All prepped' : view === 'focus' ? 'Nothing critical' : 'Open day'}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {renderItems.map((item, idx) => {
            if (item.kind === 'cluster') {
              return (
                <ClusterBlock
                  key={item.seg.clusterId ?? `cluster-${idx}`}
                  events={item.seg.events}
                  metas={eventMetas}
                  selectedEventId={selectedEventId}
                  insightFilter={insightFilter}
                  onSelectEvent={onSelectEvent}
                  onAskAI={onAskAI}
                />
              );
            }
            const ev = item.ev;
            const meta = eventMetas.get(ev.id);
            if (!meta) return null;
            return (
              <EventCard
                key={ev.id}
                event={ev}
                meta={meta}
                isSelected={selectedEventId === ev.id}
                insightFilter={insightFilter}
                isPinned={ev.id === pinnedId}
                onClick={() => onSelectEvent(selectedEventId === ev.id ? null : ev.id)}
                onAskAI={onAskAI}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function AgendaTimeline({
  events, eventMetas, insightFilter, view,
  selectedEventId, selectedDay, onSelectEvent, onAskAI,
}: Props) {
  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const groups = groupByDate(events);

  useEffect(() => {
    if (!selectedDay) return;
    const key = `${selectedDay.getFullYear()}-${selectedDay.getMonth()}-${selectedDay.getDate()}`;
    dayRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedDay]);

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-faint)] gap-2 py-16">
        <Calendar size={28} strokeWidth={1.5} />
        <p className="text-[13px]">
          {view === 'prep' ? 'All meetings are prepped.' : view === 'focus' ? 'No critical meetings this week.' : 'No events this week.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 min-w-0">
      <div className="flex flex-col gap-8">
        {groups.map((group) => {
          const key = `${group.date.getFullYear()}-${group.date.getMonth()}-${group.date.getDate()}`;
          const todayFlag = isToday(group.date);
          const tomorrowFlag = isTomorrow(group.date);
          const expanded = todayFlag || tomorrowFlag || (selectedDay ? isSameDay(group.date, selectedDay) : false);

          return (
            <div
              key={key}
              ref={(el) => { if (el) dayRefs.current.set(key, el); else dayRefs.current.delete(key); }}
            >
              <DaySection
                group={group}
                eventMetas={eventMetas}
                insightFilter={insightFilter}
                view={view}
                selectedEventId={selectedEventId}
                isExpanded={expanded}
                isToday={todayFlag}
                isTomorrow={tomorrowFlag}
                onSelectEvent={onSelectEvent}
                onAskAI={onAskAI}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
