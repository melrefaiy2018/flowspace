import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CalendarEventDetail } from '../services/api';
import { useEventClassification, type UseEventClassificationReturn } from './useEventClassification';

export type CalendarView = 'week' | 'day' | 'month' | 'agenda';
export type EventFilter = 'all' | 'mine' | 'team';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface CalendarPageState {
  view: CalendarView;
  filter: EventFilter;
  currentDate: Date;
  events: CalendarEventDetail[];
  filteredEvents: CalendarEventDetail[];
  selectedEventId: string | null;
  loading: boolean;
  error: string | null;
  dateRange: DateRange;
  goToday: () => void;
  goNext: () => void;
  goPrev: () => void;
  setView: (v: CalendarView) => void;
  setFilter: (f: EventFilter) => void;
  selectEvent: (id: string | null) => void;
  setCurrentDate: (d: Date) => void;
  refresh: () => void;
  classification: UseEventClassificationReturn;
}

const STORAGE_KEY_VIEW = 'flowspace.calendar.view';
const STORAGE_KEY_DATE = 'flowspace.calendar.date';
const STORAGE_KEY_FILTER = 'flowspace.calendar.filter';

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
    case 'day':
      return {
        start: today,
        end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
      };
    case 'week': {
      const weekStart = startOfWeek(today);
      return {
        start: weekStart,
        end: new Date(addDays(weekStart, 6).getFullYear(), addDays(weekStart, 6).getMonth(), addDays(weekStart, 6).getDate(), 23, 59, 59, 999),
      };
    }
    case 'month': {
      // Pad to full weeks for the grid
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);
      const gridStart = startOfWeek(monthStart);
      const gridEnd = addDays(startOfWeek(addDays(monthEnd, 7)), -1);
      return {
        start: gridStart,
        end: new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate(), 23, 59, 59, 999),
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
    if (stored && ['week', 'day', 'month', 'agenda'].includes(stored)) {
      return stored as CalendarView;
    }
  } catch { /* ignore */ }
  return 'week';
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
  const [currentDate, setCurrentDateRaw] = useState<Date>(loadStoredDate);
  const [events, setEvents] = useState<CalendarEventDetail[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const fetchIdRef = useRef(0);

  const dateRange = useMemo(() => computeDateRange(view, currentDate), [view, currentDate]);

  const setView = useCallback((v: CalendarView) => {
    setViewRaw(v);
    try { localStorage.setItem(STORAGE_KEY_VIEW, v); } catch { /* ignore */ }
  }, []);

  const setFilter = useCallback((f: EventFilter) => {
    setFilterRaw(f);
    try { localStorage.setItem(STORAGE_KEY_FILTER, f); } catch { /* ignore */ }
  }, []);

  const classification = useEventClassification();

  const filteredEvents = useMemo(
    () => classification.filterEvents(events, filter),
    [events, filter, classification.filterEvents]
  );

  const setCurrentDate = useCallback((d: Date) => {
    setCurrentDateRaw(d);
    try { localStorage.setItem(STORAGE_KEY_DATE, d.toISOString()); } catch { /* ignore */ }
  }, []);

  const goToday = useCallback(() => setCurrentDate(new Date()), [setCurrentDate]);

  const goNext = useCallback(() => {
    setCurrentDate(
      view === 'day' ? addDays(currentDate, 1) :
      view === 'week' ? addDays(currentDate, 7) :
      view === 'month' ? new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1) :
      addDays(currentDate, 14)
    );
  }, [view, currentDate, setCurrentDate]);

  const goPrev = useCallback(() => {
    setCurrentDate(
      view === 'day' ? addDays(currentDate, -1) :
      view === 'week' ? addDays(currentDate, -7) :
      view === 'month' ? new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1) :
      addDays(currentDate, -14)
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
    currentDate,
    events,
    filteredEvents,
    selectedEventId,
    loading,
    error,
    dateRange,
    goToday,
    goNext,
    goPrev,
    setView,
    setFilter,
    selectEvent,
    setCurrentDate,
    refresh,
    classification,
  };
}
