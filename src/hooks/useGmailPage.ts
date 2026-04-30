import { useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  type GmailLabel,
  type GmailThreadSummary,
  type GmailThreadDetail,
} from '../services/api';
import type { InboxActionAuditRecord, InboxActionResult, InboxActionType } from '../shared/chat';
import type { ThreadEnrichment } from '../shared/gmail-enrichment-types.js';
import { batchEnrichments } from '../lib/enrichment-batcher.js';
import { assignBucketsFromEnrichment } from '../lib/triage.js';

const PAGE_SIZE = 25;
const ENRICHMENT_BATCH_SIZE = 3;

export interface GmailPageState {
  threads: GmailThreadSummary[];
  labels: GmailLabel[];
  selectedThread: GmailThreadDetail | null;
  activeLabel: string;
  searchQuery: string;
  loading: boolean;
  threadLoading: boolean;
  error: string | null;
  hasMore: boolean;
  selectedThreadIds: string[];
  recentAction: InboxActionResult | null;
  actionHistory: InboxActionAuditRecord[];
  setLabel: (labelId: string) => void;
  setSearchQuery: (query: string) => void;
  selectThread: (threadId: string) => Promise<void>;
  deselectThread: () => void;
  loadMore: () => Promise<void>;
  toggleThreadSelection: (threadId: string) => void;
  selectAllVisibleThreads: () => void;
  clearSelection: () => void;
  performBulkAction: (actionType: InboxActionType, options?: { labelName?: string; sender?: string; subject?: string; archive?: boolean; markRead?: boolean; skipInbox?: boolean }) => Promise<void>;
  undoRecentAction: () => Promise<void>;
  archive: (threadId: string) => Promise<void>;
  trash: (threadId: string) => Promise<void>;
  refresh: () => void;
  enrichmentMap: Map<string, ThreadEnrichment>;
  fallbackReason: string | null;
  enrichmentStatus: EnrichmentStatus;
  enrichmentProgress: EnrichmentProgress | null;
  enrichmentQueue: Set<string>;
  invalidateLocalEnrichment: (threadId: string) => void;
  /** Advance selection to the next thread in the queue, staying in the same
   *  bucket if possible. Falls back to the next bucket in priority order.
   *  Calls deselectThread() if there is no next item. */
  selectNextInQueue: () => void;
}

export type EnrichmentStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface EnrichmentProgress {
  completed: number;
  total: number;
}

export function useGmailPage(accountKey?: string): GmailPageState {
  const [threads, setThreads] = useState<GmailThreadSummary[]>([]);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [selectedThread, setSelectedThread] = useState<GmailThreadDetail | null>(null);
  const [activeLabel, setActiveLabel] = useState('INBOX');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [recentAction, setRecentAction] = useState<InboxActionResult | null>(null);
  const [actionHistory, setActionHistory] = useState<InboxActionAuditRecord[]>([]);
  const [enrichmentMap, setEnrichmentMap] = useState<Map<string, ThreadEnrichment>>(new Map());
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatus>('idle');
  const [enrichmentProgress, setEnrichmentProgress] = useState<EnrichmentProgress | null>(null);
  const [enrichmentQueue, setEnrichmentQueue] = useState<Set<string>>(new Set());
  const enrichmentFired = useRef(false);
  const enrichmentAbortRef = useRef<AbortController | null>(null);

  const refreshActionHistory = useCallback(async () => {
    const historyRes = await api.getInboxActionHistory();
    setActionHistory(historyRes.actions);
  }, []);

  // Fetch labels and threads on mount or when label/query/refreshKey changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setThreads([]);
    setNextPageToken(null);

    const params: { label: string; q?: string; limit: number } = {
      label: activeLabel,
      limit: PAGE_SIZE,
    };
    if (searchQuery) params.q = searchQuery;

    Promise.all([
      api.getGmailLabels(),
      api.getGmailThreads(params),
      api.getInboxActionHistory(),
    ])
      .then(([labelsRes, threadsRes, historyRes]) => {
        if (cancelled) return;
        setLabels(labelsRes.labels);
        setThreads(threadsRes.threads);
        setNextPageToken(threadsRes.nextPageToken);
        setActionHistory(historyRes.actions);

        if (threadsRes.threads.length > 0) {
          enrichmentFired.current = false;
          setFallbackReason(null);
          setEnrichmentStatus('loading');
          setEnrichmentProgress({ completed: 0, total: threadsRes.threads.length });
          // Seed the queue with every thread id; entries leave the queue as
          // each batch completes (successful or failed).
          setEnrichmentQueue(new Set(threadsRes.threads.map((t) => t.id)));
          setEnrichmentMap(new Map());

          const controller = new AbortController();
          // Store on a ref-adjacent local so the cleanup below can abort.
          // We don't track this in state because re-renders shouldn't cancel.
          enrichmentAbortRef.current = controller;

          batchEnrichments(
            threadsRes.threads,
            ENRICHMENT_BATCH_SIZE,
            (chunk) => api.getThreadEnrichments(chunk),
            (progress) => {
              if (cancelled) return;
              // Merge this batch's enrichments into the map.
              setEnrichmentMap((prev) => {
                const next = new Map(prev);
                for (const e of progress.batchEnrichments) next.set(e.threadId, e);
                return next;
              });
              // Remove processed ids from the queue (both successful and failed).
              setEnrichmentQueue((prev) => {
                const next = new Set(prev);
                for (const e of progress.batchEnrichments) next.delete(e.threadId);
                for (const id of progress.batchFailed) next.delete(id);
                return next;
              });
              setEnrichmentProgress({ completed: progress.completed, total: progress.total });
            },
            controller.signal,
          )
            .then((result) => {
              if (cancelled) return;
              // If every thread failed, surface the fallback banner. Prefer
              // the underlying error message (e.g. 'enrichment_timeout')
              // over a generic label so the user / console has a clue.
              if (result.enrichments.length === 0 && result.failed.length > 0) {
                setFallbackReason(result.lastError || 'enrichment_all_failed');
                setEnrichmentStatus('failed');
              } else {
                setEnrichmentStatus('ready');
              }
              setEnrichmentProgress(null);
            })
            .catch((err: Error) => {
              // batchEnrichments itself doesn't throw, but keep a safety net.
              if (cancelled) return;
              setFallbackReason(err.message || 'enrichment_failed');
              setEnrichmentStatus('failed');
              setEnrichmentProgress(null);
            });
        } else {
          setEnrichmentStatus('idle');
          setEnrichmentProgress(null);
          setEnrichmentQueue(new Set());
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      // Abort any in-flight enrichment batches so a fast refresh / navigation
      // doesn't leave pending HTTP requests that would resolve into stale state.
      enrichmentAbortRef.current?.abort();
      enrichmentAbortRef.current = null;
    };
  }, [accountKey, activeLabel, searchQuery, refreshKey]);

  const selectThread = useCallback(async (threadId: string) => {
    setThreadLoading(true);
    try {
      const detail = await api.getGmailThread(threadId);
      setSelectedThread(detail);

      // Mark as read if the thread was unread (optimistic update)
      const thread = threads.find((t) => t.id === threadId);
      if (thread?.unread) {
        api.markThreadRead(threadId).catch(() => {});
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t))
        );
      }
    } catch (err: Error | any) {
      setError(err.message);
    } finally {
      setThreadLoading(false);
    }
  }, [threads]);

  const deselectThread = useCallback(() => {
    setSelectedThread(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextPageToken) return;

    const params: { label: string; q?: string; limit: number; pageToken: string } = {
      label: activeLabel,
      limit: PAGE_SIZE,
      pageToken: nextPageToken,
    };
    if (searchQuery) params.q = searchQuery;

    try {
      const res = await api.getGmailThreads(params);
      setThreads((prev) => [...prev, ...res.threads]);
      setNextPageToken(res.nextPageToken);
    } catch (err: Error | any) {
      setError(err.message);
    }
  }, [nextPageToken, activeLabel, searchQuery]);

  const applyActionResult = useCallback((result: InboxActionResult) => {
    setRecentAction(result);

    if (
      result.action_type === 'archive_threads'
      || result.action_type === 'trash_threads'
      || result.action_type === 'restore_threads'
      || result.action_type === 'untrash_threads'
      || result.action_type === 'unmute_threads'
      || result.action_type === 'mark_unread'
      || result.action_type === 'remove_label'
    ) {
      const succeeded = new Set(result.items.filter((item) => item.status === 'completed').map((item) => item.thread_id));
      if (result.action_type === 'archive_threads' || result.action_type === 'trash_threads') {
        setThreads((prev) => prev.filter((thread) => !succeeded.has(thread.id)));
        setSelectedThreadIds([]);
        if (selectedThread && succeeded.has(selectedThread.id)) setSelectedThread(null);
      } else {
        setRefreshKey((value) => value + 1);
      }
    }
  }, [selectedThread]);

  const archive = useCallback(async (threadId: string) => {
    const result = await api.performInboxAction({ actionType: 'archive_threads', threadIds: [threadId] });
    applyActionResult(result);
    await refreshActionHistory();
  }, [applyActionResult, refreshActionHistory]);

  const trash = useCallback(async (threadId: string) => {
    const result = await api.performInboxAction({ actionType: 'trash_threads', threadIds: [threadId] });
    applyActionResult(result);
    await refreshActionHistory();
  }, [applyActionResult, refreshActionHistory]);

  const toggleThreadSelection = useCallback((threadId: string) => {
    setSelectedThreadIds((prev) => prev.includes(threadId)
      ? prev.filter((id) => id !== threadId)
      : [...prev, threadId]);
  }, []);

  const selectAllVisibleThreads = useCallback(() => {
    setSelectedThreadIds(threads.map((thread) => thread.id));
  }, [threads]);

  const clearSelection = useCallback(() => {
    setSelectedThreadIds([]);
  }, []);

  const performBulkAction = useCallback(async (
    actionType: InboxActionType,
    options: { labelName?: string; sender?: string; subject?: string; archive?: boolean; markRead?: boolean; skipInbox?: boolean } = {},
  ) => {
    const threadIds = selectedThreadIds;
    if (actionType !== 'create_filter' && threadIds.length === 0) {
      throw new Error('Select at least one thread first.');
    }
    const result = await api.performInboxAction({
      actionType,
      threadIds,
      ...options,
    });
    applyActionResult(result);
    await refreshActionHistory();
  }, [applyActionResult, refreshActionHistory, selectedThreadIds]);

  const undoRecentAction = useCallback(async () => {
    if (!recentAction?.audit_id) return;
    const result = await api.undoInboxAction(recentAction.audit_id);
    applyActionResult(result);
    await refreshActionHistory();
  }, [applyActionResult, recentAction, refreshActionHistory]);

  const setLabel = useCallback((labelId: string) => {
    setActiveLabel(labelId);
    setSelectedThread(null);
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const invalidateLocalEnrichment = useCallback((threadId: string) => {
    setEnrichmentMap((prev) => {
      const next = new Map(prev);
      next.delete(threadId);
      return next;
    });
    setEnrichmentQueue((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
  }, []);

  /**
   * Advance selection to the next thread in the queue.
   * Priority bucket order: needs_reply → waiting → quick_wins → reference_fyi.
   * - If the current thread is not the last in its bucket, selects the next one.
   * - Otherwise advances to the first thread in the next non-empty bucket.
   * - If no next thread exists, calls deselectThread().
   */
  const selectNextInQueue = useCallback(() => {
    const buckets = assignBucketsFromEnrichment(threads, enrichmentMap);
    const bucketOrder = ['needs_reply', 'waiting', 'quick_wins', 'reference_fyi'] as const;
    const currentId = selectedThread?.id;

    // Find the current thread's bucket and position
    let currentBucketIndex = -1;
    let currentThreadIndex = -1;
    for (let bi = 0; bi < bucketOrder.length; bi++) {
      const bucket = buckets[bucketOrder[bi]];
      const ti = bucket.findIndex((t) => t.id === currentId);
      if (ti !== -1) {
        currentBucketIndex = bi;
        currentThreadIndex = ti;
        break;
      }
    }

    if (currentBucketIndex === -1) {
      // Current selection not found in any bucket — deselect
      deselectThread();
      return;
    }

    // Try next thread in same bucket
    const sameBucket = buckets[bucketOrder[currentBucketIndex]];
    if (currentThreadIndex < sameBucket.length - 1) {
      const nextThread = sameBucket[currentThreadIndex + 1];
      void selectThread(nextThread.id);
      return;
    }

    // Try first thread in subsequent buckets
    for (let bi = currentBucketIndex + 1; bi < bucketOrder.length; bi++) {
      const nextBucket = buckets[bucketOrder[bi]];
      if (nextBucket.length > 0) {
        void selectThread(nextBucket[0].id);
        return;
      }
    }

    // No next item — deselect
    deselectThread();
  }, [threads, enrichmentMap, selectedThread, selectThread, deselectThread]);

  return {
    threads,
    labels,
    selectedThread,
    activeLabel,
    searchQuery,
    loading,
    threadLoading,
    error,
    hasMore: nextPageToken !== null,
    selectedThreadIds,
    recentAction,
    actionHistory,
    setLabel,
    setSearchQuery,
    selectThread,
    deselectThread,
    loadMore,
    toggleThreadSelection,
    selectAllVisibleThreads,
    clearSelection,
    performBulkAction,
    undoRecentAction,
    archive,
    trash,
    refresh,
    enrichmentMap,
    fallbackReason,
    enrichmentStatus,
    enrichmentProgress,
    enrichmentQueue,
    invalidateLocalEnrichment,
    selectNextInQueue,
  };
}
