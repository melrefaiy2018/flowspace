import { useState, useEffect, useRef } from 'react';
import type { ThreadBrief } from '../shared/gmail-enrichment-types.js';
import { api } from '../services/api.js';

export interface UseThreadBriefResult {
  brief: ThreadBrief | null;
  loading: boolean;
  error: Error | null;
}

function makeFallbackBrief(threadId: string): ThreadBrief {
  return {
    threadId,
    summary: '',
    recommendedAction: '',
    contextChips: [],
    firstClassActions: [{ kind: 'draft_reply' }],
    isFallback: true,
    cachedAt: new Date().toISOString(),
  };
}

export function useThreadBrief(threadId: string | null): UseThreadBriefResult {
  const [brief, setBrief] = useState<ThreadBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Per-hook-instance memo cache — avoids re-fetching threads already loaded
  const cache = useRef<Map<string, ThreadBrief>>(new Map());

  useEffect(() => {
    if (threadId === null) {
      setBrief(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Cache hit — return synchronously without a network call
    const cached = cache.current.get(threadId);
    if (cached) {
      setBrief(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    // Clear the previous thread's brief so the loading state doesn't render
    // stale recommendations/context for the newly selected item.
    setBrief(null);
    setLoading(true);
    setError(null);

    api.getThreadBrief(threadId)
      .then((response) => {
        if (cancelled) return;
        cache.current.set(threadId, response.brief);
        setBrief(response.brief);
        setLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setBrief(makeFallbackBrief(threadId));
        setLoading(false);
        setError(errorObj);
      });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  return { brief, loading, error };
}
