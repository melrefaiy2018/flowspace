/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGmailPage } from '../useGmailPage';
import { api, type GmailThreadSummary, type GmailLabel, type GmailThreadDetail } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    getGmailLabels: vi.fn(),
    getGmailThreads: vi.fn(),
    getInboxActionHistory: vi.fn(),
    performInboxAction: vi.fn(),
    undoInboxAction: vi.fn(),
    getGmailThread: vi.fn(),
    markThreadRead: vi.fn(),
    archiveThread: vi.fn(),
    trashThread: vi.fn(),
    getThreadEnrichments: vi.fn(),
  },
}));

function makeThread(overrides: Partial<GmailThreadSummary> = {}): GmailThreadSummary {
  return {
    id: 'thread-1',
    subject: 'Test Subject',
    snippet: 'Test snippet',
    from: 'Alice <alice@example.com>',
    date: '2026-03-09T10:00:00Z',
    unread: true,
    messageCount: 1,
    hasAttachments: false,
    labelIds: ['INBOX'],
    ...overrides,
  };
}

function makeLabel(overrides: Partial<GmailLabel> = {}): GmailLabel {
  return {
    id: 'INBOX',
    name: 'Inbox',
    type: 'system',
    messagesUnread: 5,
    ...overrides,
  };
}

function makeThreadDetail(overrides: Partial<GmailThreadDetail> = {}): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Test Subject',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'msg-1',
        from: 'Alice <alice@example.com>',
        to: 'me@example.com',
        cc: '',
        date: '2026-03-09T10:00:00Z',
        body: 'Hello!',
        bodyType: 'text',
        attachments: [],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return empty results
  vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
  vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [], nextPageToken: null, resultSizeEstimate: 0 });
  vi.mocked(api.getInboxActionHistory).mockResolvedValue({ actions: [] });
  // Default enrichment: resolves immediately with empty map
  vi.mocked(api.getThreadEnrichments).mockResolvedValue({
    enrichments: [],
    failed: [],
    cacheStats: { hits: 0, misses: 0, totalRequested: 0 },
    bucketCounts: { needs_reply: 0, waiting: 0, quick_wins: 0, reference_fyi: 0 },
    durationMs: 10,
  });
});

describe('useGmailPage', () => {
  it('starts with loading state and empty data', async () => {
    const { result } = renderHook(() => useGmailPage());

    expect(result.current.loading).toBe(true);
    expect(result.current.threads).toEqual([]);
    expect(result.current.labels).toEqual([]);
    expect(result.current.selectedThread).toBeNull();
    expect(result.current.activeLabel).toBe('INBOX');
    expect(result.current.searchQuery).toBe('');

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('fetches labels and threads on mount', async () => {
    const labels = [makeLabel(), makeLabel({ id: 'SENT', name: 'Sent', messagesUnread: 0 })];
    const threads = [makeThread(), makeThread({ id: 'thread-2', subject: 'Second' })];

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels });
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads, nextPageToken: null, resultSizeEstimate: 2 });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.labels).toEqual(labels);
    expect(result.current.threads).toEqual(threads);
    expect(api.getGmailThreads).toHaveBeenCalledWith({ label: 'INBOX', limit: 25 });
  });

  it('changes label and re-fetches threads', async () => {
    const inboxThreads = [makeThread()];
    const sentThreads = [makeThread({ id: 'sent-1', subject: 'Sent email', labelIds: ['SENT'] })];

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [makeLabel()] });
    vi.mocked(api.getGmailThreads)
      .mockResolvedValueOnce({ threads: inboxThreads, nextPageToken: null, resultSizeEstimate: 1 })
      .mockResolvedValueOnce({ threads: sentThreads, nextPageToken: null, resultSizeEstimate: 1 });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.threads).toEqual(inboxThreads);

    act(() => {
      result.current.setLabel('SENT');
    });

    await waitFor(() => expect(result.current.threads).toEqual(sentThreads));
    expect(api.getGmailThreads).toHaveBeenCalledWith({ label: 'SENT', limit: 25 });
  });

  it('searches threads with query', async () => {
    const searchResults = [makeThread({ id: 'search-1', subject: 'Found it' })];

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads)
      .mockResolvedValueOnce({ threads: [], nextPageToken: null, resultSizeEstimate: 0 })
      .mockResolvedValueOnce({ threads: searchResults, nextPageToken: null, resultSizeEstimate: 1 });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSearchQuery('Found');
    });

    await waitFor(() => expect(result.current.threads).toEqual(searchResults));
    expect(api.getGmailThreads).toHaveBeenCalledWith({ label: 'INBOX', q: 'Found', limit: 25 });
  });

  it('selects a thread and fetches detail', async () => {
    const thread = makeThread();
    const detail = makeThreadDetail();

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [thread], nextPageToken: null, resultSizeEstimate: 1 });
    vi.mocked(api.getGmailThread).mockResolvedValue(detail);
    vi.mocked(api.markThreadRead).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.selectThread('thread-1');
    });

    expect(result.current.selectedThread).toEqual(detail);
    expect(api.getGmailThread).toHaveBeenCalledWith('thread-1');
  });

  it('marks unread thread as read when selected', async () => {
    const thread = makeThread({ unread: true });
    const detail = makeThreadDetail();

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [thread], nextPageToken: null, resultSizeEstimate: 1 });
    vi.mocked(api.getGmailThread).mockResolvedValue(detail);
    vi.mocked(api.markThreadRead).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.selectThread('thread-1');
    });

    expect(api.markThreadRead).toHaveBeenCalledWith('thread-1');
  });

  it('deselects thread', async () => {
    const detail = makeThreadDetail();

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [makeThread()], nextPageToken: null, resultSizeEstimate: 1 });
    vi.mocked(api.getGmailThread).mockResolvedValue(detail);
    vi.mocked(api.markThreadRead).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.selectThread('thread-1');
    });
    expect(result.current.selectedThread).not.toBeNull();

    act(() => {
      result.current.deselectThread();
    });
    expect(result.current.selectedThread).toBeNull();
  });

  it('loads more threads with pagination', async () => {
    const page1 = [makeThread({ id: 'thread-1' })];
    const page2 = [makeThread({ id: 'thread-2' })];

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads)
      .mockResolvedValueOnce({ threads: page1, nextPageToken: 'token-2', resultSizeEstimate: 2 })
      .mockResolvedValueOnce({ threads: page2, nextPageToken: null, resultSizeEstimate: 2 });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.threads).toEqual(page1);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.threads).toEqual([...page1, ...page2]);
    expect(result.current.hasMore).toBe(false);
    expect(api.getGmailThreads).toHaveBeenCalledWith({ label: 'INBOX', limit: 25, pageToken: 'token-2' });
  });

  it('archives a thread and removes it from list', async () => {
    const threads = [makeThread({ id: 'thread-1' }), makeThread({ id: 'thread-2' })];

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads, nextPageToken: null, resultSizeEstimate: 2 });
    vi.mocked(api.performInboxAction).mockResolvedValue({
      action_type: 'archive_threads',
      requested_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      undo_available: true,
      audit_id: 'audit-1',
      items: [{ thread_id: 'thread-1', sender: 'Alice', subject: 'Test Subject', status: 'completed' }],
      message: 'Completed 1 action.',
    });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.archive('thread-1');
    });

    expect(api.performInboxAction).toHaveBeenCalledWith({ actionType: 'archive_threads', threadIds: ['thread-1'] });
    expect(api.getInboxActionHistory).toHaveBeenCalledTimes(2);
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].id).toBe('thread-2');
  });

  it('performs a bulk action for selected threads and can undo it', async () => {
    const threads = [makeThread({ id: 'thread-1' }), makeThread({ id: 'thread-2' })];
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads, nextPageToken: null, resultSizeEstimate: 2 });
    vi.mocked(api.performInboxAction).mockResolvedValue({
      action_type: 'archive_threads',
      requested_count: 2,
      succeeded_count: 2,
      failed_count: 0,
      undo_available: true,
      audit_id: 'audit-2',
      items: [
        { thread_id: 'thread-1', sender: 'Alice', subject: 'Test Subject', status: 'completed' },
        { thread_id: 'thread-2', sender: 'Alice', subject: 'Test Subject', status: 'completed' },
      ],
      message: 'Completed 2 actions.',
    });
    vi.mocked(api.undoInboxAction).mockResolvedValue({
      action_type: 'restore_threads',
      requested_count: 2,
      succeeded_count: 2,
      failed_count: 0,
      undo_available: false,
      audit_id: 'audit-2',
      items: [
        { thread_id: 'thread-1', sender: 'Alice', subject: 'Test Subject', status: 'completed' },
        { thread_id: 'thread-2', sender: 'Alice', subject: 'Test Subject', status: 'completed' },
      ],
      message: 'Undo completed.',
    });

    const { result } = renderHook(() => useGmailPage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleThreadSelection('thread-1');
      result.current.toggleThreadSelection('thread-2');
    });

    await act(async () => {
      await result.current.performBulkAction('archive_threads');
    });

    expect(api.performInboxAction).toHaveBeenCalledWith({ actionType: 'archive_threads', threadIds: ['thread-1', 'thread-2'] });
    expect(result.current.recentAction?.audit_id).toBe('audit-2');

    await act(async () => {
      await result.current.undoRecentAction();
    });

    expect(api.undoInboxAction).toHaveBeenCalledWith('audit-2');
    expect(api.getInboxActionHistory).toHaveBeenCalledTimes(4);
  });

  it('trashes a thread through inbox actions and removes it from list without undo', async () => {
    const threads = [makeThread({ id: 'thread-1' }), makeThread({ id: 'thread-2' })];

    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads, nextPageToken: null, resultSizeEstimate: 2 });
    vi.mocked(api.performInboxAction).mockResolvedValue({
      action_type: 'trash_threads',
      requested_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      undo_available: true,
      audit_id: 'audit-trash-1',
      items: [{ thread_id: 'thread-1', sender: 'Alice', subject: 'Test Subject', status: 'completed' }],
      message: 'Completed 1 action.',
    });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.trash('thread-1');
    });

    expect(api.performInboxAction).toHaveBeenCalledWith({ actionType: 'trash_threads', threadIds: ['thread-1'] });
    expect(api.getInboxActionHistory).toHaveBeenCalledTimes(2);
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].id).toBe('thread-2');
    expect(result.current.recentAction?.undo_available).toBe(true);
  });

  it('performs a bulk trash action for selected threads', async () => {
    const threads = [makeThread({ id: 'thread-1' }), makeThread({ id: 'thread-2' }), makeThread({ id: 'thread-3' })];
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads, nextPageToken: null, resultSizeEstimate: 3 });
    vi.mocked(api.performInboxAction).mockResolvedValue({
      action_type: 'trash_threads',
      requested_count: 2,
      succeeded_count: 2,
      failed_count: 0,
      undo_available: true,
      audit_id: 'audit-trash-2',
      items: [
        { thread_id: 'thread-1', sender: 'Alice', subject: 'Test Subject', status: 'completed' },
        { thread_id: 'thread-2', sender: 'Alice', subject: 'Test Subject', status: 'completed' },
      ],
      message: 'Completed 2 actions.',
    });

    const { result } = renderHook(() => useGmailPage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.toggleThreadSelection('thread-1');
      result.current.toggleThreadSelection('thread-2');
    });

    await act(async () => {
      await result.current.performBulkAction('trash_threads');
    });

    expect(api.performInboxAction).toHaveBeenCalledWith({ actionType: 'trash_threads', threadIds: ['thread-1', 'thread-2'] });
    expect(result.current.threads.map((thread) => thread.id)).toEqual(['thread-3']);
    expect(result.current.recentAction?.undo_available).toBe(true);
  });

  it('handles fetch error gracefully', async () => {
    vi.mocked(api.getGmailLabels).mockRejectedValue(new Error('Network error'));
    vi.mocked(api.getGmailThreads).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Network error');
    expect(result.current.threads).toEqual([]);
  });

  it('refreshes data', async () => {
    vi.mocked(api.getGmailLabels).mockResolvedValue({ labels: [] });
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [], nextPageToken: null, resultSizeEstimate: 0 });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Labels fetched twice: initial + refresh
    expect(api.getGmailLabels).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// T016: Parallel enrichment fetch behaviour
// ---------------------------------------------------------------------------
describe('useGmailPage — T016 parallel enrichment fetch', () => {
  it('(a+c) thread list populates before enrichment resolves', async () => {
    const thread = makeThread();
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [thread], nextPageToken: null, resultSizeEstimate: 1 });

    // Enrichment is a slow promise that we control
    let resolveEnrichment!: (v: any) => void;
    const enrichmentPromise = new Promise<any>((resolve) => { resolveEnrichment = resolve; });
    vi.mocked(api.getThreadEnrichments).mockReturnValue(enrichmentPromise);

    const { result } = renderHook(() => useGmailPage());

    // Wait for the main list to be loaded (loading = false, threads populated)
    await waitFor(() => expect(result.current.loading).toBe(false));

    // (a) Thread list is populated
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].id).toBe('thread-1');

    // (c) Enrichment map is still empty (enrichment not resolved yet)
    expect(result.current.enrichmentMap.size).toBe(0);
    expect(result.current.fallbackReason).toBeNull();

    // Now resolve enrichment
    await act(async () => {
      resolveEnrichment({
        enrichments: [{
          threadId: 'thread-1',
          priority: 'high',
          recommendedAction: 'draft_reply',
          whyItMatters: 'Reply needed.',
          effortMinutes: '5',
          bucket: 'needs_reply',
        }],
        failed: [],
        cacheStats: { hits: 0, misses: 1, totalRequested: 1 },
        bucketCounts: { needs_reply: 1, waiting: 0, quick_wins: 0, reference_fyi: 0 },
        durationMs: 800,
      });
    });

    // (b) Enrichment map now populated
    await waitFor(() => expect(result.current.enrichmentMap.size).toBe(1));
    expect(result.current.enrichmentMap.get('thread-1')?.priority).toBe('high');
  });

  it('enrichmentStatus transitions idle → loading → ready on success', async () => {
    const thread = makeThread();
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [thread], nextPageToken: null, resultSizeEstimate: 1 });

    let resolveEnrichment!: (v: any) => void;
    const enrichmentPromise = new Promise<any>((resolve) => { resolveEnrichment = resolve; });
    vi.mocked(api.getThreadEnrichments).mockReturnValue(enrichmentPromise);

    const { result } = renderHook(() => useGmailPage());

    // While enrichment is in flight, status is 'loading'
    await waitFor(() => expect(result.current.enrichmentStatus).toBe('loading'));
    expect(result.current.fallbackReason).toBeNull();

    await act(async () => {
      resolveEnrichment({
        enrichments: [{ threadId: 'thread-1', priority: 'high', recommendedAction: 'draft_reply', whyItMatters: 'x', effortMinutes: '5', bucket: 'needs_reply' }],
        failed: [],
        cacheStats: { hits: 0, misses: 1, totalRequested: 1 },
        bucketCounts: { needs_reply: 1, waiting: 0, quick_wins: 0, reference_fyi: 0 },
        durationMs: 100,
      });
    });

    await waitFor(() => expect(result.current.enrichmentStatus).toBe('ready'));
  });

  it('enrichmentStatus transitions to failed when enrichment rejects', async () => {
    const thread = makeThread();
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [thread], nextPageToken: null, resultSizeEstimate: 1 });
    vi.mocked(api.getThreadEnrichments).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.enrichmentStatus).toBe('failed'));
    expect(result.current.fallbackReason).toBe('boom');
  });

  it('(d) on enrichment failure, map stays empty and fallbackReason is set', async () => {
    const thread = makeThread();
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [thread], nextPageToken: null, resultSizeEstimate: 1 });
    vi.mocked(api.getThreadEnrichments).mockRejectedValue(new Error('enrichment_timeout'));

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.fallbackReason).not.toBeNull());

    expect(result.current.enrichmentMap.size).toBe(0);
    expect(result.current.fallbackReason).toBe('enrichment_timeout');
  });

  it('(e) invalidateLocalEnrichment removes the entry from the map', async () => {
    const thread = makeThread();
    vi.mocked(api.getGmailThreads).mockResolvedValue({ threads: [thread], nextPageToken: null, resultSizeEstimate: 1 });
    vi.mocked(api.getThreadEnrichments).mockResolvedValue({
      enrichments: [{
        threadId: 'thread-1',
        priority: 'high',
        recommendedAction: 'draft_reply',
        whyItMatters: 'Reply.',
        effortMinutes: '5',
        bucket: 'needs_reply',
      }],
      failed: [],
      cacheStats: { hits: 0, misses: 1, totalRequested: 1 },
      bucketCounts: { needs_reply: 1, waiting: 0, quick_wins: 0, reference_fyi: 0 },
      durationMs: 100,
    });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.enrichmentMap.size).toBe(1));

    act(() => {
      result.current.invalidateLocalEnrichment('thread-1');
    });

    expect(result.current.enrichmentMap.size).toBe(0);
    expect(result.current.enrichmentMap.has('thread-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectNextInQueue
// ---------------------------------------------------------------------------
describe('useGmailPage — selectNextInQueue', () => {
  /**
   * Helper: build three threads in needs_reply + one in waiting, with matching
   * enrichment entries so assignBucketsFromEnrichment places them correctly.
   */
  function setupThreeNeedsReplyOneWaiting() {
    const t1 = makeThread({ id: 'nr-1' });
    const t2 = makeThread({ id: 'nr-2' });
    const t3 = makeThread({ id: 'nr-3' });
    const w1 = makeThread({ id: 'w-1' });

    vi.mocked(api.getGmailThreads).mockResolvedValue({
      threads: [t1, t2, t3, w1],
      nextPageToken: null,
      resultSizeEstimate: 4,
    });
    vi.mocked(api.getThreadEnrichments).mockResolvedValue({
      enrichments: [
        { threadId: 'nr-1', priority: 'high', recommendedAction: 'draft_reply', whyItMatters: 'a', effortMinutes: '5', bucket: 'needs_reply' },
        { threadId: 'nr-2', priority: 'high', recommendedAction: 'draft_reply', whyItMatters: 'b', effortMinutes: '5', bucket: 'needs_reply' },
        { threadId: 'nr-3', priority: 'high', recommendedAction: 'draft_reply', whyItMatters: 'c', effortMinutes: '5', bucket: 'needs_reply' },
        { threadId: 'w-1',  priority: 'medium', recommendedAction: 'nudge', whyItMatters: 'd', effortMinutes: '5', bucket: 'waiting' },
      ],
      failed: [],
      cacheStats: { hits: 0, misses: 4, totalRequested: 4 },
      bucketCounts: { needs_reply: 3, waiting: 1, quick_wins: 0, reference_fyi: 0 },
      durationMs: 10,
    });
    vi.mocked(api.getGmailThread).mockImplementation((id) => Promise.resolve(makeThreadDetail({ id })));
    vi.mocked(api.markThreadRead).mockResolvedValue({ success: true });
  }

  it('selectNextInQueue advances to the 2nd thread when selection is the 1st in needs_reply', async () => {
    setupThreeNeedsReplyOneWaiting();
    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.enrichmentMap.size).toBe(4));

    // Select the first needs_reply thread
    await act(async () => { await result.current.selectThread('nr-1'); });
    expect(result.current.selectedThread?.id).toBe('nr-1');

    // Advance to next
    await act(async () => { result.current.selectNextInQueue(); });

    // Should now be the second needs_reply thread
    expect(result.current.selectedThread?.id).toBe('nr-2');
  });

  it('selectNextInQueue advances to first waiting thread when at the last needs_reply thread', async () => {
    setupThreeNeedsReplyOneWaiting();
    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.enrichmentMap.size).toBe(4));

    // Select the last needs_reply thread
    await act(async () => { await result.current.selectThread('nr-3'); });
    expect(result.current.selectedThread?.id).toBe('nr-3');

    // Advance to next
    await act(async () => { result.current.selectNextInQueue(); });

    // Should advance to first waiting thread
    expect(result.current.selectedThread?.id).toBe('w-1');
  });

  it('selectNextInQueue deselects when at the last thread in all buckets', async () => {
    // Only one thread — the last in all queues
    vi.mocked(api.getGmailThreads).mockResolvedValue({
      threads: [makeThread({ id: 'solo' })],
      nextPageToken: null,
      resultSizeEstimate: 1,
    });
    vi.mocked(api.getThreadEnrichments).mockResolvedValue({
      enrichments: [
        { threadId: 'solo', priority: 'high', recommendedAction: 'draft_reply', whyItMatters: 'x', effortMinutes: '5', bucket: 'needs_reply' },
      ],
      failed: [],
      cacheStats: { hits: 0, misses: 1, totalRequested: 1 },
      bucketCounts: { needs_reply: 1, waiting: 0, quick_wins: 0, reference_fyi: 0 },
      durationMs: 10,
    });
    vi.mocked(api.getGmailThread).mockResolvedValue(makeThreadDetail({ id: 'solo' }));
    vi.mocked(api.markThreadRead).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useGmailPage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.enrichmentMap.size).toBe(1));

    await act(async () => { await result.current.selectThread('solo'); });
    expect(result.current.selectedThread?.id).toBe('solo');

    act(() => { result.current.selectNextInQueue(); });

    // No next item — should deselect
    expect(result.current.selectedThread).toBeNull();
  });
});
