import { useCallback, useMemo, useState } from 'react';
import type { CalendarEventDetail } from '../services/api';
import type { EventFilter } from './useCalendarPage';

export type EventClassification = 'mine' | 'team';

type ClassificationMap = Record<string, EventClassification>;

const STORAGE_KEY = 'flowspace.calendar.classifications';

function isClassificationMap(v: unknown): v is ClassificationMap {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every(
      (x) => x === 'mine' || x === 'team'
    )
  );
}

function loadClassifications(): ClassificationMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (isClassificationMap(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return {};
}

function saveClassifications(map: ClassificationMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

/** Returns the storage key for an event — recurringEventId for recurring, id for one-off */
function classificationKey(event: CalendarEventDetail): string {
  return event.recurringEventId ?? event.id;
}

function resolveClassification(
  event: CalendarEventDetail,
  map: ClassificationMap
): EventClassification {
  // Check recurringEventId first (covers all instances of a recurring event)
  if (event.recurringEventId && map[event.recurringEventId]) {
    return map[event.recurringEventId];
  }
  // Check individual event id
  if (map[event.id]) {
    return map[event.id];
  }
  // Fallback to organizer.self
  return event.organizer?.self === true ? 'mine' : 'team';
}

export interface UseEventClassificationReturn {
  getClassification: (event: CalendarEventDetail) => EventClassification;
  setClassification: (event: CalendarEventDetail, classification: EventClassification) => void;
  hasOverride: (event: CalendarEventDetail) => boolean;
  clearOverride: (event: CalendarEventDetail) => void;
  filterEvents: (events: CalendarEventDetail[], filter: EventFilter) => CalendarEventDetail[];
}

export function useEventClassification(): UseEventClassificationReturn {
  const [classifications, setClassifications] = useState<ClassificationMap>(loadClassifications);

  const getClassification = useCallback(
    (event: CalendarEventDetail): EventClassification =>
      resolveClassification(event, classifications),
    [classifications]
  );

  const setClassification = useCallback(
    (event: CalendarEventDetail, cls: EventClassification) => {
      const key = classificationKey(event);
      setClassifications((prev) => {
        const next = { ...prev, [key]: cls };
        saveClassifications(next);
        return next;
      });
    },
    []
  );

  const hasOverride = useCallback(
    (event: CalendarEventDetail): boolean =>
      (event.recurringEventId !== undefined && event.recurringEventId in classifications) ||
      event.id in classifications,
    [classifications]
  );

  const clearOverride = useCallback(
    (event: CalendarEventDetail) => {
      const key = classificationKey(event);
      setClassifications((prev) => {
        const { [key]: _, ...rest } = prev;
        saveClassifications(rest);
        return rest;
      });
    },
    []
  );

  const filterEvents = useCallback(
    (events: CalendarEventDetail[], filter: EventFilter): CalendarEventDetail[] => {
      if (filter === 'all') return events;
      return events.filter((ev) => {
        const c = resolveClassification(ev, classifications);
        return filter === 'mine' ? c === 'mine' : c === 'team';
      });
    },
    [classifications]
  );

  return useMemo(
    () => ({ getClassification, setClassification, hasOverride, clearOverride, filterEvents }),
    [getClassification, setClassification, hasOverride, clearOverride, filterEvents]
  );
}
