import { useState, useEffect, useCallback } from 'react';
import {
  api,
  type GmailLabel,
  type GmailThreadSummary,
  type GmailThreadDetail,
} from '../services/api';
import type { InboxActionAuditRecord, InboxActionResult, InboxActionType } from '../shared/chat';

const PAGE_SIZE = 25;

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
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
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
  };
}
