/**
 * GmailWorkspace — center canvas component for the Gmail workspace rework.
 *
 * Renders either an empty state (item === null) or the full workspace:
 *   WorkspaceHeader → WorkspaceTabs → tab body → done footer (when action completes)
 *
 * Commit 3: Agent Work tab body dispatched through PaneRouter.
 * Commit 6: Done-state footer with Undo + "Next item →" affordance.
 * Commit 7: Telemetry (gmail_workspace_open) + stable-item debounce guard.
 */
import { useState, useEffect, useCallback } from 'react';
import { Inbox, Check } from 'lucide-react';
import type { WorkItem } from '../../../lib/work-item.js';
import { api, type GmailThreadDetail } from '../../../services/api.js';
import type { SecondaryAction } from '../../../lib/gmail-work-registry.js';
import type { GmailAgentAction } from '../../../lib/gmail-agent.js';
import { useThreadBrief } from '../../../hooks/useThreadBrief.js';
import { useChatContext } from '../../../context/ChatContext.js';
import WorkspaceHeader from './WorkspaceHeader.js';
import WorkspaceTabs, { type WorkspaceTabId } from './WorkspaceTabs.js';
import EmailTab from './tabs/EmailTab.js';
import ThreadTab from './tabs/ThreadTab.js';
import ContextTab from './tabs/ContextTab.js';
import ChatTab from './tabs/ChatTab.js';
import PaneRouter from './panes/PaneRouter.js';

interface CompletionState {
  summary: string;
  threadId: string;
  canUndo: boolean;
}

interface Props {
  item: WorkItem | null;
  threadDetail: GmailThreadDetail | null;
  onArchive: (threadId: string) => void;
  onPrimaryAction: (item: WorkItem) => void;
  onSecondaryAction: (item: WorkItem, kind: string) => void;
  /** Dispatches an agent action in the context of the current item. */
  onAgentAction: (item: WorkItem, action: GmailAgentAction, question?: string) => void;
  /** Direct (non-chat) action handler for archive/unsubscribe. */
  onDirectAction?: (kind: 'archive' | 'unsubscribe', threadId: string) => void;
  /** Advance to next queue item. */
  onNext?: () => void;
  /** Undo the most recent action. */
  onUndo?: () => void;
  /** Whether the queue data is still loading (shows workspace skeleton). */
  isLoading?: boolean;
}

// ── Empty / loading state ────────────────────────────────────────────────────

function EmptyState({ isLoading }: { isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Fake header skeleton */}
        <div className="border-b border-[var(--border)] px-6 py-4 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2.5 flex-1">
              {/* Thread type badge */}
              <div className="h-4 w-20 rounded-full bg-white/[0.06] animate-pulse" style={{ animationDelay: '0ms' }} />
              {/* Subject line */}
              <div className="h-5 w-3/4 rounded bg-white/[0.09] animate-pulse" style={{ animationDelay: '40ms' }} />
              {/* Sender */}
              <div className="h-3.5 w-48 rounded bg-white/[0.05] animate-pulse" style={{ animationDelay: '80ms' }} />
            </div>
            {/* Action buttons */}
            <div className="flex gap-2 shrink-0">
              <div className="h-7 w-20 rounded-[10px] bg-white/[0.05] animate-pulse" style={{ animationDelay: '120ms' }} />
              <div className="h-7 w-16 rounded-[10px] bg-white/[0.05] animate-pulse" style={{ animationDelay: '150ms' }} />
            </div>
          </div>
        </div>

        {/* Fake tabs */}
        <div className="border-b border-[var(--border)] px-6 flex items-center gap-1 py-1">
          {['Email', 'Thread', 'Context', 'Agent Work', 'Chat'].map((tab, i) => (
            <div
              key={tab}
              className={`h-6 rounded-md animate-pulse ${i === 0 ? 'w-14 bg-white/[0.08]' : 'w-12 bg-white/[0.04]'}`}
              style={{ animationDelay: `${i * 30 + 160}ms` }}
            />
          ))}
        </div>

        {/* Fake email body */}
        <div className="flex-1 px-6 py-5 flex flex-col gap-4 overflow-hidden relative">
          {/* Email header block */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-white/[0.07] animate-pulse shrink-0" style={{ animationDelay: '200ms' }} />
            <div className="flex flex-col gap-1.5 flex-1">
              <div className="h-3 w-28 rounded bg-white/[0.07] animate-pulse" style={{ animationDelay: '220ms' }} />
              <div className="h-2.5 w-48 rounded bg-white/[0.04] animate-pulse" style={{ animationDelay: '240ms' }} />
            </div>
          </div>
          {/* Body lines */}
          {[1, 0.85, 0.9, 0.6, 1, 0.75].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded bg-white/[0.05] animate-pulse"
              style={{ width: `${w * 100}%`, animationDelay: `${260 + i * 40}ms` }}
            />
          ))}
          {/* Paragraph break */}
          <div className="h-3" />
          {[0.9, 0.8, 0.95, 0.55].map((w, i) => (
            <div
              key={`p2-${i}`}
              className="h-3 rounded bg-white/[0.04] animate-pulse"
              style={{ width: `${w * 100}%`, animationDelay: `${500 + i * 40}ms` }}
            />
          ))}

          {/* Subtle gradient fade at bottom */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[var(--bg-elevated)] to-transparent" />
        </div>
      </div>
    );
  }

  // Idle empty state — no thread selected
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-5 py-20 px-8 relative overflow-hidden">
      {/* Subtle radial glow behind icon */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 rounded-full bg-[var(--accent)]/[0.04] blur-3xl" />
      </div>

      {/* Icon container with ring */}
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl bg-[var(--surface2)] border border-white/[0.07] flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
          <Inbox size={22} className="text-[var(--text-faint)]" />
        </div>
        {/* Subtle ping ring */}
        <div className="absolute inset-0 rounded-2xl border border-white/[0.04] animate-ping" style={{ animationDuration: '3s' }} />
      </div>

      <div className="text-center relative">
        <p className="text-[14px] font-medium text-[var(--text-dim)]">
          Pick an item from the queue to start working
        </p>
        <p className="text-[12px] text-[var(--text-faint)] mt-1.5 leading-relaxed max-w-[220px] mx-auto">
          Select a thread on the left to open the workspace.
        </p>
      </div>

      {/* Decorative dots */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1 h-1 rounded-full bg-white/[0.08]"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function GmailWorkspace({
  item,
  threadDetail,
  onArchive: _onArchive,
  onPrimaryAction,
  onSecondaryAction,
  onAgentAction,
  onDirectAction,
  onNext,
  onUndo,
  isLoading,
}: Props) {
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('email');
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const { closeChat } = useChatContext();

  // Force-close the side chat panel when the Gmail workspace is mounted.
  // Chat happens inside this canvas (Chat tab), not in the side drawer.
  useEffect(() => { closeChat(); }, [closeChat]);

  // Stable-item debounce: wait 100ms after an item change before rendering the new
  // pane body. Rapid successive clicks reset the timer so only the final item renders.
  // The header updates immediately for responsiveness; only the pane body is debounced.
  const [stableItem, setStableItem] = useState(item);
  useEffect(() => {
    const t = setTimeout(() => setStableItem(item), 100);
    return () => clearTimeout(t);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Telemetry: fire gmail_workspace_open once per item open (best-effort).
  useEffect(() => {
    if (!item) return;
    const mountTime = typeof performance !== 'undefined' ? performance.now() : 0;
    const durationMs = typeof performance !== 'undefined' ? performance.now() - mountTime : 0;
    void api.reportGmailWorkspaceOpen({
      threadType: item.type,
      paneKind: item.paneKind,
      durationMs,
      threadId: item.source.threadId,
    }).catch(() => { /* best-effort */ });
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch thread brief for the selected item
  const threadId = item?.source.threadId ?? null;
  const { brief, loading: briefLoading } = useThreadBrief(threadId);

  // Reset completion state and tab when item changes
  useEffect(() => {
    setCompletion(null);
    setActiveTab('email');
  }, [item?.id]);

  const handleComplete = useCallback((summary: string) => {
    if (!item) return;
    setCompletion({
      summary,
      threadId: item.source.threadId,
      // Archive/trash support undo via recentAction state in the hook.
      // Reply-sent and create-task don't.
      canUndo: summary.startsWith('Archived') || summary.startsWith('Trashed'),
    });
  }, [item]);

  if (!item) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-elevated)]">
        <EmptyState isLoading={isLoading} />
      </div>
    );
  }

  const messageCount = threadDetail?.messages.length ?? 0;
  // Rough heuristic: enrichment present = 1 context item
  const contextItemCount = item.enrichment ? 1 : 0;

  const handlePrimaryAction = () => onPrimaryAction(item);
  const handleSecondaryAction = (kind: SecondaryAction['kind']) => onSecondaryAction(item, kind);

  // Bridge: pane-level (action, question?) → parent-level (item, action, question?)
  const handleAgentAction = (action: GmailAgentAction, question?: string) => {
    onAgentAction(item, action, question);
  };

  // Use stableItem for the pane body to prevent flash during rapid item switches.
  // stableItem lags item by ~100ms so rapid clicks don't mount-unmount intermediate panes.
  function renderTabBody() {
    if (!stableItem) return null;
    switch (activeTab) {
      case 'email':
        return <EmailTab threadDetail={threadDetail} />;
      case 'thread':
        return <ThreadTab threadDetail={threadDetail} />;
      case 'context':
        return <ContextTab item={stableItem} threadDetail={threadDetail} />;
      case 'chat':
        return <ChatTab item={stableItem} />;
      case 'agent_work':
      default:
        return (
          <PaneRouter
            item={stableItem}
            threadDetail={threadDetail}
            brief={brief}
            briefLoading={briefLoading}
            onAgentAction={handleAgentAction}
            onDirectAction={onDirectAction}
            onComplete={handleComplete}
            onSwitchTab={setActiveTab}
          />
        );
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--bg-elevated)]">
      <WorkspaceHeader
        item={item}
        onPrimaryAction={handlePrimaryAction}
        onSecondaryAction={handleSecondaryAction}
      />
      <WorkspaceTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        messageCount={messageCount}
        contextItemCount={contextItemCount}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {renderTabBody()}
      </div>

      {/* Done-state footer — shown after a pane completes its primary action */}
      {completion && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            <Check size={14} className="text-[var(--accent)]" />
            <span>{completion.summary}</span>
          </div>
          <div className="flex items-center gap-2">
            {completion.canUndo && onUndo && (
              <button
                type="button"
                onClick={() => { onUndo(); setCompletion(null); }}
                className="rounded-[10px] border border-[var(--border)] bg-transparent px-3 py-1.5 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface2)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 focus-visible:outline-none"
              >
                Undo
              </button>
            )}
            {onNext && (
              <button
                type="button"
                onClick={() => { onNext(); setCompletion(null); }}
                className="rounded-[10px] bg-[var(--accent)] text-black px-3 py-1.5 text-[11px] font-medium hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 focus-visible:outline-none"
              >
                Next item →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
