import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CalendarEventDetail, type DayEvent, type CalendarEvent } from '../services/api';
import { useEventClassification, type EventClassification } from './useEventClassification';
import type { EventFilter } from './useCalendarPage';

const STORAGE_KEY = 'flowspace.home.dayFilter';

function loadStoredFilter(): EventFilter {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'mine' || v === 'team' || v === 'all') return v;
  } catch { /* ignore */ }
  return 'all';
}

export interface HomeDayFilterReturn {
  filter: EventFilter;
  setFilter: (f: EventFilter) => void;
  filterDayEvents: (events: DayEvent[]) => DayEvent[];
  filterCalendarEvents: (events: CalendarEvent[]) => CalendarEvent[];
}

/**
 * Hook for filtering home page calendar events using the shared classification store.
 * Fetches today's CalendarEventDetail[] to cross-reference event_id → recurringEventId
 * so recurring event classifications propagate correctly.
 */
export function useHomeDayFilter(): HomeDayFilterReturn {
  const [filter, setFilterRaw] = useState<EventFilter>(loadStoredFilter);
  const [todayDetails, setTodayDetails] = useState<CalendarEventDetail[]>([]);
  const classification = useEventClassification();

  const setFilter = useCallback((f: EventFilter) => {
    setFilterRaw(f);
    try { localStorage.setItem(STORAGE_KEY, f); } catch { /* ignore */ }
  }, []);

  // Fetch today's detailed events for recurringEventId cross-reference
  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    api.getCalendarRange(start.toISOString(), end.toISOString())
      .then((res) => setTodayDetails(res.events))
      .catch(() => { /* fallback: no cross-reference */ });
  }, []);

  // Build lookup: event_id → CalendarEventDetail
  const detailMap = useMemo(() => {
    const map = new Map<string, CalendarEventDetail>();
    for (const ev of todayDetails) {
      map.set(ev.id, ev);
    }
    return map;
  }, [todayDetails]);

  const getEventClassification = useCallback(
    (eventId: string): EventClassification => {
      const detail = detailMap.get(eventId);
      if (detail) return classification.getClassification(detail);
      // No detail found — can't resolve recurringEventId, assume 'mine'
      return 'mine';
    },
    [detailMap, classification]
  );

  const filterDayEvents = useCallback(
    (events: DayEvent[]): DayEvent[] => {
      if (filter === 'all') return events;
      return events.filter((ev) => {
        const c = getEventClassification(ev.event_id);
        return filter === 'mine' ? c === 'mine' : c === 'team';
      });
    },
    [filter, getEventClassification]
  );

  const filterCalendarEvents = useCallback(
    (events: CalendarEvent[]): CalendarEvent[] => {
      if (filter === 'all') return events;
      return events.filter((ev) => {
        const c = getEventClassification(ev.id);
        return filter === 'mine' ? c === 'mine' : c === 'team';
      });
    },
    [filter, getEventClassification]
  );

  return useMemo(
    () => ({ filter, setFilter, filterDayEvents, filterCalendarEvents }),
    [filter, setFilter, filterDayEvents, filterCalendarEvents]
  );
}
