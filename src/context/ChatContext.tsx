/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import { createId, normalizeMessages, titleFromMessages, toChatInput } from '../lib/chat-utils';
import type { ApprovalRequest, AssistantBlock, ChatStreamEvent, RunRecord, RunSummary, ToolEvent } from '../shared/chat';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Optional user-facing text shown in the chat bubble instead of `content` (which may contain injected context). */
  displayContent?: string;
  blocks?: AssistantBlock[];
  toolEvents?: ToolEvent[];
  approval?: ApprovalRequest;
  suggestions?: string[];
  status?: 'streaming' | 'complete' | 'error';
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  groupId: string;
  threadBrief?: string;
  titleMode?: 'auto' | 'manual';
  /** Links this conversation to a calendar event by its Google Calendar event ID. */
  eventId?: string;
}

export interface ThreadGroup {
  id: string;
  name: string;
  createdAt: number;
}

export type ActiveView = 'dashboard' | 'settings' | 'mail' | 'calendar' | 'tasks' | 'workflows' | 'automations';

interface ChatContextValue {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  navigateTab: string | null;
  clearNavigateTab: () => void;
  pendingWorkflowEdit: string | null;
  setPendingWorkflowEdit: (name: string | null) => void;
  navigateRefresh: boolean;
  clearNavigateRefresh: () => void;
  messages: Message[];
  conversations: Conversation[];
  threadGroups: ThreadGroup[];
  runs: RunRecord[];
  runSummary: RunSummary | null;
  refreshRuns: () => Promise<void>;
  pendingApprovals: { conversationId: string; messageId: string; title: string; approval: ApprovalRequest }[];
  currentConversationId: string | null;
  chatPanelOpen: boolean;
  input: string;
  setInput: (text: string) => void;
  isLoading: boolean;
  sendMessage: (content?: string, options?: { forceNewChat?: boolean; preserveActiveView?: boolean; displayContent?: string; threadBrief?: string; eventId?: string }) => Promise<void>;
  stopGeneration: () => void;
  triggerAction: (prompt: string, autoSend: boolean) => void;
  registerInputRef: (el: HTMLTextAreaElement | HTMLInputElement | null) => void;
  focusInput: () => void;
  newChat: () => void;
  closeChat: () => void;
  toggleChatPanel: () => void;
  openChatPanel: () => void;
  openConversationInPanel: (id: string) => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  createThreadGroup: (name: string) => string | null;
  renameThreadGroup: (id: string, name: string) => void;
  deleteThreadGroup: (id: string) => void;
  moveConversationToGroup: (conversationId: string, groupId: string) => void;
  updateThreadBrief: (conversationId: string, brief: string) => void;
  approveAction: (messageId: string, approval: ApprovalRequest) => Promise<void>;
  undoInboxActionFromAudit: (auditId: string) => Promise<void>;
  dismissApproval: (messageId: string) => void;
  editAssistantMessage: (messageId: string, content: string) => void;
  /** Get an existing conversation by stable id, or create and switch to a new one. */
  getOrCreateConversation: (id: string, seed: { title: string; threadBrief?: string; groupId?: string }) => void;
  /** Returns the most recent conversation linked to a calendar event ID, or null. */
  findConversationByEventId: (eventId: string) => Conversation | null;
}

const ChatContext = createContext<ChatContextValue | null>(null);
const LEGACY_KEY = 'flowspace.chat.messages.v2';
export const DEFAULT_THREAD_GROUP_ID = 'group_general';
export const DEFAULT_THREAD_GROUP_NAME = 'General';

function defaultThreadGroup(): ThreadGroup {
  return {
    id: DEFAULT_THREAD_GROUP_ID,
    name: DEFAULT_THREAD_GROUP_NAME,
    createdAt: 0,
  };
}

/** Build account-scoped localStorage keys. Empty userKey falls back to shared keys for backwards compat. */
function storageKeys(userKey: string) {
  const prefix = userKey ? `flowspace.chat.${userKey}` : 'flowspace.chat';
  return {
    conversations: `${prefix}.conversations.v1`,
    groups: `${prefix}.groups.v1`,
    currentId: `${prefix}.currentId`,
    panelOpen: `${prefix}.panelOpen`,
    activeView: `${prefix}.activeView`,
  };
}

/** Clear all chat localStorage for a given account email (or unscoped if no email). */
export function clearChatStorage(email?: string): void {
  const userKey = email ? email.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
  const keys = storageKeys(userKey);
  for (const key of Object.values(keys)) {
    window.localStorage.removeItem(key);
  }
}

function loadConversations(keys: ReturnType<typeof storageKeys>): Conversation[] {
  try {
    // Migrate from legacy single-conversation storage (one-time, only for unscoped key)
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const msgs = normalizeMessages(JSON.parse(legacy));
      window.localStorage.removeItem(LEGACY_KEY);
      if (msgs.length > 0) {
        const conv: Conversation = {
          id: createId('conv'),
          title: titleFromMessages(msgs),
          messages: msgs,
          updatedAt: Date.now(),
          groupId: DEFAULT_THREAD_GROUP_ID,
          titleMode: 'auto',
        };
        window.localStorage.setItem(keys.conversations, JSON.stringify([conv]));
        window.localStorage.setItem(keys.groups, JSON.stringify([defaultThreadGroup()]));
        window.localStorage.setItem(keys.currentId, conv.id);
        return [conv];
      }
    }

    const saved = window.localStorage.getItem(keys.conversations);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c: any) => c && c.id && Array.isArray(c.messages))
      .map((c: any) => ({
        ...c,
        groupId: typeof c.groupId === 'string' && c.groupId.trim() ? c.groupId : DEFAULT_THREAD_GROUP_ID,
        threadBrief: typeof c.threadBrief === 'string' ? c.threadBrief : undefined,
        titleMode: c.titleMode === 'manual' ? 'manual' : 'auto',
        eventId: typeof c.eventId === 'string' ? c.eventId : undefined,
      }));
  } catch {
    return [];
  }
}

function loadThreadGroups(keys: ReturnType<typeof storageKeys>): ThreadGroup[] {
  try {
    const saved = window.localStorage.getItem(keys.groups);
    const parsed = saved ? JSON.parse(saved) : [];
    const groups = Array.isArray(parsed)
      ? parsed.filter((group: any) => group && typeof group.id === 'string' && typeof group.name === 'string')
      : [];
    return groups.some((group: ThreadGroup) => group.id === DEFAULT_THREAD_GROUP_ID)
      ? groups
      : [defaultThreadGroup(), ...groups];
  } catch {
    return [defaultThreadGroup()];
  }
}

function replaceToolEvent(events: ToolEvent[] | undefined, next: ToolEvent): ToolEvent[] {
  if (!events || events.length === 0) return [next];
  const index = events.findIndex((event) => event.id === next.id);
  if (index === -1) return [...events, next];
  const copy = [...events];
  copy[index] = next;
  return copy;
}

function upsertRun(runs: RunRecord[], next: RunRecord): RunRecord[] {
  const idx = runs.findIndex((run) => run.id === next.id);
  if (idx === -1) return [next, ...runs];
  const copy = [...runs];
  copy[idx] = next;
  return copy.sort((a, b) => b.startedAt - a.startedAt);
}

function friendlyErrorMessage(error: string): string {
  // Always log the raw error so debugging doesn't require curl. The friendly
  // message is intentionally vague to avoid leaking provider internals into
  // the UI, but the full text lives in the console for developers.
  // eslint-disable-next-line no-console
  console.error('[chat] raw error:', error);
  const lowered = error.toLowerCase();
  if (lowered.includes('unauthorized') || lowered.includes('401') || lowered.includes('invalid_api_key') || lowered.includes('authentication failed')) return 'Authentication expired. Please sign in again.';
  if (lowered.includes('n_keep') || lowered.includes('context length') || lowered.includes('context window') || lowered.includes('n_ctx')) return 'The system prompt exceeds this model\'s context window. In LM Studio, load a model with a larger context (8k+), or reduce the context under Model Settings.';
  if (lowered.includes('429') || lowered.includes('rate')) return 'Rate limited by provider. Please retry shortly.';
  if (lowered.includes('timeout') || lowered.includes('timed out')) return 'The request timed out. Try a narrower request.';
  if (lowered.includes('invalid') || lowered.includes('required') || lowered.includes('validation')) return 'The request needs different inputs. Please review and retry.';
  return error;
}

export function ChatProvider({ children, userEmail }: { children: ReactNode; userEmail?: string }) {
  // Derive a stable storage key from the user's email (lowercase, no special chars)
  const userKey = userEmail ? userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
  const keys = storageKeys(userKey);

  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations(keys));
  const [threadGroups, setThreadGroups] = useState<ThreadGroup[]>(() => loadThreadGroups(keys));
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => {
    return window.localStorage.getItem(keys.currentId) || null;
  });
  const [chatPanelOpen, setChatPanelOpen] = useState<boolean>(() => {
    return window.localStorage.getItem(keys.panelOpen) !== 'false';
  });
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const savedView = window.localStorage.getItem(keys.activeView) as ActiveView | null;
    const validViews: ActiveView[] = ['dashboard', 'settings', 'mail', 'calendar', 'tasks', 'workflows'];
    if (savedView && validViews.includes(savedView)) {
      return savedView;
    }
    return 'dashboard';
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [navigateTab, setNavigateTab] = useState<string | null>(null);
  const clearNavigateTab = useCallback(() => setNavigateTab(null), []);
  const [pendingWorkflowEdit, setPendingWorkflowEdit] = useState<string | null>(null);
  const [navigateRefresh, setNavigateRefresh] = useState(false);
  const clearNavigateRefresh = useCallback(() => setNavigateRefresh(false), []);
  const inputElRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  // Refs to avoid stale closures — always read latest state in callbacks
  const currentConvIdRef = useRef(currentConversationId);
  currentConvIdRef.current = currentConversationId;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  const currentConversation = conversations.find((c) => c.id === currentConversationId) ?? null;
  const messages = currentConversation?.messages ?? [];
  const pendingApprovals = conversations.flatMap((conv) =>
    conv.messages
      .filter((msg) => msg.role === 'assistant' && msg.approval)
      .map((msg) => ({
        conversationId: conv.id,
        messageId: msg.id,
        title: conv.title,
        approval: msg.approval!,
      }))
  );

  const registerInputRef = useCallback((el: HTMLTextAreaElement | HTMLInputElement | null) => {
    inputElRef.current = el;
  }, []);

  // Reload data when account changes
  useEffect(() => {
    const loaded = loadConversations(keys);
    setConversations(loaded);
    setThreadGroups(loadThreadGroups(keys));
    setCurrentConversationId(window.localStorage.getItem(keys.currentId) || null);
    setChatPanelOpen(window.localStorage.getItem(keys.panelOpen) !== 'false');
  }, [userKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist conversations
  useEffect(() => {
    if (conversations.length === 0) {
      window.localStorage.removeItem(keys.conversations);
    } else {
      window.localStorage.setItem(keys.conversations, JSON.stringify(conversations));
    }
  }, [conversations, keys.conversations]);

  useEffect(() => {
    if (threadGroups.length === 0) {
      window.localStorage.setItem(keys.groups, JSON.stringify([defaultThreadGroup()]));
      return;
    }
    window.localStorage.setItem(keys.groups, JSON.stringify(threadGroups));
  }, [threadGroups, keys.groups]);

  useEffect(() => {
    const existingIds = new Set(threadGroups.map((group) => group.id));
    const missingDefault = !existingIds.has(DEFAULT_THREAD_GROUP_ID);
    if (!missingDefault) return;

    setThreadGroups((prev) => {
      const next = prev.some((group) => group.id === DEFAULT_THREAD_GROUP_ID)
        ? [...prev]
        : [defaultThreadGroup(), ...prev];
      return next;
    });
  }, [conversations, threadGroups]);

  useEffect(() => {
    const existingIds = new Set(threadGroups.map((group) => group.id));
    if (existingIds.size === 0) return;

    setConversations((prev) => {
      let changed = false;
      const next = prev.map((conversation) => {
        if (existingIds.has(conversation.groupId)) return conversation;
        changed = true;
        return { ...conversation, groupId: DEFAULT_THREAD_GROUP_ID };
      });
      return changed ? next : prev;
    });
  }, [threadGroups]);

  // Persist current ID
  useEffect(() => {
    if (currentConversationId) {
      window.localStorage.setItem(keys.currentId, currentConversationId);
    } else {
      window.localStorage.removeItem(keys.currentId);
    }
  }, [currentConversationId, keys.currentId]);

  // Persist active view
  useEffect(() => {
    window.localStorage.setItem(keys.activeView, activeView);
  }, [activeView, keys.activeView]);

  // Persist panel state
  useEffect(() => {
    window.localStorage.setItem(keys.panelOpen, String(chatPanelOpen));
  }, [chatPanelOpen, keys.panelOpen]);

  const focusInput = useCallback(() => {
    inputElRef.current?.focus();
  }, []);

  const updateConversationMessages = useCallback((conversationId: string, updater: (msgs: Message[]) => Message[]) => {
    setConversations((prev) => prev.map((c) => {
      if (c.id !== conversationId) return c;
      const newMsgs = updater(c.messages);
      const nextTitle = c.titleMode === 'manual' ? c.title : titleFromMessages(newMsgs);
      return { ...c, messages: newMsgs, title: nextTitle, updatedAt: Date.now() };
    }));
  }, []);

  const updateConversationMessage = useCallback((conversationId: string, messageId: string, updater: (message: Message) => Message) => {
    updateConversationMessages(conversationId, (msgs) => msgs.map((m) => (m.id === messageId ? updater(m) : m)));
  }, [updateConversationMessages]);

  const updateCurrentMessages = useCallback((updater: (msgs: Message[]) => Message[]) => {
    if (!currentConversationId) return;
    updateConversationMessages(currentConversationId, updater);
  }, [currentConversationId, updateConversationMessages]);

  const updateMessage = useCallback((messageId: string, updater: (message: Message) => Message) => {
    if (!currentConversationId) return;
    updateConversationMessage(currentConversationId, messageId, updater);
  }, [currentConversationId, updateConversationMessage]);

  const editAssistantMessage = useCallback((messageId: string, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    updateMessage(messageId, (message) => {
      if (message.role !== 'assistant') return message;
      if (message.status === 'streaming') return message;
      return { ...message, content: trimmed };
    });
  }, [updateMessage]);

  const handleStreamEvent = useCallback((conversationId: string, assistantId: string, event: ChatStreamEvent) => {
    if (event.type === 'run_started' || event.type === 'run_progress' || event.type === 'run_status_changed' || event.type === 'run_completed' || event.type === 'run_failed') {
      setRuns((prev) => upsertRun(prev, event.run));
      return;
    }
    if (event.type === 'assistant_begin') {
      updateConversationMessage(conversationId, assistantId, (message) => ({ ...message, status: 'streaming' }));
      return;
    }
    if (event.type === 'assistant_chunk') {
      updateConversationMessage(conversationId, assistantId, (message) => ({
        ...message,
        content: message.content ? `${message.content} ${event.chunk}` : event.chunk,
        status: 'streaming',
      }));
      return;
    }
    if (event.type === 'tool_event') {
      updateConversationMessage(conversationId, assistantId, (message) => ({
        ...message,
        toolEvents: replaceToolEvent(message.toolEvents, event.event),
        status: 'streaming',
      }));
      return;
    }
    if (event.type === 'assistant_complete') {
      const blocks = [...event.payload.blocks];
      
      // Show "Run complete" only when a run actually executed tool steps and no approval is pending.
      if (!event.payload.approval && event.payload.toolEvents.length > 0) {
        blocks.push({
          type: 'status',
          title: 'Run complete',
          body: `Completed ${event.payload.toolEvents.length} tool step${event.payload.toolEvents.length !== 1 ? 's' : ''}.`,
        });
      }

      updateConversationMessage(conversationId, assistantId, (message) => ({
        ...message,
        content: event.payload.content,
        blocks,
        toolEvents: event.payload.toolEvents,
        approval: event.payload.approval,
        suggestions: event.payload.suggestions,
        status: 'complete',
      }));
      return;
    }
    if (event.type === 'navigate') {
      const validViews = new Set<ActiveView>(['dashboard', 'settings', 'mail', 'calendar', 'tasks', 'workflows']);
      if (validViews.has(event.view as ActiveView)) {
        setActiveView(event.view as ActiveView);
        if (event.tab) setNavigateTab(event.tab);
        if (event.refresh) setNavigateRefresh(true);
      }
      return;
    }
    if (event.type === 'assistant_aborted') {
      updateConversationMessage(conversationId, assistantId, (message) => ({
        ...message,
        content: message.content || 'Generation stopped.',
        blocks: [
          ...(message.blocks ?? []),
          { type: 'status', title: 'Generation stopped', body: 'The in-flight request was canceled before completion.' },
        ],
        status: 'complete',
      }));
      return;
    }
    if (event.type === 'assistant_error') {
      const friendly = friendlyErrorMessage(event.error);
      updateConversationMessage(conversationId, assistantId, (message) => ({
        ...message,
        content: `Error: ${friendly}`,
        status: 'error',
      }));
    }
  }, [updateConversationMessage]);

  const streamAssistantResponse = useCallback(async (payload: { conversationId: string; sourceMessages: Message[]; assistantId: string; threadBrief?: string; title?: string; eventId?: string }) => {
    const controller = new AbortController();
    streamAbortRef.current = controller;
    try {
      await api.streamChat(
        toChatInput(payload.sourceMessages),
        (event) => handleStreamEvent(payload.conversationId, payload.assistantId, event),
        controller.signal,
        { conversationId: payload.conversationId, sourceMessageId: payload.assistantId, threadBrief: payload.threadBrief, title: payload.title, eventId: payload.eventId },
      );
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        updateConversationMessage(payload.conversationId, payload.assistantId, (message) => ({
          ...message,
          content: message.content || 'Generation stopped.',
          blocks: [
            ...(message.blocks ?? []),
            { type: 'status', title: 'Generation stopped', body: 'The in-flight request was canceled before completion.' },
          ],
          status: 'complete',
        }));
        return;
      }
      updateConversationMessage(payload.conversationId, payload.assistantId, (message) => ({
        ...message,
        content: `Error: ${error?.message || 'Request failed'}`,
        status: 'error',
      }));
    } finally {
      streamAbortRef.current = null;
      setIsLoading(false);
    }
  }, [handleStreamEvent, updateConversationMessage]);

  const refreshRuns = useCallback(async () => {
    try {
      const [runsRes, summaryRes] = await Promise.all([
        api.getRuns({ limit: 100 }),
        api.getRunSummary('24h'),
      ]);
      setRuns(runsRes.runs);
      setRunSummary(summaryRes.summary);
    } catch {
      // non-blocking; telemetry is best-effort
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
    const interval = window.setInterval(() => void refreshRuns(), 15000);
    return () => window.clearInterval(interval);
  }, [refreshRuns]);

  const sendMessage = useCallback(async (content?: string, options?: { forceNewChat?: boolean; preserveActiveView?: boolean; displayContent?: string; threadBrief?: string; eventId?: string }) => {
    const text = (content ?? input).trim();
    if (!text || isLoading) return;

    const userMessage: Message = { id: createId('user'), role: 'user', content: text, status: 'complete', ...(options?.displayContent ? { displayContent: options.displayContent } : {}) };
    const assistantMessage: Message = { id: createId('assistant'), role: 'assistant', content: '', blocks: [], toolEvents: [], status: 'streaming' };

    // Read latest state from refs to avoid stale closure bugs
    const latestConvId = currentConvIdRef.current;
    const latestConversations = conversationsRef.current;
    const latestActiveView = activeViewRef.current;

    // Force a new conversation when: explicitly requested, or sending from dashboard
    const shouldStartNew = options?.forceNewChat || latestActiveView === 'dashboard';
    let targetConvId = shouldStartNew ? null : latestConvId;
    const existingConv = targetConvId
      ? latestConversations.find((c) => c.id === targetConvId)
      : null;

    if (!existingConv) {
      targetConvId = createId('conv');
      const conv: Conversation = {
        id: targetConvId,
        title: titleFromMessages([userMessage]),
        messages: [userMessage, assistantMessage],
        updatedAt: Date.now(),
        groupId: existingConv?.groupId || currentConversation?.groupId || DEFAULT_THREAD_GROUP_ID,
        titleMode: 'auto',
        ...(options?.threadBrief ? { threadBrief: options.threadBrief } : {}),
        ...(options?.eventId ? { eventId: options.eventId } : {}),
      };
      setConversations((prev) => [conv, ...prev]);
      setCurrentConversationId(targetConvId);
    } else {
      setConversations((prev) => prev.map((c) => {
        if (c.id !== targetConvId) return c;
        const updated = [...c.messages, userMessage];
        return {
          ...c,
          messages: [...updated, assistantMessage],
          title: c.titleMode === 'manual' ? c.title : titleFromMessages(updated),
          updatedAt: Date.now(),
        };
      }));
    }

    const sourceMessages: Message[] = existingConv
      ? [...existingConv.messages, userMessage]
      : [userMessage];

    setInput('');
    setIsLoading(true);
    if (!options?.preserveActiveView) {
      setChatPanelOpen(true);
    }

    await streamAssistantResponse({
      conversationId: targetConvId!,
      sourceMessages,
      assistantId: assistantMessage.id,
      threadBrief: options?.threadBrief ?? existingConv?.threadBrief,
      title: existingConv?.title,
      eventId: options?.eventId ?? existingConv?.eventId,
    });
  }, [currentConversation?.groupId, input, isLoading, streamAssistantResponse]);

  const stopGeneration = useCallback(() => {
    streamAbortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const newChat = useCallback(() => {
    const id = createId('conv');
    const conv: Conversation = {
      id,
      title: 'New conversation',
      messages: [],
      updatedAt: Date.now(),
      groupId: currentConversation?.groupId || DEFAULT_THREAD_GROUP_ID,
      titleMode: 'auto',
    };
    setConversations((prev) => [conv, ...prev]);
    setCurrentConversationId(id);
    setChatPanelOpen(true);
    requestAnimationFrame(() => {
      inputElRef.current?.focus();
      // Clear input when starting a new chat explicitly
      setInput('');
    });
  }, [currentConversation?.groupId]);

  const closeChat = useCallback(() => {
    setChatPanelOpen(false);
  }, []);

  const toggleChatPanel = useCallback(() => {
    setChatPanelOpen((prev) => !prev);
  }, []);

  const openChatPanel = useCallback(() => {
    setChatPanelOpen(true);
  }, []);

  const openConversationInPanel = useCallback((id: string) => {
    setCurrentConversationId(id);
    setChatPanelOpen(true);
  }, []);

  const switchConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
    setChatPanelOpen(true);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      return filtered;
    });
    if (currentConversationId === id) {
      setCurrentConversationId(null);
    }
  }, [currentConversationId]);

  const renameConversation = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setConversations((prev) => prev.map((c) => (
      c.id === id
        ? { ...c, title: trimmed, titleMode: 'manual', updatedAt: Date.now() }
        : c
    )));
  }, []);

  const createThreadGroup = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = createId('group');
    setThreadGroups((prev) => [...prev, { id, name: trimmed, createdAt: Date.now() }]);
    return id;
  }, []);

  const renameThreadGroup = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setThreadGroups((prev) => prev.map((group) => (
      group.id === id ? { ...group, name: trimmed } : group
    )));
  }, []);

  const deleteThreadGroup = useCallback((id: string) => {
    if (id === DEFAULT_THREAD_GROUP_ID) return;
    setThreadGroups((prev) => prev.filter((group) => group.id !== id));
    setConversations((prev) => prev.map((conversation) => (
      conversation.groupId === id
        ? { ...conversation, groupId: DEFAULT_THREAD_GROUP_ID, updatedAt: Date.now() }
        : conversation
    )));
  }, []);

  const moveConversationToGroup = useCallback((conversationId: string, groupId: string) => {
    setConversations((prev) => prev.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, groupId, updatedAt: Date.now() }
        : conversation
    )));
  }, []);

  const updateThreadBrief = useCallback((conversationId: string, brief: string) => {
    const trimmed = brief.trim();
    setConversations((prev) => prev.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, threadBrief: trimmed || undefined, updatedAt: Date.now() }
        : conversation
    )));
  }, []);

  const findConversationByEventId = useCallback((eventId: string): Conversation | null => {
    return conversationsRef.current
      .filter((c) => c.eventId === eventId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }, []);

  const getOrCreateConversation = useCallback((id: string, seed: { title: string; threadBrief?: string; groupId?: string }) => {
    const existing = conversationsRef.current.find((c) => c.id === id);
    if (existing) {
      // Refresh threadBrief when the underlying item's enrichment changes
      // (e.g. enrichment lands after the conversation was first created).
      // Without this, the agent would be prompted with the stale brief.
      // Title is left alone so user-renamed conversations don't get
      // clobbered on the next item-derived render.
      const nextBrief = seed.threadBrief?.trim() || undefined;
      if (nextBrief !== existing.threadBrief) {
        setConversations((prev) => prev.map((c) => (
          c.id === id ? { ...c, threadBrief: nextBrief, updatedAt: Date.now() } : c
        )));
      }
      setCurrentConversationId(id);
    } else {
      const conv: Conversation = {
        id,
        title: seed.title,
        messages: [],
        updatedAt: Date.now(),
        groupId: seed.groupId ?? DEFAULT_THREAD_GROUP_ID,
        titleMode: 'manual',
        ...(seed.threadBrief ? { threadBrief: seed.threadBrief } : {}),
      };
      setConversations((prev) => [conv, ...prev]);
      setCurrentConversationId(id);
    }
  }, []);

  const triggerAction = useCallback((prompt: string, autoSend: boolean) => {
    if (autoSend) {
      // Atomically create a new conversation and send — avoids stale closure bugs
      void sendMessage(prompt, { forceNewChat: true });
      return;
    }
    // For non-auto-send, open a new chat with the prompt pre-filled
    newChat();
    setInput(prompt);
    requestAnimationFrame(() => inputElRef.current?.focus());
  }, [sendMessage, newChat]);

  const approveAction = useCallback(async (messageId: string, approval: ApprovalRequest) => {
    if (isLoading) return;

    // Find the conversation for this message
    const conversation = conversations.find(c => c.messages.some(m => m.id === messageId));
    if (!conversation) return;

    const conversationId = conversation.id;
    updateConversationMessage(conversationId, messageId, (message) => ({ ...message, approval: undefined }));

    const assistantMessage: Message = { id: createId('assistant'), role: 'assistant', content: '', blocks: [], toolEvents: [], status: 'streaming' };

    updateConversationMessages(conversationId, (msgs) => [...msgs, assistantMessage]);
    setIsLoading(true);
    
    // Switch to this conversation so the user sees the result
    setCurrentConversationId(conversationId);
    setChatPanelOpen(true);

    const controller = new AbortController();
    streamAbortRef.current = controller;

    try {
      await api.approveChatAction(approval, (event) => handleStreamEvent(conversationId, assistantMessage.id, event), controller.signal);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        updateConversationMessage(conversationId, assistantMessage.id, (message) => ({
          ...message,
          content: message.content || 'Action canceled during execution.',
          blocks: [
            ...(message.blocks ?? []),
            { type: 'status', title: 'Action canceled', body: 'The approved action was canceled before the server finished executing it.' },
          ],
          status: 'complete',
        }));
        return;
      }
      updateConversationMessage(conversationId, assistantMessage.id, (message) => ({
        ...message,
        content: `Error: ${error?.message || 'Approval failed'}`,
        status: 'error',
      }));
    } finally {
      streamAbortRef.current = null;
      setIsLoading(false);
    }
  }, [handleStreamEvent, isLoading, updateConversationMessage, updateConversationMessages, conversations]);

  const dismissApproval = useCallback((messageId: string) => {
    const conversation = conversations.find(c => c.messages.some(m => m.id === messageId));
    if (!conversation) return;

    updateConversationMessage(conversation.id, messageId, (message) => ({
      ...message,
      approval: undefined,
      blocks: [
        ...(message.blocks ?? []),
        { type: 'status', title: 'Action canceled', body: 'The write action was canceled and nothing was executed.' },
      ],
    }));
  }, [updateConversationMessage, conversations]);

  const undoInboxActionFromAudit = useCallback(async (auditId: string) => {
    if (isLoading || !currentConversationId) return;

    const assistantMessage: Message = { id: createId('assistant'), role: 'assistant', content: '', blocks: [], toolEvents: [], status: 'streaming' };
    updateConversationMessages(currentConversationId, (msgs) => [...msgs, assistantMessage]);
    setIsLoading(true);

    try {
      const result = await api.undoInboxAction(auditId);
      updateConversationMessage(currentConversationId, assistantMessage.id, (message) => ({
        ...message,
        content: result.message || 'Undo completed.',
        blocks: [
          {
            type: 'status',
            title: 'Undo completed',
            body: result.message || `Reverted ${result.succeeded_count} inbox action(s).`,
          },
          {
            type: 'bulk_action_preview',
            title: 'Affected threads',
            actionType: result.action_type,
            effect: 'Undo applied.',
            items: result.items.map((item) => ({
              thread_id: item.thread_id,
              sender: item.sender,
              subject: item.subject,
              reason: item.reason,
              status: item.status,
              error: item.error,
            })),
            auditId: result.audit_id,
            undoAvailable: false,
            undoExpiresAt: result.undo_expires_at,
          },
        ],
        status: 'complete',
      }));
    } catch (error: any) {
      updateConversationMessage(currentConversationId, assistantMessage.id, (message) => ({
        ...message,
        content: `Error: ${error?.message || 'Undo failed'}`,
        status: 'error',
      }));
    } finally {
      setIsLoading(false);
    }
  }, [currentConversationId, isLoading, updateConversationMessage, updateConversationMessages]);

  return (
    <ChatContext.Provider
      value={{
        activeView,
        setActiveView,
        navigateTab,
        clearNavigateTab,
        pendingWorkflowEdit,
        setPendingWorkflowEdit,
        navigateRefresh,
        clearNavigateRefresh,
        messages,
        conversations,
        threadGroups,
        runs,
        runSummary,
        refreshRuns,
        pendingApprovals,
        currentConversationId,
        chatPanelOpen,
        input,
        setInput,
        isLoading,
        sendMessage,
        stopGeneration,
        triggerAction,
        registerInputRef,
        focusInput,
        newChat,
        closeChat,
        toggleChatPanel,
        openChatPanel,
        openConversationInPanel,
        switchConversation,
        deleteConversation,
        renameConversation,
        createThreadGroup,
        renameThreadGroup,
        deleteThreadGroup,
        moveConversationToGroup,
        updateThreadBrief,
        approveAction,
        undoInboxActionFromAudit,
        dismissApproval,
        editAssistantMessage,
        getOrCreateConversation,
        findConversationByEventId,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within a ChatProvider');
  return ctx;
}
