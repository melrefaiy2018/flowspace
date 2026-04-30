import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CalendarEventDetail } from '../services/api';
import { useEventClassification, type UseEventClassificationReturn } from './useEventClassification';

export type CalendarView = 'timeline' | 'focus' | 'prep' | 'grid' | 'agenda';
export type EventFilter = 'all' | 'mine' | 'team';
export type InsightFilter =
  | 'meeting-load'
  | 'back-to-back'
  | 'external'
  | 'needs-prep'
  | 'focus-protected'
  | 'conflicts'
  | null;

export interface DateRange {
  start: Date;
  end: Date;
}

export interface CalendarPageState {
  view: CalendarView;
  filter: EventFilter;
  insightFilter: InsightFilter;
  currentDate: Date;
  selectedDay: Date | null;
  events: CalendarEventDetail[];
  filteredEvents: CalendarEventDetail[];
  selectedEventId: string | null;
  loading: boolean;
  error: string | null;
  dateRange: DateRange;
  lastFetchedAt: Date | null;
  goToday: () => void;
  goNext: () => void;
  goPrev: () => void;
  setView: (v: CalendarView) => void;
  setFilter: (f: EventFilter) => void;
  setInsightFilter: (f: InsightFilter) => void;
  selectEvent: (id: string | null) => void;
  setCurrentDate: (d: Date) => void;
  setSelectedDay: (d: Date | null) => void;
  refresh: () => void;
  classification: UseEventClassificationReturn;
}

const STORAGE_KEY_VIEW = 'flowspace.calendar.view';
const STORAGE_KEY_DATE = 'flowspace.calendar.date';
const STORAGE_KEY_FILTER = 'flowspace.calendar.filter';

const VALID_VIEWS: CalendarView[] = ['timeline', 'focus', 'prep', 'grid', 'agenda'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  // Monday start: if Sunday (0), go back 6 days; otherwise go back (day - 1)
  const diff = day === 0 ? 6 : day - 1;
  return startOfDay(addDays(d, -diff));
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function computeDateRange(view: CalendarView, anchor: Date): DateRange {
  const today = startOfDay(anchor);

  switch (view) {
    case 'timeline':
    case 'focus':
    case 'prep': {
      // All semantic views show the current week (Mon–Sun)
      const weekStart = startOfWeek(today);
      return {
        start: weekStart,
        end: new Date(addDays(weekStart, 6).getFullYear(), addDays(weekStart, 6).getMonth(), addDays(weekStart, 6).getDate(), 23, 59, 59, 999),
      };
    }
    case 'grid': {
      // Grid defaults to week range
      const weekStart = startOfWeek(today);
      return {
        start: weekStart,
        end: new Date(addDays(weekStart, 6).getFullYear(), addDays(weekStart, 6).getMonth(), addDays(weekStart, 6).getDate(), 23, 59, 59, 999),
      };
    }
    case 'agenda':
      return {
        start: today,
        end: addDays(today, 14),
      };
  }
}

function loadStoredView(): CalendarView {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VIEW);
    if (stored && VALID_VIEWS.includes(stored as CalendarView)) {
      return stored as CalendarView;
    }
  } catch { /* ignore */ }
  return 'timeline';
}

function loadStoredFilter(): EventFilter {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FILTER);
    if (stored && ['all', 'mine', 'team'].includes(stored)) {
      return stored as EventFilter;
    }
  } catch { /* ignore */ }
  return 'all';
}

function loadStoredDate(): Date {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_DATE);
    if (stored) {
      const d = new Date(stored);
      if (!isNaN(d.getTime())) return d;
    }
  } catch { /* ignore */ }
  return new Date();
}

export function useCalendarPage(): CalendarPageState {
  const [view, setViewRaw] = useState<CalendarView>(loadStoredView);
  const [filter, setFilterRaw] = useState<EventFilter>(loadStoredFilter);
  const [insightFilter, setInsightFilterRaw] = useState<InsightFilter>(null);
  const [currentDate, setCurrentDateRaw] = useState<Date>(loadStoredDate);
  const [selectedDay, setSelectedDayRaw] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEventDetail[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const fetchIdRef = useRef(0);

  const dateRange = useMemo(() => computeDateRange(view, currentDate), [view, currentDate]);

  const setView = useCallback((v: CalendarView) => {
    setViewRaw(v);
    setInsightFilterRaw(null); // clear insight filter on view change
    try { localStorage.setItem(STORAGE_KEY_VIEW, v); } catch { /* ignore */ }
  }, []);

  const setFilter = useCallback((f: EventFilter) => {
    setFilterRaw(f);
    try { localStorage.setItem(STORAGE_KEY_FILTER, f); } catch { /* ignore */ }
  }, []);

  const setInsightFilter = useCallback((f: InsightFilter) => {
    setInsightFilterRaw(f);
  }, []);

  const setSelectedDay = useCallback((d: Date | null) => {
    setSelectedDayRaw(d);
  }, []);

  const classification = useEventClassification();

  const filteredEvents = useMemo(
    () => classification.filterEvents(events, filter),
    [events, filter, classification.filterEvents]
  );

  const setCurrentDate = useCallback((d: Date) => {
    setCurrentDateRaw(d);
    setSelectedDayRaw(null); // clear selected day on navigation
    try { localStorage.setItem(STORAGE_KEY_DATE, d.toISOString()); } catch { /* ignore */ }
  }, []);

  const goToday = useCallback(() => setCurrentDate(new Date()), [setCurrentDate]);

  const goNext = useCallback(() => {
    setCurrentDate(
      view === 'agenda' ? addDays(currentDate, 14) :
      new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 7)
    );
  }, [view, currentDate, setCurrentDate]);

  const goPrev = useCallback(() => {
    setCurrentDate(
      view === 'agenda' ? addDays(currentDate, -14) :
      new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 7)
    );
  }, [view, currentDate, setCurrentDate]);

  const selectEvent = useCallback((id: string | null) => {
    setSelectedEventId(id);
  }, []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Fetch events when date range changes
  useEffect(() => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    api
      .getCalendarRange(dateRange.start.toISOString(), dateRange.end.toISOString())
      .then((res) => {
        if (id !== fetchIdRef.current) return;
        setEvents(res.events);
        setLastFetchedAt(new Date());
      })
      .catch((err: Error) => {
        if (id !== fetchIdRef.current) return;
        setError(err.message ?? 'Failed to load calendar events');
      })
      .finally(() => {
        if (id === fetchIdRef.current) setLoading(false);
      });
  }, [dateRange.start.toISOString(), dateRange.end.toISOString(), refreshKey]);

  return {
    view,
    filter,
    insightFilter,
    currentDate,
    selectedDay,
    events,
    filteredEvents,
    selectedEventId,
    loading,
    error,
    dateRange,
    lastFetchedAt,
    goToday,
    goNext,
    goPrev,
    setView,
    setFilter,
    setInsightFilter,
    selectEvent,
    setCurrentDate,
    setSelectedDay,
    refresh,
    classification,
  };
}
