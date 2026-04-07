import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Briefing } from '../services/api';
import {
  buildAttentionFeedbackTarget,
  buildTriageFeedbackTarget,
  getImportanceFeedbackKey,
  type ImportanceFeedbackTarget,
} from '../lib/importance-feedback';

const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
function briefingStorageKey(accountKey?: string) {
  return accountKey ? `flowspace:briefing-cache:${accountKey}` : 'flowspace:briefing-cache';
}

/** Remove all briefing caches from localStorage. */
export function clearBriefingStorage(accountKey?: string): void {
  if (typeof window === 'undefined') return;
  // Clear the specific key if given
  if (accountKey) {
    window.localStorage.removeItem(briefingStorageKey(accountKey));
  }
  // Also clear all matching keys (handles unknown account keys)
  const keysToRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith('flowspace:briefing-cache')) keysToRemove.push(key);
  }
  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

type StoredBriefing = {
  briefing: Briefing;
  savedAt: number;
};

function loadStoredBriefing(accountKey?: string): Briefing | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(briefingStorageKey(accountKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredBriefing>;
    if (!parsed.briefing || typeof parsed.savedAt !== 'number') return null;
    if (parsed.briefing.error) return null;
    return parsed.briefing;
  } catch {
    return null;
  }
}

function persistBriefing(briefing: Briefing, accountKey?: string): void {
  if (typeof window === 'undefined' || briefing.error) return;

  try {
    const payload: StoredBriefing = { briefing, savedAt: Date.now() };
    window.localStorage.setItem(briefingStorageKey(accountKey), JSON.stringify(payload));
  } catch {
    // Ignore storage failures and keep runtime state working.
  }
}

function filterBriefingByHiddenTargets(briefing: Briefing | null, hiddenKeys: Set<string>): Briefing | null {
  if (!briefing || hiddenKeys.size === 0) return briefing;

  const shouldKeep = (target?: ImportanceFeedbackTarget) => !hiddenKeys.has(getImportanceFeedbackKey(target));

  return {
    ...briefing,
    attention_items: briefing.attention_items.filter((item) => shouldKeep(buildAttentionFeedbackTarget(item))),
    inbox_triage: {
      ...briefing.inbox_triage,
      needs_reply: briefing.inbox_triage.needs_reply.filter((item) => shouldKeep(buildTriageFeedbackTarget(item, 'needs_reply'))),
      needs_input: briefing.inbox_triage.needs_input.filter((item) => shouldKeep(buildTriageFeedbackTarget(item, 'needs_input'))),
      fyi_only: briefing.inbox_triage.fyi_only.filter((item) => shouldKeep(buildTriageFeedbackTarget(item, 'fyi_only'))),
      can_ignore: briefing.inbox_triage.can_ignore.filter((item) => shouldKeep(buildTriageFeedbackTarget(item, 'can_ignore'))),
    },
  };
}

export interface BriefingState {
  briefing: Briefing | null;
  loading: boolean;
  error: boolean;
  retrying: boolean;
  newItemCount: number;
  acknowledge: () => void;
  refresh: () => void;
  ignoreTarget: (target?: ImportanceFeedbackTarget) => void;
  restoreTarget: (target?: ImportanceFeedbackTarget) => void;
  isTargetIgnored: (target?: ImportanceFeedbackTarget) => boolean;
}

export function useBriefing(accountKey?: string): BriefingState {
  const initialBriefingRef = useRef<Briefing | null | undefined>(undefined);
  if (typeof initialBriefingRef.current === 'undefined') {
    initialBriefingRef.current = loadStoredBriefing(accountKey);
  }

  const [briefing, setBriefing] = useState<Briefing | null>(initialBriefingRef.current ?? null);
  const [loading, setLoading] = useState(initialBriefingRef.current == null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [newItemCount, setNewItemCount] = useState(0);
  const [hiddenTargetKeys, setHiddenTargetKeys] = useState<Set<string>>(new Set());
  const prevItemIds = useRef<Set<string>>(new Set());

  const fetchBriefing = useCallback(async (silent = false, forceRefresh = false) => {
    if (!silent) setLoading(true);
    setError(false);
    setRetrying(false);

    const tryFetch = async (): Promise<Briefing | null> => {
      const result = await api.getBriefing(forceRefresh);
      if (result.error) return null;
      return result;
    };

    try {
      let result = await tryFetch();

      // Retry once after 3s if first attempt returned an error
      if (!result) {
        setRetrying(true);
        await new Promise((r) => setTimeout(r, 3000));
        result = await tryFetch();
        setRetrying(false);
      }

      if (!result) {
        setError(true);
        if (!silent) setLoading(false);
        return;
      }

      // Detect new attention items on silent refresh
      if (silent && result.attention_items) {
        const newIds = new Set(result.attention_items.map((i) => i.action_context));
        let count = 0;
        for (const id of newIds) {
          if (!prevItemIds.current.has(id)) count++;
        }
        if (count > 0) setNewItemCount(count);
        prevItemIds.current = newIds;
      } else if (result.attention_items) {
        prevItemIds.current = new Set(result.attention_items.map((i) => i.action_context));
      }

      setBriefing(result);
      persistBriefing(result, accountKey);
    } catch {
      setRetrying(false);
      setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accountKey]);

  const acknowledge = useCallback(() => setNewItemCount(0), []);
  const refresh = useCallback(() => fetchBriefing(false, true), [fetchBriefing]);
  const ignoreTarget = useCallback((target?: ImportanceFeedbackTarget) => {
    const key = getImportanceFeedbackKey(target);
    if (!key) return;
    setHiddenTargetKeys((prev) => new Set(prev).add(key));
  }, []);
  const restoreTarget = useCallback((target?: ImportanceFeedbackTarget) => {
    const key = getImportanceFeedbackKey(target);
    if (!key) return;
    setHiddenTargetKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);
  const isTargetIgnored = useCallback((target?: ImportanceFeedbackTarget) => {
    const key = getImportanceFeedbackKey(target);
    return key ? hiddenTargetKeys.has(key) : false;
  }, [hiddenTargetKeys]);

  // Initial fetch
  useEffect(() => {
    const cached = initialBriefingRef.current ?? null;
    if (cached?.attention_items) {
      prevItemIds.current = new Set(cached.attention_items.map((i) => i.action_context));
    }
    fetchBriefing(cached !== null);
  }, [accountKey, fetchBriefing]);

  // Auto-refresh every 30 minutes
  useEffect(() => {
    const interval = setInterval(() => fetchBriefing(true), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchBriefing]);

  return {
    briefing: filterBriefingByHiddenTargets(briefing, hiddenTargetKeys),
    loading,
    error,
    retrying,
    newItemCount,
    acknowledge,
    refresh,
    ignoreTarget,
    restoreTarget,
    isTargetIgnored,
  };
}
