/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatProvider, useChatContext, type ActiveView } from './context/ChatContext';
import { useDashboardData } from './hooks/useWorkspaceData';
import { useBriefing } from './hooks/useBriefing';
import {
  api,
  type DraftReplyResponse,
  type DayEvent,
  type EmailAction,
  type InboxTriageItem,
  type ImportancePreferencesResponse,
  type SavedEmail,
} from './services/api';
import type { InboxActionType } from './shared/chat';
import { triageEmailsHeuristic } from './lib/triage';
import { createId } from './lib/chat-utils';
import { AGENT_NAME } from './lib/branding';
import {
  getImportanceFeedbackKey,
  type ImportanceFeedbackTarget,
  type PreferenceExample,
  type PreferenceLabel,
} from './lib/importance-feedback';
import { startOAuthFlow } from './lib/oauth-flow';
import { clearAllClientData } from './lib/clear-client-data';
import SignInScreen from './components/SignInScreen';
import AppRail from './components/AppRail';
import CommandInput from './components/CommandInput';
import ChatThread from './components/ChatThread';
import DraftReplyModal from './components/DraftReplyModal';
import SettingsPage from './components/SettingsPage';
import SettingsRail, { type SettingsSection } from './components/SettingsRail';
import GmailPage from './pages/GmailPage';
import TasksPage from './pages/TasksPage';
import CalendarPage from './pages/CalendarPage';
import SkillsPage from './pages/SkillsPage';
import { RefreshCw, AlertCircle, Mail, Calendar, HardDrive, CheckSquare, Check, X, SlidersHorizontal, ChevronLeft, PanelRightOpen, PanelRightClose, Sparkles, Loader2, MoreHorizontal } from 'lucide-react';
import FlowSpaceLogo from './components/FlowSpaceLogo';
import RunCenter from './components/RunCenter';
import { MemorySidebar } from './components/MemorySidebar';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import ConnectGooglePage from './pages/ConnectGooglePage';
import { useWorkspaceIdentity } from './lib/workspaceIdentity';
import AccountMenu from './components/AccountMenu';
import ProviderSwitcher from './components/ProviderSwitcher';
import ErrorBoundary from './components/ErrorBoundary';
import HomeDashboard from './components/HomeDashboard';

const CHAT_WIDTH_KEY = 'flowspace.chat.width';
const DEFAULT_CHAT_WIDTH = 420;
const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 700;

/** Chat view with an artifacts sidebar that auto-shows when data blocks are present. */
function ChatViewWithArtifacts() {
  const { messages } = useChatContext();

  // Auto-show sidebar when there are non-status blocks.
  const hasArtifacts = messages.some(
    (msg) => msg.role === 'assistant' && msg.blocks?.some((b) => b.type !== 'status'),
  );
  const showSidebar = hasArtifacts;

  return (
    <div className="h-full flex bg-[var(--bg)]">
      {/* Chat area — grows to fill, sidebar shrinks it */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="flex-1 flex flex-col min-h-0 max-w-[1120px] mx-auto w-full px-3 md:px-6">
          <ChatThread title={AGENT_NAME} showCloseButton={false} hideHeader />
          <div className="pb-4">
            <CommandInput variant="reply" />
          </div>
        </div>
      </div>

      {/* Memory sidebar */}
      <MemorySidebar />
    </div>
  );
}

function WorkspaceHub({
  stats,
  onOpen,
}: {
  stats: { unreadEmails: number; upcomingEvents: number; openTasks: number } | null;
  onOpen: (view: 'gmail' | 'calendar' | 'drive' | 'tasks') => void;
}) {
  const cards = [
    { key: 'gmail' as const, title: 'Gmail', subtitle: `${stats?.unreadEmails ?? 0} unread`, icon: Mail, enabled: true },
    { key: 'calendar' as const, title: 'Calendar', subtitle: `${stats?.upcomingEvents ?? 0} upcoming`, icon: Calendar, enabled: true },
    { key: 'drive' as const, title: 'Drive', subtitle: 'Browse files and docs', icon: HardDrive, enabled: false },
    { key: 'tasks' as const, title: 'Tasks', subtitle: `${stats?.openTasks ?? 0} open`, icon: CheckSquare, enabled: true },
  ];

  return (
    <div className="px-6 pt-10 pb-12 max-w-[900px] mx-auto">
      <div className="mb-7">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">Workspace</h2>
        <p className="mt-1 text-[13px] text-[var(--text-dim)]">Open the Google app you want, then use {AGENT_NAME} to delegate follow-up actions.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map((card) => {
          const content = (
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-[15px] font-semibold text-[var(--text)]">{card.title}</div>
                  {!card.enabled && (
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">
                      Coming soon
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[12px] text-[var(--text-faint)]">{card.subtitle}</div>
              </div>
              <div className={`h-9 w-9 rounded-[10px] border bg-[var(--surface2)] flex items-center justify-center ${card.enabled ? 'border-[var(--border2)] group-hover:border-[var(--accent)]/40' : 'border-[var(--border)] opacity-60'}`}>
                <card.icon size={15} className={card.enabled ? 'text-[var(--text-dim)] group-hover:text-[var(--text)]' : 'text-[var(--text-faint)]'} />
              </div>
            </div>
          );

          if (!card.enabled) {
            return (
              <div
                key={card.key}
                aria-disabled="true"
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left opacity-75 select-none"
              >
                {content}
              </div>
            );
          }

          return (
            <button
              key={card.key}
              onClick={() => onOpen(card.key)}
              className="group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--surface2)] transition-colors cursor-pointer"
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatRelativeTimestamp(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function conversationTabStatus(conversationId: string, runs: { conversationId?: string; status: string; startedAt: number }[], pendingApprovals: { conversationId: string }[]) {
  if (pendingApprovals.some((item) => item.conversationId === conversationId)) {
    return { label: 'Needs approval', tone: 'approval' as const };
  }

  const latestRun = runs
    .filter((run) => run.conversationId === conversationId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];

  if (!latestRun) return { label: 'Ready', tone: 'idle' as const };
  if (latestRun.status === 'running' || latestRun.status === 'queued') return { label: 'Running', tone: 'running' as const };
  if (latestRun.status === 'awaiting_approval') return { label: 'Needs approval', tone: 'approval' as const };
  if (latestRun.status === 'failed' || latestRun.status === 'canceled') return { label: 'Attention', tone: 'error' as const };
  if (latestRun.status === 'completed') return { label: 'Done', tone: 'done' as const };
  return { label: 'Ready', tone: 'idle' as const };
}

function AppInner() {
  const {
    activeView,
    setActiveView,
    messages,
    conversations,
    threadGroups,
    runs,
    pendingApprovals,
    currentConversationId,
    switchConversation,
    deleteConversation,
    renameConversation,
    createThreadGroup,
    renameThreadGroup,
    deleteThreadGroup,
    moveConversationToGroup,
    updateThreadBrief,
    newChat,
    sendMessage,
    triggerAction,
    chatPanelOpen,
    closeChat,
    toggleChatPanel,
    openConversationInPanel,
    navigateTab,
    clearNavigateTab,
  } = useChatContext();
  const data = useDashboardData();
  const briefingState = useBriefing(data.auth?.activeAccountId ?? data.auth?.user?.email);
  const {
    briefing,
    loading: briefingLoading,
    error: briefingError,
    retrying: briefingRetrying,
    newItemCount,
    acknowledge,
    refresh: refreshBriefing,
    ignoreTarget,
    restoreTarget,
    isTargetIgnored,
  } = briefingState;

  const [draftModal, setDraftModal] = useState<DraftReplyResponse | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [accountMenuBusy, setAccountMenuBusy] = useState(false);
  const [importancePreferences, setImportancePreferences] = useState<PreferenceExample[]>([]);
  const [savedEmails, setSavedEmails] = useState<SavedEmail[]>([]);
  const [importancePendingKeys, setImportancePendingKeys] = useState<Set<string>>(new Set());
  const [importanceErrors, setImportanceErrors] = useState<Record<string, string>>({});
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isThreadDetailsOpen, setIsThreadDetailsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [gmailOpenRequest, setGmailOpenRequest] = useState<{ threadId: string; nonce: number } | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [threadGroupDraft, setThreadGroupDraft] = useState('');
  const [threadBriefDraft, setThreadBriefDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Track the previous non-chat view so the back button can return to it
  const previousViewRef = useRef<ActiveView>('dashboard');
  useEffect(() => {
    if (activeView !== 'chat') {
      previousViewRef.current = activeView;
    }
  }, [activeView]);

  // Escape key to close thread details panel
  useEffect(() => {
    if (!isThreadDetailsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsThreadDetailsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isThreadDetailsOpen]);

  // ── Global keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

      // Cmd+/ — toggle chat panel
      if (meta && e.key === '/') {
        e.preventDefault();
        toggleChatPanel();
        return;
      }

      // Cmd+N — new chat
      if (meta && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        newChat();
        return;
      }

      // Cmd+1..5 — switch views (only when not in an input)
      if (meta && !isInput && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const views: ActiveView[] = ['dashboard', 'gmail', 'calendar', 'tasks', 'settings'];
        const idx = parseInt(e.key, 10) - 1;
        if (views[idx]) setActiveView(views[idx]);
        return;
      }
    };
    document.addEventListener('keydown', handleGlobalKeys);
    return () => document.removeEventListener('keydown', handleGlobalKeys);
  }, [toggleChatPanel, newChat, setActiveView]);

  // Resizable chat panel
  const [chatWidth, setChatWidth] = useState<number>(() => {
    const saved = window.localStorage.getItem(CHAT_WIDTH_KEY);
    return saved ? Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, Number(saved))) : DEFAULT_CHAT_WIDTH;
  });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_CHAT_WIDTH);

  useEffect(() => {
    window.localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const newWidth = Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, dragStartWidth.current + delta));
      setChatWidth(newWidth);
    };
    const onMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleDraftReply = useCallback(async (threadId: string) => {
    setDraftLoading(true);
    try {
      const result = await api.draftReply(threadId);
      setDraftModal(result);
    } catch (err: any) {
      console.error('Draft reply failed:', err.message);
    } finally {
      setDraftLoading(false);
    }
  }, []);

  const handleEmailAction = useCallback((action: EmailAction) => {
    switch (action.type) {
      case 'draft_reply':
        if (action.context.thread_id) handleDraftReply(action.context.thread_id);
        break;
      case 'open_form': {
        const formUrl = action.context.form_url;
        if (formUrl) {
          try {
            const parsed = new URL(formUrl);
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
              window.open(formUrl, '_blank', 'noopener,noreferrer');
            }
          } catch { /* invalid URL — ignore */ }
        }
        break;
      }
      case 'suggest_time': {
        const prompt = action.needs_input
          ? `The email "${action.context.subject || 'meeting request'}" needs scheduling. ${action.needs_input}${action.conflict ? ` Note: ${action.conflict}` : ''}`
          : `Suggest alternative times for the meeting in thread ${action.context.thread_id || ''}`;
        triggerAction(prompt, false);
        break;
      }
      case 'accept_meeting':
        triggerAction(`Accept the meeting invite in email thread ${action.context.thread_id || ''}. Add it to my calendar.`, true);
        break;
      case 'reject_meeting':
        triggerAction(`Decline the meeting invite in email thread ${action.context.thread_id || ''}.${action.conflict ? ` Reason: ${action.conflict}` : ''}`, true);
        break;
      case 'create_task':
        triggerAction(`Create a task: "${action.detail || action.label}"${action.context.deadline ? ` due ${action.context.deadline}` : ''} from email thread ${action.context.thread_id || ''}.`, true);
        break;
      case 'approve_request':
        triggerAction(`Send an approval reply to email thread ${action.context.thread_id || ''}.`, true);
        break;
      case 'add_to_calendar':
        triggerAction(`Add the event mentioned in email thread ${action.context.thread_id || ''} to my calendar.`, true);
        break;
      default: {
        // Generic fallback: open chat with context
        const prompt = action.needs_input
          ? `Regarding "${action.label}": ${action.needs_input}`
          : `Handle action "${action.label}" for email thread ${action.context.thread_id || ''}`;
        triggerAction(prompt, false);
      }
    }
  }, [handleDraftReply, triggerAction]);

  const handleInboxBulkAction = useCallback((actionType: InboxActionType, items: InboxTriageItem[]) => {
    const normalized = items
      .filter((item) => item.thread_id)
      .map((item) => ({
        thread_id: item.thread_id,
        sender: item.sender,
        subject: item.subject,
        reason: item.reason || item.summary,
      }));
    if (normalized.length === 0) return;
    const serialized = JSON.stringify(normalized);
    let prompt = '';
    switch (actionType) {
      case 'archive_threads':
        prompt = `Archive these Gmail threads by exact ID only and include the preview_items JSON in the approval request.\n${serialized}`;
        break;
      case 'mute_threads':
        prompt = `Mute these Gmail threads by exact ID only.\n${serialized}`;
        break;
      case 'mark_read':
        prompt = `Mark these Gmail threads as read by exact ID only.\n${serialized}`;
        break;
      case 'create_filter':
        prompt = `Create a Gmail filter for future emails similar to these messages, preferably using the sender when possible.\n${serialized}`;
        break;
      default:
        prompt = `Handle this inbox action using these exact Gmail thread IDs only.\n${serialized}`;
    }
    triggerAction(prompt, true);
  }, [triggerAction]);

  const handleCreateDoc = useCallback(async (eventOrId: DayEvent | string) => {
    const event = typeof eventOrId === 'string'
      ? briefing?.day_at_a_glance.find((e) => e.event_id === eventOrId)
      : eventOrId;
    if (!event) return;

    try {
      const result = await api.createDoc({
        title: event.title,
        attendees: event.attendees,
        event_id: event.event_id,
        runId: createId('run'),
      });
      window.open(result.docUrl, '_blank');
      // Force refresh briefing to bypass cache and dashboard data to show new file
      void refreshBriefing();
      data.refresh();
    } catch (err: any) {
      console.error('Create doc failed:', err.message);
    }
  }, [briefing, refreshBriefing, data]);

  const handleFollowupComplete = useCallback(async (taskId: string) => {
    try { await api.completeFollowup(taskId); refreshBriefing(); } catch (err: any) { console.error('Complete followup failed:', err.message); }
  }, [refreshBriefing]);

  const handleFollowupSnooze = useCallback(async (taskId: string, due: string) => {
    try { await api.snoozeFollowup(taskId, due); refreshBriefing(); } catch (err: any) { console.error('Snooze followup failed:', err.message); }
  }, [refreshBriefing]);

  const handleFollowupDelete = useCallback(async (taskId: string) => {
    try { await api.deleteFollowup(taskId); refreshBriefing(); } catch (err: any) { console.error('Delete followup failed:', err.message); }
  }, [refreshBriefing]);

  const handleOpenThreadInApp = useCallback((threadId: string) => {
    setGmailOpenRequest({ threadId, nonce: Date.now() });
    closeChat();
    setActiveView('gmail');
  }, [closeChat, setActiveView]);

  const loadImportancePreferences = useCallback(async () => {
    try {
      const result: ImportancePreferencesResponse = await api.getImportancePreferences();
      setImportancePreferences(result.preferences ?? []);
    } catch (err: any) {
      console.error('Failed to load importance preferences:', err?.message || err);
    }
  }, []);

  const loadSavedEmails = useCallback(async () => {
    try {
      const result = await api.getSavedEmails();
      setSavedEmails(result.savedEmails ?? []);
    } catch (err: any) {
      console.error('Failed to load saved emails:', err?.message || err);
    }
  }, []);

  useEffect(() => {
    void loadImportancePreferences();
    void loadSavedEmails();
  }, [loadImportancePreferences, loadSavedEmails]);

  const handleIgnoreItem = useCallback((target?: ImportanceFeedbackTarget) => {
    ignoreTarget(target);
  }, [ignoreTarget]);

  const handlePreferenceFeedback = useCallback(async (
    label: PreferenceLabel,
    target?: ImportanceFeedbackTarget,
  ) => {
    const key = getImportanceFeedbackKey(target);
    if (!target || !key) return;

    setImportancePendingKeys((prev) => new Set(prev).add(key));
    setImportanceErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

    try {
      const result = await api.saveImportanceFeedback({ target, label });
      setImportancePreferences((prev) => (
        prev.some((item) => item.id === result.example.id) ? prev : [result.example, ...prev]
      ));
      if (result.example.target?.entity_id) {
        const newSaved: SavedEmail = {
          id: result.example.id,
          thread_id: result.example.target.entity_id as string,
          subject: result.example.target.subject ?? '(no subject)',
          sender: result.example.target.sender_name ?? result.example.target.sender ?? 'Unknown',
          saved_at: result.example.created_at,
          label,
        };
        setSavedEmails((prev) => {
          const without = prev.filter((e) => e.id !== newSaved.id);
          return [newSaved, ...without];
        });
      }
      if (label === 'not_important') {
        ignoreTarget(target);
      } else if (isTargetIgnored(target)) {
        restoreTarget(target);
      }
    } catch (err: any) {
      console.error('Failed to save preference feedback:', err?.message || err);
      setImportanceErrors((prev) => ({
        ...prev,
        [key]: err?.message || 'Could not save preference',
      }));
      restoreTarget(target);
    } finally {
      setImportancePendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [ignoreTarget, restoreTarget, isTargetIgnored]);

  const handleNotImportant = useCallback((target?: ImportanceFeedbackTarget) => {
    void handlePreferenceFeedback('not_important', target);
  }, [handlePreferenceFeedback]);

  const handleImportant = useCallback((target?: ImportanceFeedbackTarget) => {
    void handlePreferenceFeedback('important', target);
  }, [handlePreferenceFeedback]);

  const handleUnsaveEmail = useCallback((id: string) => {
    setSavedEmails((prev) => prev.filter((e) => e.id !== id));
    void api.unsaveEmail(id).catch((err: any) => {
      console.error('Failed to unsave email:', err?.message || err);
      void loadSavedEmails();
    });
  }, [loadSavedEmails]);

  const isImportancePending = useCallback((target?: ImportanceFeedbackTarget) => {
    const key = getImportanceFeedbackKey(target);
    return key ? importancePendingKeys.has(key) : false;
  }, [importancePendingKeys]);

  const getImportanceError = useCallback((target?: ImportanceFeedbackTarget) => {
    const key = getImportanceFeedbackKey(target);
    return key ? importanceErrors[key] : undefined;
  }, [importanceErrors]);

  const user = data.auth?.user ?? null;
  const connectedAccounts = data.auth?.accounts ?? [];
  const activeAccountId = data.auth?.activeAccountId ?? null;
  const activeAccount = connectedAccounts.find((account) => account.id === activeAccountId) ?? null;
  const workspaceIdentity = useWorkspaceIdentity(user?.email, user?.name);
  const displayName = workspaceIdentity.identity;
  const isToolSubpage = activeView === 'gmail' || activeView === 'drive' || activeView === 'calendar' || activeView === 'tasks';
  const hasBriefing = briefing && !briefing.error;
  const currentConversation = conversations.find((c) => c.id === currentConversationId) || null;
  const sidePanelTabs = isToolSubpage
    ? [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6)
    : [];
  const handleCloseSideTab = useCallback((conversationId: string) => {
    const remainingTabs = sidePanelTabs.filter((conversation) => conversation.id !== conversationId);
    const isCurrent = conversationId === currentConversationId;
    deleteConversation(conversationId);

    if (!isCurrent) return;
    if (remainingTabs.length > 0) {
      openConversationInPanel(remainingTabs[0].id);
      return;
    }
    closeChat();
  }, [closeChat, currentConversationId, deleteConversation, openConversationInPanel, sidePanelTabs]);
  const hasConversation = Boolean(currentConversation);
  const showConversationHeaderControls = false;
  const currentGroup = threadGroups.find((group) => group.id === currentConversation?.groupId) || threadGroups[0] || null;
  const currentConversationTitle = (currentConversation?.title || 'New chat').trim();
  const currentConversationMeta = hasConversation && currentConversation
    ? `${currentGroup?.name || 'General'} · ${currentConversation.messages.length} msg${currentConversation.messages.length === 1 ? '' : 's'} · ${formatRelativeTimestamp(currentConversation.updatedAt)}`
    : 'No messages yet';

  const viewTitle = activeView === 'settings'
      ? settingsSection === 'general' ? 'General'
      : settingsSection === 'providers' ? 'LLM Providers'
      : settingsSection === 'account' ? 'User Account'
      : settingsSection === 'personalization' ? 'Personalization'
      : 'Updates'
    : activeView === 'workspace' ? 'Tools'
    : activeView === 'skills' ? 'Custom Skills'
    : activeView === 'gmail' ? 'Gmail'
    : activeView === 'drive' ? 'Drive'
    : activeView === 'calendar' ? 'Calendar'
    : activeView === 'tasks' ? 'Tasks'
    : 'Home';
  const viewMeta = activeView === 'dashboard'
    ? 'Workspace command center'
    : 'FlowSpace workspace';
  const showWorkspaceTabs = activeView === 'dashboard' || activeView === 'gmail' || activeView === 'calendar' || activeView === 'tasks';
  const fallbackTriage = data.emails.length > 0
    ? (() => {
      const triage = triageEmailsHeuristic(data.emails, importancePreferences);
      const filterHidden = (items: InboxTriageItem[]) =>
        items.filter((item) => !isTargetIgnored(item.feedback_target));
      return {
        needs_reply: filterHidden(triage.needs_reply),
        needs_input: filterHidden(triage.needs_input),
        fyi_only: filterHidden(triage.fyi_only),
        can_ignore: filterHidden(triage.can_ignore),
      };
    })()
    : null;

  useEffect(() => {
    setIsEditingTitle(false);
    setTitleDraft(currentConversationTitle);
    setThreadGroupDraft(currentConversation?.groupId || threadGroups[0]?.id || '');
    setThreadBriefDraft(currentConversation?.threadBrief || '');
  }, [currentConversation, currentConversationId, currentConversationTitle, threadGroups]);

  useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  const startTitleEdit = useCallback(() => {
    if (!showConversationHeaderControls || !currentConversationId) return;
    setTitleDraft(currentConversationTitle);
    setIsEditingTitle(true);
  }, [showConversationHeaderControls, currentConversationId, currentConversationTitle]);

  const cancelTitleEdit = useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(currentConversationTitle);
  }, [currentConversationTitle]);

  const saveTitleEdit = useCallback(() => {
    if (!currentConversationId) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(currentConversationTitle);
      setIsEditingTitle(false);
      return;
    }
    renameConversation(currentConversationId, trimmed);
    setIsEditingTitle(false);
  }, [currentConversationId, titleDraft, currentConversationTitle, renameConversation]);

  const saveThreadDetails = useCallback(() => {
    if (!currentConversationId || !currentConversation) return;
    const trimmedTitle = titleDraft.trim();
    if (trimmedTitle && trimmedTitle !== currentConversation.title) {
      renameConversation(currentConversationId, trimmedTitle);
    }
    if (threadGroupDraft && threadGroupDraft !== currentConversation.groupId) {
      moveConversationToGroup(currentConversationId, threadGroupDraft);
    }
    if ((threadBriefDraft.trim() || '') !== (currentConversation.threadBrief || '')) {
      updateThreadBrief(currentConversationId, threadBriefDraft);
    }
    setIsThreadDetailsOpen(false);
  }, [currentConversation, currentConversationId, moveConversationToGroup, renameConversation, threadBriefDraft, threadGroupDraft, titleDraft, updateThreadBrief]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = chatWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [chatWidth]);

  const reloadForAccountBoundary = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSwitchAccount = useCallback(async (accountId: string) => {
    setAccountMenuBusy(true);
    try {
      clearAllClientData();
      await api.switchAccount(accountId);
      reloadForAccountBoundary();
    } catch (err: any) {
      console.error('Failed to switch account:', err?.message || err);
      setAccountMenuBusy(false);
    }
  }, [reloadForAccountBoundary]);

  const handleRemoveAccount = useCallback(async (accountId: string) => {
    setAccountMenuBusy(true);
    try {
      clearAllClientData();
      await api.removeAccount(accountId);
      reloadForAccountBoundary();
    } catch (err: any) {
      console.error('Failed to remove account:', err?.message || err);
      setAccountMenuBusy(false);
    }
  }, [connectedAccounts, reloadForAccountBoundary]);

  const handleAddAccount = useCallback(() => {
    startOAuthFlow('/api/accounts/connect', {
      onSuccess: () => reloadForAccountBoundary(),
      onError: (msg) => console.error('Add account failed:', msg),
    });
  }, [reloadForAccountBoundary]);

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      {activeView === 'settings' ? (
        <SettingsRail
          selectedSection={settingsSection}
          onSelect={setSettingsSection}
          onBack={() => setActiveView('dashboard')}
        />
      ) : (
        <AppRail
          user={user ? { ...user, name: displayName } : null}
          accounts={connectedAccounts}
          activeAccountId={activeAccountId}
          accountBusy={accountMenuBusy}
          onAction={triggerAction}
          forceExpanded={false}
          forceCollapsed={chatPanelOpen || isToolSubpage}
          activeSection={
            activeView === 'gmail' ? 'gmail'
              : activeView === 'drive' ? 'drive'
              : activeView === 'calendar' ? 'calendar'
              : activeView === 'tasks' ? 'tasks'
              : activeView === 'workspace' ? 'workspace'
              : activeView === 'skills' ? 'skills'
              : chatPanelOpen || messages.length > 0 ? 'chats'
              : 'home'
          }
          conversations={conversations}
          threadGroups={threadGroups}
          currentConversationId={currentConversationId}
          onSwitchConversation={switchConversation}
          onDeleteConversation={deleteConversation}
          onNewChat={newChat}
          onCreateThreadGroup={createThreadGroup}
          onRenameThreadGroup={renameThreadGroup}
          onDeleteThreadGroup={deleteThreadGroup}
          onSwitchAccount={handleSwitchAccount}
          onAddAccount={handleAddAccount}
          onRemoveAccount={handleRemoveAccount}
          onNavigate={(view) => {
            if (view === 'dashboard') {
              closeChat();
              setActiveView('dashboard');
            } else {
              setActiveView(view);
            }
          }}
        />
      )}

      <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {/* Topbar */}
        <div className="h-14 border-b border-[var(--border)] flex items-center justify-between px-5 md:px-6 gap-4 shrink-0 bg-[var(--bg-elevated)]">
          <div className="min-w-0 flex-1 flex items-center gap-3">
            {isToolSubpage && (
              <button
                onClick={() => setActiveView('workspace')}
                className="h-8 shrink-0 rounded-md border border-[var(--border)] px-2 text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface2)] inline-flex items-center gap-1.5 cursor-pointer"
                title="Back to Tools"
              >
                <ChevronLeft size={14} />
                <span className="text-[14px] font-medium">Tools</span>
              </button>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 min-w-0">
                {isEditingTitle && showConversationHeaderControls ? (
                  <>
                    <input
                      ref={titleInputRef}
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveTitleEdit();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelTitleEdit();
                        }
                      }}
                      className="h-9 w-full max-w-[480px] rounded-md border border-[var(--border2)] bg-[var(--surface)] px-3 text-[14px] font-semibold text-[var(--text)] outline-none focus:border-[var(--accent-border)]"
                    />
                    <button
                      onClick={saveTitleEdit}
                      className="h-7 w-7 rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface2)] inline-flex items-center justify-center cursor-pointer"
                      title="Save title"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      onClick={cancelTitleEdit}
                      className="h-7 w-7 rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface2)] inline-flex items-center justify-center cursor-pointer"
                      title="Cancel rename"
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    {showWorkspaceTabs ? (
                      <div className="flex items-center gap-2 shrink-0" role="tablist" aria-label="Workspace views">
                        {([
                          { key: 'dashboard' as ActiveView, label: 'Home', action: () => { closeChat(); setActiveView('dashboard'); } },
                          { key: 'gmail' as ActiveView, label: 'Gmail', action: () => setActiveView('gmail') },
                          { key: 'calendar' as ActiveView, label: 'Calendar', action: () => setActiveView('calendar') },
                          { key: 'tasks' as ActiveView, label: 'Tasks', action: () => setActiveView('tasks') },
                        ] as const).map((tab) => (
                          <button
                            key={tab.key}
                            role="tab"
                            aria-selected={activeView === tab.key}
                            onClick={tab.action}
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                              activeView === tab.key
                                ? 'border-[var(--accent)]/35 bg-[var(--accent-glow)] text-[var(--text)]'
                                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] hover:text-[var(--text)] hover:border-[var(--border2)]'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div
                        className="text-[16px] font-semibold text-[var(--text)] tracking-[-0.01em] truncate"
                        onDoubleClick={showConversationHeaderControls ? startTitleEdit : undefined}
                        title={viewTitle}
                      >
                        {viewTitle}
                      </div>
                    )}
                    {showConversationHeaderControls && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={startTitleEdit}
                          className="h-7 rounded-md px-2.5 text-[13px] border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface2)] inline-flex items-center justify-center cursor-pointer"
                          title="Rename conversation"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => setIsThreadDetailsOpen(true)}
                          className="h-6 w-6 rounded-md text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface2)] inline-flex items-center justify-center cursor-pointer"
                          title="Thread details"
                        >
                          <SlidersHorizontal size={12} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {newItemCount > 0 && (
              <button
                onClick={() => { acknowledge(); setActiveView('gmail'); }}
                className="flex items-center gap-[5px] bg-[var(--amber-dim)] border border-[var(--amber-border)] text-[var(--amber)] text-[12px] font-medium px-[9px] py-[3px] rounded-full cursor-pointer font-mono"
              >
                <span className="w-[6px] h-[6px] bg-[var(--amber)] rounded-full animate-pulse" />
                {newItemCount} new item{newItemCount !== 1 ? 's' : ''}
              </button>
            )}
            {briefingRetrying && (
              <div className="flex items-center gap-1.5 text-[13px] text-[var(--text-dim)]">
                <RefreshCw size={11} className="animate-spin" />
                Retrying briefing...
              </div>
            )}
            {draftLoading && (
              <div className="flex items-center gap-1.5 text-[13px] text-[var(--text-dim)]">
                <RefreshCw size={11} className="animate-spin" />
                Drafting reply...
              </div>
            )}
            <RunCenter />
            {briefingError && !briefingLoading && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface2)] text-[var(--text-faint)] text-[11px] whitespace-nowrap">
                <AlertCircle size={10} className="shrink-0" />
                <span className="hidden md:inline">AI briefing unavailable</span>
                <span className="md:hidden">Briefing N/A</span>
              </div>
            )}
            <button
              onClick={() => { data.refresh(); refreshBriefing(); }}
              className="text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors cursor-pointer p-1 shrink-0"
              title="Refresh"
            >
              <RefreshCw size={13} className={data.loading ? 'animate-spin' : ''} />
            </button>
            <ProviderSwitcher onProviderChange={refreshBriefing} />
            <AccountMenu
              accounts={connectedAccounts}
              activeAccountId={activeAccountId}
              busy={accountMenuBusy}
              onSwitch={handleSwitchAccount}
              onAdd={handleAddAccount}
              onRemove={handleRemoveAccount}
            />
          </div>
        </div>

        {/* Scroll area */}
        <div className={`flex-1 min-h-0 bg-[var(--bg)] ${(activeView === 'calendar' || activeView === 'dashboard') ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {activeView === 'settings' ? (
            <SettingsPage
              selectedSection={settingsSection}
              onSectionChange={setSettingsSection}
              accounts={connectedAccounts}
              activeAccountId={activeAccountId}
              onAddAccount={handleAddAccount}
              onSwitchAccount={handleSwitchAccount}
              onRemoveAccount={handleRemoveAccount}
            />
          ) : activeView === 'workspace' ? (
            <WorkspaceHub stats={data.stats} onOpen={(view) => setActiveView(view)} />
          ) : activeView === 'skills' ? (
            <SkillsPage />
          ) : activeView === 'gmail' ? (
            <ErrorBoundary key="gmail" fallbackMessage="Something went wrong loading Gmail.">
            <GmailPage
              accountKey={activeAccountId ?? undefined}
              initialTab={navigateTab ?? undefined}
              initialThreadId={gmailOpenRequest?.threadId}
              initialThreadNonce={gmailOpenRequest?.nonce}
              onInitialThreadHandled={() => setGmailOpenRequest(null)}
              savedEmails={savedEmails}
              onUnsaveEmail={handleUnsaveEmail}
            />
            </ErrorBoundary>
          ) : activeView === 'drive' ? (
            <div className="flex items-center justify-center h-full text-[var(--text-faint)]">
              <p className="text-[14px]">Drive page coming soon</p>
            </div>
          ) : activeView === 'calendar' ? (
            <ErrorBoundary key="calendar" fallbackMessage="Something went wrong loading Calendar.">
            <CalendarPage />
            </ErrorBoundary>
          ) : activeView === 'tasks' ? (
            <ErrorBoundary key="tasks" fallbackMessage="Something went wrong loading Tasks.">
            <TasksPage accountEmail={activeAccount?.email ?? user?.email} accountKey={activeAccountId ?? undefined} />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary key="home" fallbackMessage="Something went wrong loading the dashboard.">
            <HomeDashboard
              displayName={displayName}
              briefing={briefing}
              briefingLoading={briefingLoading}
              hasBriefing={hasBriefing}
              stats={data.stats}
              events={data.events}
              files={data.files}
              accountEmail={activeAccount?.email ?? user?.email}
              fallbackTriage={fallbackTriage}
              onSendMessage={sendMessage}
              onTriggerAction={triggerAction}
              onCreateDoc={handleCreateDoc}
              onDraftReply={handleDraftReply}
              onEmailAction={handleEmailAction}
              onBulkAction={handleInboxBulkAction}
              onIgnore={handleIgnoreItem}
              onImportant={handleImportant}
              onNotImportant={handleNotImportant}
              isFeedbackPending={isImportancePending}
              getFeedbackError={getImportanceError}
              onFollowupComplete={handleFollowupComplete}
              onFollowupSnooze={handleFollowupSnooze}
              onFollowupDelete={handleFollowupDelete}
              onOpenThread={handleOpenThreadInApp}
              savedEmails={savedEmails}
              onOpenSavedThread={handleOpenThreadInApp}
              onUnsaveEmail={handleUnsaveEmail}
              onNavigate={(view) => setActiveView(view)}
            />
            </ErrorBoundary>
          )}
        </div>
      </main>

      {/* Chat panel — desktop: resizable, toggleable */}
      {chatPanelOpen && (
        <>
          {/* Resize handle */}
          <div
            onMouseDown={handleResizeStart}
            className="hidden lg:flex w-[5px] h-screen cursor-col-resize items-center justify-center shrink-0 group hover:bg-[var(--accent)]/10 active:bg-[var(--accent)]/20 transition-colors"
          >
            <div className="w-[2px] h-8 rounded-full bg-[var(--border)] group-hover:bg-[var(--accent)] group-active:bg-[var(--accent)] transition-colors" />
          </div>
          <aside
            className="hidden lg:flex h-screen flex-col bg-[var(--bg-elevated)] overflow-hidden shrink-0"
            style={{ width: chatWidth }}
          >
            <div className="flex-1 flex flex-col min-h-0 px-1">
              <ChatThread title={AGENT_NAME} showCloseButton />
              <CommandInput variant="reply" />
            </div>
          </aside>
        </>
      )}

      {(isToolSubpage && sidePanelTabs.length > 0) && (
        <aside className="hidden lg:flex h-screen w-[72px] shrink-0 flex-col items-center border-l border-[var(--border)] bg-[linear-gradient(180deg,var(--bg-elevated),rgba(16,18,24,0.98))] py-3">
          <button
            onClick={toggleChatPanel}
            className={`group relative flex h-14 w-12 items-center justify-center rounded-[18px] border transition-all cursor-pointer ${
              chatPanelOpen
                ? 'border-[var(--accent)]/40 bg-[linear-gradient(180deg,rgba(var(--accent-rgb),0.16),rgba(var(--accent-rgb),0.08))] text-[var(--accent)] shadow-[0_10px_24px_rgba(0,0,0,0.28)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] hover:border-[var(--accent)]/30 hover:text-[var(--text)] hover:bg-[var(--surface2)]'
            }`}
            title={chatPanelOpen ? 'Hide agent panel' : 'Show agent panel'}
          >
            {chatPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-elevated)] ${chatPanelOpen ? 'bg-[var(--accent)]' : 'bg-[var(--text-faint)]'}`} />
          </button>

          <div className="mt-4 flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2 pb-2">
            {sidePanelTabs.map((conversation) => {
              const isActive = conversation.id === currentConversationId;
              const initial = (conversation.title || 'C').trim().charAt(0).toUpperCase() || 'C';
              const status = conversationTabStatus(conversation.id, runs, pendingApprovals);
              const statusToneClass = status.tone === 'running'
                ? 'bg-[var(--blue)]'
                : status.tone === 'approval'
                  ? 'bg-[var(--amber)]'
                  : status.tone === 'done'
                    ? 'bg-[var(--accent)]'
                    : status.tone === 'error'
                      ? 'bg-[var(--error)]'
                      : 'bg-[var(--text-faint)]';
              const toneClass = isActive
                ? 'border-[var(--accent)]/45 bg-[linear-gradient(180deg,rgba(var(--accent-rgb),0.18),rgba(var(--accent-rgb),0.08))] text-[var(--text)] shadow-[0_10px_22px_rgba(0,0,0,0.24)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:border-[var(--border2)] hover:text-[var(--text)] hover:bg-[var(--surface2)]';

              return (
                <div key={conversation.id} className="group relative flex w-full justify-center">
                  <button
                    onClick={() => openConversationInPanel(conversation.id)}
                    className={`relative flex min-h-[56px] w-12 items-center justify-center rounded-[18px] border transition-all cursor-pointer ${toneClass}`}
                    title={`${conversation.title} • ${status.label}`}
                  >
                    <span className={`text-[13px] font-semibold tracking-[0.01em] ${isActive ? 'text-[var(--accent)]' : ''}`}>
                      {initial}
                    </span>
                    <span className={`absolute -right-1 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-elevated)] ${statusToneClass}`} />
                    {status.tone === 'running' && (
                      <span className="absolute bottom-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--surface3)] text-[var(--blue)]">
                        <Loader2 size={9} className="animate-spin" />
                      </span>
                    )}
                    {status.tone === 'approval' && (
                      <span className="absolute bottom-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--amber-dim)] px-1 text-[9px] font-bold text-[var(--amber)]">
                        !
                      </span>
                    )}
                    {status.tone === 'done' && (
                      <span className="absolute bottom-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent-dim)] px-1 text-[9px] font-bold text-[var(--accent)]">
                        ✓
                      </span>
                    )}
                    {status.tone === 'error' && (
                      <span className="absolute bottom-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--error-dim)] px-1 text-[9px] font-bold text-[var(--error)]">
                        !
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseSideTab(conversation.id);
                    }}
                    className="absolute -right-0.5 -top-1 hidden h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-faint)] shadow-[0_6px_14px_rgba(0,0,0,0.28)] transition-all hover:border-[var(--border2)] hover:text-[var(--text)] group-hover:flex cursor-pointer"
                    title={`Close ${conversation.title}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}

            <div className="mt-2 flex h-10 w-10 items-center justify-center rounded-[14px] border border-dashed border-[var(--border)] bg-[rgba(255,255,255,0.02)] text-[var(--text-faint)]" title="Recent agent tabs">
              <MoreHorizontal size={14} />
            </div>
          </div>
        </aside>
      )}

      {/* Mobile chat FAB — visible below lg breakpoint when chat panel is closed */}
      {!chatPanelOpen && (
        <button
          onClick={toggleChatPanel}
          className="fixed bottom-5 right-5 z-30 flex lg:hidden h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg hover:brightness-110 transition-all cursor-pointer"
          aria-label="Open AI assistant"
        >
          <Sparkles size={20} />
        </button>
      )}

      {/* Chat panel — mobile: animated overlay */}
      <AnimatePresence>
        {chatPanelOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: Math.min(480, window.innerWidth), opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="lg:hidden h-screen flex flex-col border-l border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden shrink-0"
          >
            <div className="flex-1 flex flex-col min-h-0">
              <ChatThread title={AGENT_NAME} showCloseButton />
              <CommandInput variant="reply" />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isThreadDetailsOpen && currentConversation && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-30"
              onClick={() => setIsThreadDetailsOpen(false)}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Thread details"
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="fixed right-0 top-0 z-40 h-screen w-full max-w-[360px] border-l border-[var(--border)] bg-[var(--bg-elevated)] p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-semibold text-[var(--text)]">Thread details</div>
                  <div className="text-[11px] text-[var(--text-faint)] mt-0.5">Adjust title, group, and optional thread context.</div>
                </div>
                <button
                  onClick={() => setIsThreadDetailsOpen(false)}
                  className="h-8 w-8 rounded-md text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface2)] inline-flex items-center justify-center cursor-pointer"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-dim)] mb-1.5">Thread title</label>
                  <input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border2)]"
                    placeholder="Thread title"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] font-medium text-[var(--text-dim)]">Group</label>
                    <button
                      onClick={() => {
                        const name = window.prompt('New group name');
                        if (!name) return;
                        const newId = createThreadGroup(name);
                        if (newId) setThreadGroupDraft(newId);
                      }}
                      className="text-[11px] text-[var(--accent)] hover:text-[var(--text)] cursor-pointer"
                    >
                      New group
                    </button>
                  </div>
                  <select
                    value={threadGroupDraft}
                    onChange={(e) => setThreadGroupDraft(e.target.value)}
                    className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border2)]"
                  >
                    {threadGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-dim)] mb-1.5">Optional thread brief</label>
                  <textarea
                    value={threadBriefDraft}
                    onChange={(e) => setThreadBriefDraft(e.target.value)}
                    rows={6}
                    maxLength={400}
                    className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border2)] resize-none"
                    placeholder="Example: This thread is for personal planning. Prefer concise recommendations and highlight deadlines first."
                  />
                  <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                    Used as optional persistent context for this thread only.
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  onClick={() => setIsThreadDetailsOpen(false)}
                  className="h-9 rounded-[10px] border border-[var(--border)] px-3 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface2)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={saveThreadDetails}
                  className="h-9 rounded-[10px] bg-[var(--surface2)] border border-[var(--border2)] px-3 text-[12px] text-[var(--text)] hover:bg-[var(--surface3)] cursor-pointer"
                >
                  Save changes
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Draft Reply Modal */}
      {draftModal && (
        <DraftReplyModal
          draft={draftModal.draft}
          subject={draftModal.subject}
          to={draftModal.to}
          threadId={draftModal.thread_id}
          originalMessages={draftModal.original_messages}
          onClose={() => setDraftModal(null)}
          onSent={() => {
            setDraftModal(null);
            refreshBriefing();
          }}
        />
      )}
    </div>
  );
}

/** Inner gate: handles Google Workspace connection after Supabase sign-in. */
function GoogleGate() {
  const [googleChecked, setGoogleChecked] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<Awaited<ReturnType<typeof api.getAuthStatus>> | null>(null);
  const [showSlowHint, setShowSlowHint] = useState(false);

  const refreshGoogleStatus = useCallback(() => {
    const timer = window.setTimeout(() => setShowSlowHint(true), 2500);
    api.getAuthStatus()
      .then((status) => {
        setGoogleStatus(status);
        setGoogleChecked(true);
      })
      .catch(() => {
        setGoogleStatus(null);
        setGoogleChecked(true);
      })
      .finally(() => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    refreshGoogleStatus();
  }, [refreshGoogleStatus]);

  if (!googleChecked) {
    return (
      <div className="h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-4 px-6">
        <FlowSpaceLogo size={40} className="animate-pulse" />
        <div className="text-center">
          <p className="text-[14px] text-[var(--text-dim)]">Connecting to FlowSpace...</p>
          {showSlowHint && (
            <p className="mt-2 text-[12px] text-[var(--text-faint)]">
              Auth check is taking longer than expected.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!googleStatus?.authenticated) {
    return (
      <ConnectGooglePage
        onConnected={refreshGoogleStatus}
      />
    );
  }

  return (
    <ChatProvider userEmail={googleStatus.user?.email ?? undefined}>
      <AppInner />
    </ChatProvider>
  );
}

/** Top-level app: Supabase auth gate → Google gate → Dashboard. */
export default function App() {
  const supabaseConfigured = Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  );

  // If Supabase is not configured, fall back to the original Google-only auth flow
  if (!supabaseConfigured) {
    return <GoogleOnlyApp />;
  }

  return (
    <AuthProvider>
      <SupabaseGatedApp />
    </AuthProvider>
  );
}

/** Original auth flow for when Supabase is not configured (dev/local). */
function GoogleOnlyApp() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authStatus, setAuthStatus] = useState<Awaited<ReturnType<typeof api.getAuthStatus>> | null>(null);

  const refreshAuthStatus = useCallback(() => {
    api.getAuthStatus()
      .then((status) => {
        setAuthStatus(status);
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthStatus(null);
        setAuthChecked(true);
      });
  }, []);

  useEffect(() => {
    // After OAuth callback redirect, clean up query params
    const params = new URLSearchParams(window.location.search);
    if (params.has('auth_success') || params.has('auth_error')) {
      window.history.replaceState({}, '', '/');
    }
    refreshAuthStatus();
  }, [refreshAuthStatus]);

  if (!authChecked) {
    return (
      <div className="h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-4 px-6">
        <FlowSpaceLogo size={40} className="animate-pulse" />
        <p className="text-[14px] text-[var(--text-dim)]">Connecting to FlowSpace...</p>
      </div>
    );
  }

  if (!authStatus?.authenticated) {
    return <SignInScreen />;
  }

  return (
    <AuthProvider>
      <ChatProvider userEmail={authStatus.user?.email}>
        <AppInner />
      </ChatProvider>
    </AuthProvider>
  );
}

/** Supabase-gated app: requires Supabase sign-in first, then Google connection. */
function SupabaseGatedApp() {
  const { view } = useAuth();

  if (view === 'loading') {
    return (
      <div className="h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-4 px-6">
        <FlowSpaceLogo size={40} className="animate-pulse" />
        <p className="text-[14px] text-[var(--text-dim)]">Loading...</p>
      </div>
    );
  }

  if (view === 'signed_out') {
    return <AuthPage />;
  }

  return <GoogleGate />;
}
