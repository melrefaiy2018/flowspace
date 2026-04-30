import type { CalendarEventDetail, DayEvent } from '../../services/api';
import type { DateRange } from '../../hooks/useCalendarPage';

// ── Types ─────────────────────────────────────────────────────────────

export interface WeekInsights {
  totalMeetingMinutes: number;
  eventCount: number;
  backToBackCount: number;
  externalCount: number;
  needsPrepCount: number;
  focusMinutes: number;
  conflictCount: number;
}

export interface DayLoad {
  date: Date;
  events: CalendarEventDetail[];
  morningLoad: number;    // 0–1 fraction of 06–12 window covered
  middayLoad: number;     // 12–14
  afternoonLoad: number;  // 14–18
  eveningLoad: number;    // 18–22
  isOverloaded: boolean;
  hasFocusBlock: boolean;
  hasExternalMeeting: boolean;
  hasImportantMeeting: boolean;
  eventCount: number;
}

export type PrepStatus = 'none' | 'suggested' | 'ready' | 'stale';
export type EventType = 'external' | 'internal' | 'deadline' | 'focus' | 'tentative' | 'personal';

export interface EventMeta {
  isExternal: boolean;
  isImportant: boolean;
  prepStatus: PrepStatus;
  eventType: EventType;
  isBackToBack: boolean;
  conflictsWith: string[];
  timeUntilStart: number; // ms, negative if past
  clusterId: string | null; // cluster group key if in a back-to-back run
}

// ── Helpers ───────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function minutesCovered(events: CalendarEventDetail[], startH: number, endH: number): number {
  const windowStart = startH * 60;
  const windowEnd = endH * 60;
  let covered = 0;
  for (const ev of events) {
    if (ev.allDay) continue;
    const evStart = new Date(ev.start);
    const evEnd = new Date(ev.end);
    const s = evStart.getHours() * 60 + evStart.getMinutes();
    const e = evEnd.getHours() * 60 + evEnd.getMinutes();
    const overlapStart = Math.max(s, windowStart);
    const overlapEnd = Math.min(e, windowEnd);
    if (overlapEnd > overlapStart) covered += overlapEnd - overlapStart;
  }
  return Math.min(covered, windowEnd - windowStart);
}

function extractDomain(email: string): string {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : '';
}

function getOrganizerDomain(event: CalendarEventDetail): string {
  if (event.organizer?.email) return extractDomain(event.organizer.email);
  // Fallback: use calendarId if it looks like an email
  if (event.calendarId.includes('@')) return extractDomain(event.calendarId);
  return '';
}

function isExternalEvent(event: CalendarEventDetail): boolean {
  if (event.attendees.length === 0) return false;
  const orgDomain = getOrganizerDomain(event);
  if (!orgDomain) return false;
  return event.attendees.some((a) => extractDomain(a.email) !== orgDomain);
}

function isImportantEvent(event: CalendarEventDetail, aiInsight?: DayEvent): boolean {
  if (aiInsight?.priority_group === 'needs_prep') return true;
  // Heuristic: external meetings with multiple attendees, or meetings with 'review', 'board', 'interview', 'customer' in title
  const title = event.summary.toLowerCase();
  const keywords = ['board', 'review', 'customer', 'client', 'interview', 'investor', 'launch', 'deadline', 'renewal'];
  if (keywords.some((k) => title.includes(k))) return true;
  if (isExternalEvent(event) && event.attendees.length >= 3) return true;
  return false;
}

function getPrepStatus(event: CalendarEventDetail, aiInsight?: DayEvent): PrepStatus {
  if (!aiInsight) return 'none';
  if (aiInsight.prep_note) return 'ready';
  if (aiInsight.priority_group === 'needs_prep') return 'suggested';
  return 'none';
}

function getEventType(event: CalendarEventDetail): EventType {
  if (event.status === 'tentative') return 'tentative';
  const title = event.summary.toLowerCase();
  if (title.includes('focus') || title.includes('deep work') || title.includes('no meetings')) return 'focus';
  if (title.includes('deadline') || title.includes('due')) return 'deadline';
  if (isExternalEvent(event)) return 'external';
  return 'internal';
}

// ── Main Exports ──────────────────────────────────────────────────────

export function computeWeekInsights(
  events: CalendarEventDetail[],
  aiInsightsMap: Map<string, DayEvent>
): WeekInsights {
  const timedEvents = events.filter((ev) => !ev.allDay);

  let totalMeetingMinutes = 0;
  for (const ev of timedEvents) {
    const ms = new Date(ev.end).getTime() - new Date(ev.start).getTime();
    totalMeetingMinutes += Math.max(0, Math.round(ms / 60000));
  }

  // Back to back: consecutive events within 15 min gap
  const sorted = [...timedEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  let backToBackCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].start).getTime() - new Date(sorted[i - 1].end).getTime();
    if (gap >= 0 && gap <= 15 * 60 * 1000) backToBackCount++;
  }

  // External meetings
  const externalCount = timedEvents.filter(isExternalEvent).length;

  // Needs prep: no AI insight or prep status is none/suggested
  const needsPrepCount = timedEvents.filter((ev) => {
    const insight = aiInsightsMap.get(ev.id);
    const status = getPrepStatus(ev, insight);
    return status === 'none' || status === 'suggested';
  }).length;

  // Focus minutes: gaps >= 45 min between 9am–6pm on weekdays
  let focusMinutes = 0;
  const dayMap = new Map<string, CalendarEventDetail[]>();
  for (const ev of timedEvents) {
    const d = new Date(ev.start);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const existing = dayMap.get(key) ?? [];
    dayMap.set(key, [...existing, ev]);
  }
  for (const [, dayEvents] of dayMap) {
    const daySorted = [...dayEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const workStart = 9 * 60; // 9am in minutes
    const workEnd = 18 * 60;  // 6pm in minutes
    let cursor = workStart;
    for (const ev of daySorted) {
      const s = new Date(ev.start).getHours() * 60 + new Date(ev.start).getMinutes();
      const e = new Date(ev.end).getHours() * 60 + new Date(ev.end).getMinutes();
      if (s > cursor) {
        const gap = Math.min(s, workEnd) - cursor;
        if (gap >= 45) focusMinutes += gap;
      }
      cursor = Math.max(cursor, e);
    }
    const remainingGap = workEnd - cursor;
    if (remainingGap >= 45) focusMinutes += remainingGap;
  }

  // Conflicts: events with overlapping time ranges on the same day
  let conflictCount = 0;
  for (let i = 0; i < timedEvents.length; i++) {
    for (let j = i + 1; j < timedEvents.length; j++) {
      const a = timedEvents[i];
      const b = timedEvents[j];
      const aStart = new Date(a.start).getTime();
      const aEnd = new Date(a.end).getTime();
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      if (aStart < bEnd && bStart < aEnd) conflictCount++;
    }
  }

  return {
    totalMeetingMinutes,
    eventCount: timedEvents.length,
    backToBackCount,
    externalCount,
    needsPrepCount,
    focusMinutes,
    conflictCount,
  };
}

export function computeDayLoads(events: CalendarEventDetail[], dateRange: DateRange): DayLoad[] {
  const days: DayLoad[] = [];
  const rangeStart = new Date(dateRange.start);

  for (let i = 0; i < 7; i++) {
    const date = new Date(rangeStart);
    date.setDate(date.getDate() + i);

    const dayEvents = events.filter((ev) => isSameDay(new Date(ev.start), date));
    const timedDayEvents = dayEvents.filter((ev) => !ev.allDay);

    const morningWindow = 6 * 60; // 360 min
    const middayWindow = 2 * 60;  // 120 min
    const afternoonWindow = 4 * 60; // 240 min
    const eveningWindow = 4 * 60;  // 240 min

    const morningLoad = minutesCovered(timedDayEvents, 6, 12) / morningWindow;
    const middayLoad = minutesCovered(timedDayEvents, 12, 14) / middayWindow;
    const afternoonLoad = minutesCovered(timedDayEvents, 14, 18) / afternoonWindow;
    const eveningLoad = minutesCovered(timedDayEvents, 18, 22) / eveningWindow;

    // Overloaded: > 6h of meetings or more than 4 back-to-back pairs
    let b2bCount = 0;
    const sorted = [...timedDayEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    for (let j = 1; j < sorted.length; j++) {
      const gap = new Date(sorted[j].start).getTime() - new Date(sorted[j - 1].end).getTime();
      if (gap >= 0 && gap <= 15 * 60 * 1000) b2bCount++;
    }

    const totalDayMinutes = timedDayEvents.reduce((sum, ev) => {
      const ms = new Date(ev.end).getTime() - new Date(ev.start).getTime();
      return sum + Math.max(0, ms / 60000);
    }, 0);

    days.push({
      date: new Date(date),
      events: dayEvents,
      morningLoad,
      middayLoad,
      afternoonLoad,
      eveningLoad,
      isOverloaded: totalDayMinutes > 360 || b2bCount >= 3,
      hasFocusBlock: dayEvents.some((ev) => getEventType(ev) === 'focus'),
      hasExternalMeeting: timedDayEvents.some(isExternalEvent),
      hasImportantMeeting: timedDayEvents.some((ev) => isImportantEvent(ev)),
      eventCount: timedDayEvents.length,
    });
  }

  return days;
}

export function computeEventMetas(
  events: CalendarEventDetail[],
  aiInsightsMap: Map<string, DayEvent>
): Map<string, EventMeta> {
  const metas = new Map<string, EventMeta>();
  const timedEvents = events.filter((ev) => !ev.allDay);
  const sorted = [...timedEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const now = Date.now();

  // Detect back-to-back pairs
  const isB2B = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].start).getTime() - new Date(sorted[i - 1].end).getTime();
    if (gap >= 0 && gap <= 15 * 60 * 1000) {
      isB2B.add(sorted[i - 1].id);
      isB2B.add(sorted[i].id);
    }
  }

  // Assign cluster IDs to back-to-back runs
  const clusterMap = new Map<string, string>();
  let clusterIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (!isB2B.has(ev.id)) continue;
    if (clusterMap.has(ev.id)) continue;
    const clusterId = `cluster-${clusterIdx++}`;
    clusterMap.set(ev.id, clusterId);
    // Extend cluster forward
    for (let j = i + 1; j < sorted.length; j++) {
      const gap = new Date(sorted[j].start).getTime() - new Date(sorted[j - 1].end).getTime();
      if (gap >= 0 && gap <= 15 * 60 * 1000) {
        clusterMap.set(sorted[j].id, clusterId);
      } else break;
    }
  }

  // Detect conflicts (overlapping events)
  const conflictMap = new Map<string, string[]>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const aStart = new Date(a.start).getTime();
      const aEnd = new Date(a.end).getTime();
      const bStart = new Date(b.start).getTime();
      if (bStart >= aEnd) break;
      const bEnd = new Date(b.end).getTime();
      if (aStart < bEnd && bStart < aEnd) {
        const aConflicts = conflictMap.get(a.id) ?? [];
        conflictMap.set(a.id, [...aConflicts, b.id]);
        const bConflicts = conflictMap.get(b.id) ?? [];
        conflictMap.set(b.id, [...bConflicts, a.id]);
      }
    }
  }

  for (const ev of events) {
    const aiInsight = aiInsightsMap.get(ev.id);
    metas.set(ev.id, {
      isExternal: isExternalEvent(ev),
      isImportant: isImportantEvent(ev, aiInsight),
      prepStatus: getPrepStatus(ev, aiInsight),
      eventType: getEventType(ev),
      isBackToBack: isB2B.has(ev.id),
      conflictsWith: conflictMap.get(ev.id) ?? [],
      timeUntilStart: new Date(ev.start).getTime() - now,
      clusterId: clusterMap.get(ev.id) ?? null,
    });
  }

  return metas;
}

export function detectBackToBackClusters(events: CalendarEventDetail[]): Map<string, string[]> {
  const timedEvents = events.filter((ev) => !ev.allDay);
  const sorted = [...timedEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const clusters = new Map<string, string[]>();

  let i = 0;
  while (i < sorted.length) {
    const cluster: string[] = [sorted[i].id];
    let j = i + 1;
    while (j < sorted.length) {
      const gap = new Date(sorted[j].start).getTime() - new Date(sorted[j - 1].end).getTime();
      if (gap >= 0 && gap <= 15 * 60 * 1000) {
        cluster.push(sorted[j].id);
        j++;
      } else break;
    }
    if (cluster.length >= 3) {
      for (const id of cluster) {
        clusters.set(id, cluster);
      }
    }
    i = j;
  }

  return clusters;
}

export function formatMeetingHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatTimeUntil(ms: number): string {
  if (ms < 0) return 'started';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `in ${hours}h ${rem}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export function getNeedsPrepEvents(
  events: CalendarEventDetail[],
  metas: Map<string, EventMeta>
): CalendarEventDetail[] {
  const now = Date.now();
  return events
    .filter((ev) => {
      if (ev.allDay) return false;
      const meta = metas.get(ev.id);
      if (!meta) return false;
      if (meta.timeUntilStart < 0) return false; // past
      return meta.prepStatus === 'none' || meta.prepStatus === 'suggested';
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export function getNextImportantEvent(
  events: CalendarEventDetail[],
  metas: Map<string, EventMeta>
): CalendarEventDetail | null {
  const upcoming = events
    .filter((ev) => {
      if (ev.allDay) return false;
      const meta = metas.get(ev.id);
      return meta && meta.timeUntilStart > -30 * 60 * 1000; // within 30min past
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // Prefer important upcoming, else just the next one
  const important = upcoming.find((ev) => metas.get(ev.id)?.isImportant);
  return important ?? upcoming[0] ?? null;
}
