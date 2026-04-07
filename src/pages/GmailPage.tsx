import { useState, useCallback, useMemo, useEffect } from 'react';
import { Inbox, Search, Sparkles, X, PanelLeftClose, MailOpen, ShieldCheck, RefreshCw, Bookmark } from 'lucide-react';
import { useGmailPage } from '../hooks/useGmailPage';
import { useChatContext } from '../context/ChatContext';
import { buildGmailAgentPrompt, gmailAgentDisplayText, type GmailAgentAction } from '../lib/gmail-agent';
import { triageThreads } from '../lib/triage';
import LabelFilter from '../components/gmail/LabelFilter';
import ThreadList from '../components/gmail/ThreadList';
import ThreadReader from '../components/gmail/ThreadReader';
import GmailTriageView, { type CustomCategory } from '../components/gmail/GmailTriageView';
import TriageAgentBar from '../components/gmail/TriageAgentBar';
import SavedThreadList from '../components/gmail/SavedThreadList';
import { api as apiService, type GmailThreadDetail, type SavedEmail } from '../services/api';

type GmailView = 'inbox' | 'triage' | 'saved';

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
  const [activeTab, setActiveTab] = useState<GmailView>(
    initialTab === 'triage' ? 'triage' : initialTab === 'saved' ? 'saved' : 'inbox'
  );
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [aiSortLoading, setAiSortLoading] = useState(false);

  // Switch tab when navigated from agent, then clear the hint
  useEffect(() => {
    if (initialTab === 'triage') {
      setActiveTab('triage');
      clearNavigateTab();
    } else if (initialTab === 'saved') {
      setActiveTab('saved');
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
    if (initialTab !== 'saved') setActiveTab('inbox');
    void selectThread(initialThreadId).finally(() => {
      onInitialThreadHandled?.();
    });
  }, [selectThread, initialThreadId, initialThreadNonce, onInitialThreadHandled, initialTab]);

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

  const handleTriageAgentAction = useCallback((prompt: string, displayContent: string) => {
    const preserveActiveView = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
    void sendMessage(prompt, { forceNewChat: true, preserveActiveView, displayContent });
  }, [sendMessage]);

  const handleAISort = useCallback(async () => {
    setAiSortLoading(true);
    try {
      const result = await apiService.aiTriage([...gmail.threads]);
      const newCategories: CustomCategory[] = result.categories.map((cat, i) => ({
        id: `ai-${Date.now()}-${i}`,
        label: cat.label,
        threadIds: cat.threadIds,
      }));
      setCustomCategories(newCategories);
    } catch (err: unknown) {
      console.error('AI triage failed:', err instanceof Error ? err.message : err);
    } finally {
      setAiSortLoading(false);
    }
  }, [gmail.threads]);

  const handleAddCategory = useCallback((label: string) => {
    setCustomCategories((prev) => [...prev, { id: `custom-${Date.now()}`, label, threadIds: [] }]);
  }, []);

  const handleMoveThread = useCallback((threadId: string, categoryId: string) => {
    setCustomCategories((prev) =>
      prev.map((cat) => {
        // Remove from any custom category it's currently in
        const filtered = cat.threadIds.filter((id) => id !== threadId);
        // Add to the target category
        if (cat.id === categoryId) {
          return { ...cat, threadIds: [...filtered, threadId] };
        }
        return { ...cat, threadIds: filtered };
      }),
    );
  }, []);

  const handleTriageAskAgent = useCallback((threadId: string) => {
    const thread = gmail.threads.find((t) => t.id === threadId);
    if (!thread) return;
    const prompt = `I'm looking at email thread "${thread.subject}" from ${thread.from}. Snippet: "${thread.snippet}". Help me decide what to do with this email — should I reply, archive, schedule a follow-up, or take another action?`;
    const preserveActiveView = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
    void sendMessage(prompt, { forceNewChat: true, preserveActiveView, displayContent: `Help me with "${thread.subject}"` });
  }, [gmail.threads, sendMessage]);

  // Categorize loaded threads for triage view
  const triage = useMemo(() => triageThreads(gmail.threads), [gmail.threads]);

  const selectedCount = gmail.selectedThreadIds.length;
  const latestHistory = gmail.actionHistory[0] ?? null;
  const unreadCount = gmail.threads.filter((thread) => thread.unread).length;
  const bulkActionButton = 'rounded-[10px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 cursor-pointer';
  const secondaryToolbarButton = 'rounded-[10px] border border-[var(--border)] bg-black/10 px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition-colors hover:border-white/10 hover:text-[var(--text)] cursor-pointer';

  return (
    <div className="flex h-full bg-[linear-gradient(180deg,var(--surface-soft),var(--bg))]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]">
          <div className="border-b border-[var(--border)] px-4 py-2">
            <div className="mx-auto flex max-w-[1720px] items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('inbox')}
                className={`flex items-center gap-1.5 rounded-[12px] border px-4 py-2 text-[14px] font-semibold transition ${
                  activeTab === 'inbox'
                    ? 'border-white/12 bg-white/[0.08] text-white'
                    : 'border-transparent text-[var(--text-dim)] hover:border-white/8 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <Inbox size={14} />
                Inbox
                {unreadCount > 0 && (
                  <span className="min-w-[18px] rounded-full bg-white/10 px-1.5 py-px text-center font-mono text-[10px] text-[var(--text-dim)]">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('triage')}
                className={`flex items-center gap-1.5 rounded-[12px] border px-4 py-2 text-[14px] font-semibold transition ${
                  activeTab === 'triage'
                    ? 'border-[var(--accent)]/25 bg-[var(--accent)]/12 text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-dim)] hover:border-white/8 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <Sparkles size={14} />
                AI Triage
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('saved')}
                className={`flex items-center gap-1.5 rounded-[12px] border px-4 py-2 text-[14px] font-semibold transition ${
                  activeTab === 'saved'
                    ? 'border-[var(--purple)]/25 bg-[var(--purple)]/12 text-[var(--purple)]'
                    : 'border-transparent text-[var(--text-dim)] hover:border-white/8 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <Bookmark size={14} />
                Saved
                {(savedEmails?.length ?? 0) > 0 && (
                  <span className="min-w-[18px] rounded-full bg-white/10 px-1.5 py-px text-center font-mono text-[10px] text-[var(--text-dim)]">
                    {savedEmails!.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="px-4 py-2">
            <div className="mx-auto flex max-w-[1720px] flex-col gap-2">
              {activeTab === 'saved' ? null : activeTab === 'inbox' ? (
                <>
                  <div className="flex items-center gap-2">
                    <form onSubmit={handleSearch} className="flex w-[260px] shrink-0 items-center gap-2 rounded-[12px] border border-white/8 bg-black/15 px-3 py-1.5">
                      <Search size={14} className="shrink-0 text-[var(--text-faint)]" />
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search emails..."
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none"
                      />
                      {searchInput && (
                        <button
                          type="button"
                          onClick={handleClearSearch}
                          className="text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer"
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </form>
                    <div className="min-w-0 flex-1 overflow-x-auto">
                      <LabelFilter
                        labels={gmail.labels}
                        activeLabel={gmail.activeLabel}
                        onSelect={gmail.setLabel}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void gmail.refresh()}
                      className={`${secondaryToolbarButton} ml-auto shrink-0`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <RefreshCw size={12} />
                        Refresh
                      </span>
                    </button>
                  </div>
                  {selectedCount > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="rounded-[10px] border border-white/8 bg-black/15 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)]">
                        {selectedCount} selected
                      </span>
                      <button
                        type="button"
                        onClick={gmail.selectAllVisibleThreads}
                        className={secondaryToolbarButton}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={gmail.clearSelection}
                        className={secondaryToolbarButton}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => void gmail.performBulkAction('archive_threads')}
                        className={`${bulkActionButton} border-[var(--accent)]/30 bg-[var(--accent-dim)]/20 text-[var(--accent)]`}
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        onClick={() => void gmail.performBulkAction('trash_threads')}
                        aria-label="Trash selected"
                        className={`${bulkActionButton} border-[var(--error)]/30 bg-[var(--error-dim)]/20 text-[var(--error)]`}
                      >
                        Trash
                      </button>
                      <button
                        type="button"
                        onClick={() => void gmail.performBulkAction('mark_read')}
                        className={`${bulkActionButton} border-[var(--border)] bg-black/10 text-[var(--text-dim)]`}
                      >
                        Mark read
                      </button>
                      <button
                        type="button"
                        onClick={() => void gmail.performBulkAction('mute_threads')}
                        className={`${bulkActionButton} border-[var(--border)] bg-black/10 text-[var(--text-dim)]`}
                      >
                        Mute
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-[var(--text-dim)]">
                    <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
                    <span className="truncate">AI triage groups the current inbox into action buckets while keeping the reader pane stable.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void gmail.refresh()}
                    className={`${secondaryToolbarButton} shrink-0`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <RefreshCw size={12} />
                      Refresh
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
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
                {latestHistory.result_items.slice(0, 6).map((item) => (
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
        <div className="flex min-h-0 flex-1 bg-[var(--surface-soft)]">
          {activeTab === 'saved' ? (
            /* Saved emails view */
            <div className={`flex flex-col border-r border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] transition-[width] duration-200 ${
              gmail.selectedThread ? 'hidden md:flex md:w-[420px] md:shrink-0 xl:w-[448px]' : 'flex-1 md:w-[420px] md:shrink-0 xl:w-[448px]'
            }`}>
              <div className="flex-1 overflow-y-auto">
                <SavedThreadList
                  savedEmails={savedEmails ?? []}
                  selectedThreadId={gmail.selectedThread?.id}
                  onSelectThread={(id) => void gmail.selectThread(id)}
                  onUnsave={(id) => onUnsaveEmail?.(id)}
                />
              </div>
            </div>
          ) : activeTab === 'triage' ? (
            /* AI Triage view — left panel shows categorized threads */
            <div className={`flex flex-col border-r border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] transition-[width] duration-200 ${
              gmail.selectedThread ? 'hidden md:flex md:w-[420px] md:shrink-0 xl:w-[448px]' : 'flex-1 md:w-[420px] md:shrink-0 xl:w-[448px]'
            }`}>
              <TriageAgentBar
                triage={triage}
                threads={gmail.threads}
                onSendToAgent={handleTriageAgentAction}
                onAISort={handleAISort}
                aiSortLoading={aiSortLoading}
              />
              <div className="flex-1 overflow-y-auto">
                <GmailTriageView
                  triage={triage}
                  onSelectThread={(id) => gmail.selectThread(id)}
                  selectedThreadId={gmail.selectedThread?.id}
                  customCategories={customCategories}
                  onAddCategory={handleAddCategory}
                  onMoveThread={handleMoveThread}
                  onArchiveThread={(id) => gmail.archive(id)}
                  onAskAgent={handleTriageAskAgent}
                />
              </div>
            </div>
          ) : (
            /* Standard inbox view — left panel */
            <div className={`flex flex-col border-r border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] transition-[width] duration-200 ${
              gmail.selectedThread ? 'hidden md:flex md:w-[420px] md:shrink-0 xl:w-[448px]' : 'flex-1 md:w-[420px] md:shrink-0 xl:w-[448px]'
            }`}>
              {/* Thread list */}
              <div className="flex-1 overflow-y-auto">
                <ThreadList
                  threads={gmail.threads}
                  selectedId={gmail.selectedThread?.id ?? null}
                  selectedThreadIds={gmail.selectedThreadIds}
                  loading={gmail.loading}
                  hasMore={gmail.hasMore}
                  onSelect={(id) => gmail.selectThread(id)}
                  onLoadMore={() => gmail.loadMore()}
                  onToggleSelect={gmail.toggleThreadSelection}
                />
              </div>
            </div>
          )}

          {/* Right panel: thread reader */}
          {gmail.selectedThread ? (
            <div className="flex-1 flex flex-col min-w-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04),transparent)]">
              <ThreadReader
                thread={gmail.selectedThread}
                onBack={gmail.deselectThread}
                onArchive={gmail.archive}
                onTrash={gmail.trash}
                onAgentAction={handleAgentAction}
              />
            </div>
          ) : activeTab === 'inbox' ? (
            <div className="hidden min-w-0 flex-1 items-center justify-center border-l border-white/4 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.005))] md:flex">
              <div className="w-full max-w-[360px] rounded-[24px] border border-white/8 bg-black/10 p-7 text-left">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/8 bg-white/[0.03] text-[var(--text-dim)]">
                  <MailOpen size={18} />
                </div>
                <h3 className="text-[22px] font-semibold tracking-[-0.04em] text-[var(--text)]">Reader ready</h3>
                <p className="mt-3 text-[13px] leading-6 text-[var(--text-dim)]">
                  Select a conversation from the left to open the full thread, draft a reply, or delegate the next action.
                </p>
                <div className="mt-6 space-y-2">
                  <div className="flex items-center gap-2 rounded-[14px] border border-white/6 bg-white/[0.025] px-3 py-2 text-[12px] text-[var(--text-dim)]">
                    <PanelLeftClose size={13} className="text-[var(--text-faint)]" />
                    Keep the inbox list open while you review mail.
                  </div>
                  <div className="flex items-center gap-2 rounded-[14px] border border-white/6 bg-white/[0.025] px-3 py-2 text-[12px] text-[var(--text-dim)]">
                    <ShieldCheck size={13} className="text-[var(--accent)]" />
                    Use AI actions without leaving the thread.
                  </div>
                </div>
              </div>
            </div>
          ) : null}
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
