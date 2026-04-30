import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useResizablePane } from '../hooks/useResizablePane';
import { Search, X, RefreshCw, Bookmark, List } from 'lucide-react';
import { useGmailPage } from '../hooks/useGmailPage';
import { useChatContext } from '../context/ChatContext';
import { buildGmailAgentPrompt, gmailAgentDisplayText, type GmailAgentAction } from '../lib/gmail-agent';
import { workItemFromGmailThread } from '../lib/work-item';
import type { WorkItem } from '../lib/work-item';
import type { SecondaryAction } from '../lib/gmail-work-registry';
import LabelFilter from '../components/gmail/LabelFilter';
import SmartViewUnavailableBanner from '../components/gmail/SmartViewUnavailableBanner';
import EnrichmentProgressBanner from '../components/gmail/EnrichmentProgressBanner';
import BucketedThreadList from '../components/gmail/BucketedThreadList';
import SavedThreadList from '../components/gmail/SavedThreadList';
import GmailWorkspace from '../components/gmail/workspace/GmailWorkspace';
import { type GmailThreadDetail, type SavedEmail } from '../services/api';

export default function GmailPage({
  accountKey,
  initialTab,
  initialThreadId,
  initialThreadNonce,
  onInitialThreadHandled,
  savedEmails,
  onUnsaveEmail,
}: {
  accountKey?: string;
  initialTab?: string;
  initialThreadId?: string;
  initialThreadNonce?: number;
  onInitialThreadHandled?: () => void;
  savedEmails?: SavedEmail[];
  onUnsaveEmail?: (id: string) => void;
}) {
  const gmail = useGmailPage(accountKey);
  const { sendMessage, clearNavigateTab, navigateRefresh, clearNavigateRefresh } = useChatContext();
  const [searchInput, setSearchInput] = useState('');
  const [showActionDetails, setShowActionDetails] = useState(false);
  const [showRawInbox, setShowRawInbox] = useState<boolean>(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('flowspace.gmail.showRawInbox') === 'true',
  );
  const [savedOpen, setSavedOpen] = useState(false);

  // T025: Track mount time for first-paint telemetry
  const mountTime = useRef(typeof performance !== 'undefined' ? performance.now() : 0);

  // initialTab === 'triage' or 'saved' are now no-ops (tab removed in Phase A)
  // clear the navigation hint so it doesn't accumulate
  useEffect(() => {
    if (initialTab === 'triage' || initialTab === 'saved') {
      clearNavigateTab();
    }
  }, [initialTab, clearNavigateTab]);

  const { refresh, selectThread, setSearchQuery } = gmail;

  // Refresh threads when agent triggers a triage refresh
  useEffect(() => {
    if (navigateRefresh) {
      refresh();
      clearNavigateRefresh();
    }
  }, [navigateRefresh, clearNavigateRefresh, refresh]);

  useEffect(() => {
    if (!initialThreadId) return;
    void selectThread(initialThreadId).finally(() => {
      onInitialThreadHandled?.();
    });
  }, [selectThread, initialThreadId, initialThreadNonce, onInitialThreadHandled]);

  // T025: Emit gmail-interactive telemetry on first successful paint
  const telemetrySent = useRef(false);
  useEffect(() => {
    if (telemetrySent.current) return;
    if (gmail.loading) return;
    if (gmail.threads.length === 0 && !gmail.error) return;
    telemetrySent.current = true;
    const durationMs = typeof performance !== 'undefined' ? performance.now() - mountTime.current : 0;
    void fetch('/api/telemetry/gmail-interactive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMs }),
    }).catch(() => {/* best-effort — telemetry failure must not break the UI */});
  }, [gmail.loading, gmail.threads.length, gmail.error]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
  }, [searchInput, setSearchQuery]);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
  }, [setSearchQuery]);

  const handleAgentAction = useCallback((thread: GmailThreadDetail, action: GmailAgentAction, question?: string) => {
    const prompt = buildGmailAgentPrompt(thread, action, question);
    const displayContent = gmailAgentDisplayText(thread, action, question);
    const preserveActiveView = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
    void sendMessage(prompt, { forceNewChat: true, preserveActiveView, displayContent });
  }, [sendMessage]);

  const handleToggleRawInbox = useCallback(() => {
    setShowRawInbox((prev) => {
      const next = !prev;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('flowspace.gmail.showRawInbox', String(next));
      }
      return next;
    });
  }, []);

  // Build a WorkItem from the currently selected thread + enrichment
  const workItem: WorkItem | null = useMemo(() => {
    if (!gmail.selectedThread) return null;
    const threadSummary = gmail.threads.find((t) => t.id === gmail.selectedThread!.id);
    if (!threadSummary) return null;
    const enrichment = gmail.enrichmentMap.get(gmail.selectedThread.id);
    return workItemFromGmailThread(threadSummary, enrichment);
  }, [gmail.selectedThread, gmail.enrichmentMap, gmail.threads]);

  // Workspace action handlers
  const handlePrimaryAction = useCallback((_item: WorkItem) => {
    // Panes handle their own primary behavior via onAgentAction.
    // This handler is a safe no-op at the workspace header level for v1.
    // Commit 6 will wire completion state here.
  }, []);

  const handleSecondaryAction = useCallback((item: WorkItem, kind: string) => {
    if (!gmail.selectedThread) return;
    const thread = gmail.selectedThread;
    switch (kind as SecondaryAction['kind']) {
      case 'archive':
        void gmail.archive(item.source.threadId);
        break;
      case 'discuss':
        handleAgentAction(thread, 'ask_agent');
        break;
      case 'unsubscribe':
        handleAgentAction(thread, 'ask_agent', 'Unsubscribe me from this sender');
        break;
      case 'snooze':
        handleAgentAction(thread, 'ask_agent', 'Snooze this thread');
        break;
      case 'decline':
        handleAgentAction(thread, 'decline');
        break;
      case 'delegate':
        handleAgentAction(thread, 'delegate');
        break;
    }
  }, [gmail, handleAgentAction]);

  const handleWorkspaceAgentAction = useCallback((item: WorkItem, action: GmailAgentAction, question?: string) => {
    if (!gmail.selectedThread) return;
    handleAgentAction(gmail.selectedThread, action, question);
  }, [gmail.selectedThread, handleAgentAction]);

  const handleDirectAction = useCallback((kind: 'archive' | 'unsubscribe', threadId: string) => {
    if (kind === 'archive') {
      void gmail.archive(threadId);
    } else if (kind === 'unsubscribe') {
      if (gmail.selectedThread) {
        handleAgentAction(gmail.selectedThread, 'ask_agent', 'Unsubscribe me from this sender');
      }
    }
  }, [gmail, handleAgentAction]);

  const queuePane = useResizablePane({
    storageKey: 'flowspace.gmail.queueWidth',
    defaultWidth: 300,
    minWidth: 240,
    maxWidth: 560,
  });

  const selectedCount = gmail.selectedThreadIds.length;
  const latestHistory = gmail.actionHistory[0] ?? null;
  const bulkActionButton = 'rounded-[10px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 cursor-pointer';
  const secondaryToolbarButton = 'rounded-[10px] border border-[var(--border)] bg-black/10 px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition-colors hover:border-white/10 hover:text-[var(--text)] cursor-pointer';

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-[linear-gradient(180deg,var(--surface-soft),var(--bg))]">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top context bar: search anchored left, label tabs as primary nav, utility icons right */}
        <div className="shrink-0 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
          <div className="flex items-stretch gap-0 px-4 h-14">
            {/* Search — quiet, left-anchored */}
            <form onSubmit={handleSearch} className="flex shrink-0 items-center gap-2 w-[220px] mr-4 border-r border-[var(--border)] pr-4">
              <Search size={13} className="shrink-0 text-[var(--text-faint)] opacity-50" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search mail..."
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-dim)] placeholder:text-[var(--text-faint)] placeholder:opacity-50 outline-none"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </form>

            {/* Label tab strip — dominant, stretches to fill */}
            <div className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
              <LabelFilter
                labels={gmail.labels}
                activeLabel={gmail.activeLabel}
                onSelect={gmail.setLabel}
              />
            </div>

            {/* Utility icon row — receded, right-anchored */}
            <div className="flex items-center gap-1 shrink-0 pl-3 border-l border-[var(--border)] ml-3">
              {/* Refresh */}
              <button
                type="button"
                onClick={() => void gmail.refresh()}
                title="Refresh"
                className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                <RefreshCw size={13} />
              </button>

              {/* Raw inbox toggle */}
              <button
                type="button"
                onClick={handleToggleRawInbox}
                aria-pressed={showRawInbox}
                title={showRawInbox ? 'Smart view' : 'Raw inbox'}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  showRawInbox
                    ? 'text-[var(--accent)] bg-[var(--accent-dim)]/30'
                    : 'text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-white/[0.04]'
                }`}
              >
                <List size={13} />
              </button>

              {/* Saved */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSavedOpen((prev) => !prev)}
                  aria-expanded={savedOpen}
                  aria-haspopup="true"
                  title="Saved emails"
                  className={`relative p-1.5 rounded-md transition-colors cursor-pointer ${
                    savedOpen
                      ? 'text-[var(--accent)] bg-[var(--accent-dim)]/30'
                      : 'text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-white/[0.04]'
                  }`}
                >
                  <Bookmark size={13} />
                  {(savedEmails?.length ?? 0) > 0 && (
                    <span className="absolute top-0.5 right-0.5 w-[5px] h-[5px] rounded-full bg-[var(--accent)]" />
                  )}
                </button>

                {/* Saved popover */}
                {savedOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-[380px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-xl">
                    <div className="max-h-[480px] overflow-y-auto">
                      <SavedThreadList
                        savedEmails={savedEmails ?? []}
                        selectedThreadId={gmail.selectedThread?.id}
                        onSelectThread={(id) => {
                          void gmail.selectThread(id);
                          setSavedOpen(false);
                        }}
                        onUnsave={(id) => onUnsaveEmail?.(id)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bulk action bar — appears below the main bar when selection is active */}
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-t border-[var(--border)] bg-[var(--surface-strong)]/60">
              <span className="text-[11px] font-mono text-[var(--text-faint)] opacity-60 shrink-0">
                {selectedCount} selected
              </span>
              <div className="flex items-center gap-1.5 flex-1">
                <button type="button" onClick={gmail.selectAllVisibleThreads} className={secondaryToolbarButton}>Select all</button>
                <button type="button" onClick={gmail.clearSelection} className={secondaryToolbarButton}>Clear</button>
                <div className="w-px h-3 bg-[var(--border)] mx-0.5" />
                <button type="button" onClick={() => void gmail.performBulkAction('archive_threads')} className={`${bulkActionButton} border-[var(--accent)]/30 bg-[var(--accent-dim)]/20 text-[var(--accent)]`}>Archive</button>
                <button type="button" onClick={() => void gmail.performBulkAction('trash_threads')} aria-label="Trash selected" className={`${bulkActionButton} border-[var(--error)]/30 bg-[var(--error-dim)]/20 text-[var(--error)]`}>Trash</button>
                <button type="button" onClick={() => void gmail.performBulkAction('mark_read')} className={`${bulkActionButton} border-[var(--border)] bg-black/10 text-[var(--text-dim)]`}>Mark read</button>
                <button type="button" onClick={() => void gmail.performBulkAction('mute_threads')} className={`${bulkActionButton} border-[var(--border)] bg-black/10 text-[var(--text-dim)]`}>Mute</button>
              </div>
            </div>
          )}
        </div>

        {/* Recent action bar */}
        {gmail.recentAction && (
          <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-[var(--text)]">
                {gmail.recentAction.message ?? `Completed ${gmail.recentAction.succeeded_count} inbox action(s).`}
              </span>
              {gmail.recentAction.undo_available && gmail.recentAction.audit_id && (
                <button
                  type="button"
                  onClick={() => void gmail.undoRecentAction()}
                  className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent-dim)]/20 px-3 py-1 text-[11px] font-medium text-[var(--accent)] cursor-pointer"
                >
                  Undo
                </button>
              )}
              {latestHistory && (
                <button
                  type="button"
                  onClick={() => setShowActionDetails((value) => !value)}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text-dim)] cursor-pointer"
                >
                  {showActionDetails ? 'Hide details' : 'View details'}
                </button>
              )}
            </div>
            {showActionDetails && latestHistory && (
              <div className="mt-2 space-y-1 text-[11px] text-[var(--text-dim)]">
                {latestHistory.result_items.slice(0, 6).map((item: { thread_id: string; sender: string; subject: string; status: string; error?: string }) => (
                  <div key={item.thread_id}>
                    {item.sender} - {item.subject} ({item.status})
                    {item.error ? `: ${item.error}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content area */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--surface-soft)]">
          {showRawInbox ? (
            /* Raw inbox fallback mode — flat thread list takes full width, no workspace */
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <EnrichmentProgressBanner
                visible={gmail.enrichmentStatus === 'loading' && !gmail.fallbackReason}
                progress={gmail.enrichmentProgress}
              />
              <SmartViewUnavailableBanner fallbackReason={gmail.fallbackReason} />
              <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
                <BucketedThreadList
                  threads={gmail.threads}
                  enrichmentMap={gmail.enrichmentMap}
                  enrichmentQueue={gmail.enrichmentQueue}
                  fallbackReason={gmail.fallbackReason}
                  selectedId={gmail.selectedThread?.id ?? null}
                  selectedThreadIds={gmail.selectedThreadIds}
                  loading={gmail.loading}
                  hasMore={gmail.hasMore}
                  showRawInbox={true}
                  onSelect={(id) => gmail.selectThread(id)}
                  onLoadMore={() => gmail.loadMore()}
                  onToggleSelect={gmail.toggleThreadSelection}
                />
              </div>
            </div>
          ) : (
            /* Workspace mode — queue on the left, workspace canvas in the center */
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {/* Left: queue (user-resizable via divider handle) */}
              <div
                className="flex min-w-0 flex-col border-r border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] shrink-0 overflow-hidden"
                style={{ width: `${queuePane.width}px` }}
              >
                <EnrichmentProgressBanner
                  visible={gmail.enrichmentStatus === 'loading' && !gmail.fallbackReason}
                  progress={gmail.enrichmentProgress}
                />
                <SmartViewUnavailableBanner fallbackReason={gmail.fallbackReason} />
                <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
                  <BucketedThreadList
                    threads={gmail.threads}
                    enrichmentMap={gmail.enrichmentMap}
                    enrichmentQueue={gmail.enrichmentQueue}
                    fallbackReason={gmail.fallbackReason}
                    selectedId={gmail.selectedThread?.id ?? null}
                    selectedThreadIds={gmail.selectedThreadIds}
                    loading={gmail.loading}
                    hasMore={gmail.hasMore}
                    showRawInbox={false}
                    onSelect={(id) => gmail.selectThread(id)}
                    onLoadMore={() => gmail.loadMore()}
                    onToggleSelect={gmail.toggleThreadSelection}
                  />
                </div>
              </div>

              {/* Divider: drag to resize the queue, double-click to reset */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize queue pane"
                aria-valuenow={queuePane.width}
                aria-valuemin={240}
                aria-valuemax={560}
                tabIndex={0}
                onMouseDown={queuePane.onMouseDown}
                onKeyDown={queuePane.onKeyDown}
                onDoubleClick={queuePane.onDoubleClick}
                className={`group relative flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-[var(--accent)]/10 focus-visible:bg-[var(--accent)]/20 focus-visible:outline-none ${
                  queuePane.isDragging ? 'bg-[var(--accent)]/20' : ''
                }`}
              >
                <span
                  className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
                    queuePane.isDragging
                      ? 'bg-[var(--accent)]'
                      : 'bg-[var(--border)] group-hover:bg-[var(--accent)]/60'
                  }`}
                  aria-hidden="true"
                />
              </div>

              {/* Center: workspace canvas */}
              <div className="min-w-0 flex-1 overflow-hidden bg-[linear-gradient(180deg,rgba(0,0,0,0.04),transparent)]">
                <GmailWorkspace
                  item={workItem}
                  threadDetail={gmail.selectedThread}
                  onArchive={gmail.archive}
                  onPrimaryAction={handlePrimaryAction}
                  onSecondaryAction={handleSecondaryAction}
                  onAgentAction={handleWorkspaceAgentAction}
                  onDirectAction={handleDirectAction}
                  onNext={gmail.selectNextInQueue}
                  onUndo={() => { void gmail.undoRecentAction(); }}
                  isLoading={gmail.loading}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error toast */}
      {gmail.error && (
        <div className="fixed bottom-4 right-4 bg-[var(--error)] text-white text-[12px] px-4 py-2 rounded-lg shadow-lg z-50">
          {gmail.error}
        </div>
      )}
    </div>
  );
}
