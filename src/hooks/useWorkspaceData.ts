/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  type AuthStatus,
  type WorkspaceStats,
  type DriveFile,
  type GmailMessage,
  type CalendarEvent,
} from '../services/api';

/** Silent background refresh every 5 minutes */
const HEARTBEAT_INTERVAL = 5 * 60 * 1000;

/** Re-fetch if tab was hidden longer than this */
const STALE_THRESHOLD = 2 * 60 * 1000;

export interface DashboardData {
  auth: AuthStatus | null;
  stats: WorkspaceStats | null;
  emails: GmailMessage[];
  events: CalendarEvent[];
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDashboardData(accountKey?: string): DashboardData {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastFetchRef = useRef(0);
  const hiddenAtRef = useRef(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  /** Silent refresh — updates data without showing loading spinner */
  const silentRefresh = useCallback(() => {
    Promise.all([
      api.getAuthStatus(),
      api.getStats(),
      api.getGmailRecent(5),
      api.getCalendarUpcoming(7),
      api.getDriveRecent(6),
    ])
      .then(([authRes, statsRes, gmailRes, calRes, driveRes]) => {
        setAuth(authRes);
        setStats(statsRes);
        setEmails(gmailRes.messages);
        setEvents(calRes.events);
        setFiles(driveRes.files);
        lastFetchRef.current = Date.now();
      })
      .catch(() => { /* silent — don't overwrite existing data on background failure */ });
  }, []);

  // Initial fetch + manual refresh (shows loading spinner)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.getAuthStatus(),
      api.getStats(),
      api.getGmailRecent(5),
      api.getCalendarUpcoming(7),
      api.getDriveRecent(6),
    ])
      .then(([authRes, statsRes, gmailRes, calRes, driveRes]) => {
        if (cancelled) return;
        setAuth(authRes);
        setStats(statsRes);
        setEmails(gmailRes.messages);
        setEvents(calRes.events);
        setFiles(driveRes.files);
        lastFetchRef.current = Date.now();
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [accountKey, refreshKey]);

  // Heartbeat: silent background refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(silentRefresh, HEARTBEAT_INTERVAL);
    return () => clearInterval(id);
  }, [silentRefresh]);

  // Visibility: refresh when user returns to tab after being away >2 min
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else {
        const away = Date.now() - hiddenAtRef.current;
        const stale = Date.now() - lastFetchRef.current;
        if (away > STALE_THRESHOLD || stale > STALE_THRESHOLD) {
          silentRefresh();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [silentRefresh]);

  return { auth, stats, emails, events, files, loading, error, refresh };
}
