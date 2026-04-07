/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ApprovalRequest,
  AssistantPayload,
  ChatMessageInput,
  ChatStreamEvent,
  InboxActionAuditRecord,
  InboxActionResult,
  InboxActionType,
  RunRecord,
  RunStatus,
  RunSummary,
} from '../shared/chat';
import type {
  ImportanceFeedbackTarget,
  PreferenceExample,
  PreferenceLabel,
} from '../lib/importance-feedback';

// ── Types ──────────────────────────────────────────────────────────

export interface UserProfile {
  name: string;
  email: string;
  picture?: string;
}

export interface ConnectedAccount {
  id: string;
  email: string;
  name: string | null;
  picture?: string | null;
  scopes: string[];
  connectedAt: number;
  lastUsedAt: number;
  auth_method: 'gws' | 'adc';
}

export interface AuthStatus {
  authenticated: boolean;
  auth_method?: 'gws' | 'oauth' | 'adc' | null;
  user?: UserProfile;
  accounts?: ConnectedAccount[];
  activeAccountId?: string | null;
  error?: string;
}


export interface WorkspaceStats {
  driveFilesRecent: number;
  unreadEmails: number;
  upcomingEvents: number;
  openTasks: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  shared: boolean;
  size?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  subject: string;
  date: string;
  labelIds: string[];
  unread: boolean;
}

// ── Gmail Page types ────────────────────────────────────────────────

export interface DynamicToolItem {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  steps: { action: string; args: Record<string, string>; outputKey?: string }[];
  isWriteTool: boolean;
  createdAt: string;
  label?: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesUnread: number;
}

export interface GmailThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  unread: boolean;
  messageCount: number;
  hasAttachments: boolean;
  labelIds: string[];
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface GmailThreadMessage {
  id: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  body: string;
  bodyType: 'html' | 'text';
  attachments: GmailAttachment[];
}

export interface GmailThreadDetail {
  id: string;
  subject: string;
  messages: GmailThreadMessage[];
  labelIds: string[];
}

export interface InboxActionRequest {
  actionType: InboxActionType;
  threadIds?: string[];
  labelName?: string;
  sender?: string;
  subject?: string;
  archive?: boolean;
  markRead?: boolean;
  skipInbox?: boolean;
  conversationId?: string;
  messageId?: string;
  approvalSnapshot?: string;
}

export interface GmailThreadsResponse {
  threads: GmailThreadSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendeeCount: number;
  hangoutLink?: string;
  status: string;
}

export interface CalendarAttendee {
  email: string;
  name?: string;
  responseStatus: string;
}

export interface CalendarEventDetail {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: CalendarAttendee[];
  hangoutLink?: string;
  location?: string;
  description?: string;
  calendarId: string;
  calendarName: string;
  organizer?: {
    email: string;
    name?: string;
    self: boolean;
  };
  colorId?: string;
  status: string;
  recurring: boolean;
  recurringEventId?: string;
}

export interface Activity {
  type: 'drive' | 'gmail' | 'calendar' | 'tasks';
  title: string;
  subtitle: string;
  time: string;
  icon: string;
  url?: string;
}

// ── Briefing types ─────────────────────────────────────────────────

export interface AttentionItem {
  type: 'email_reply' | 'meeting_prep' | 'drive_file' | 'deadline' | 'followup';
  priority: 'high' | 'medium';
  title: string;
  description: string;
  action_label: string;
  action_context: string;
  feedback_target?: ImportanceFeedbackTarget;
  preference_score?: number;
  preference_reasons?: string[];
}

export interface SavedEmail {
  id: string;
  thread_id: string;
  subject: string;
  sender: string;
  saved_at: number;
  label: 'important' | 'not_important';
}

export interface FollowupItem {
  task_id: string;
  title: string;
  commitment: string;
  recipient: string;
  thread_id: string;
  subject: string;
  due: string;
  status: 'overdue' | 'due_today' | 'upcoming' | 'completed';
  days_overdue?: number;
}

export type TaskStatus = 'overdue' | 'due_today' | 'upcoming' | 'no_due_date' | 'completed';
export type TaskSource = 'flowspace_followup' | 'flowspace_task' | 'google_task';

export interface TaskItem {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  completedAt: string | null;
  status: TaskStatus;
  taskListId: string;
  taskListTitle: string;
  source: TaskSource;
  threadId?: string;
  recipient?: string;
  subject?: string;
  selfLink?: string;
  daysOverdue?: number;
}

export type EmailActionType =
  | 'draft_reply'
  | 'accept_meeting'
  | 'reject_meeting'
  | 'suggest_time'
  | 'create_task'
  | 'approve_request'
  | 'open_form'
  | 'add_to_calendar'
  | 'archive_threads'
  | 'mute_threads'
  | 'mark_read'
  | 'apply_label'
  | 'unsubscribe_sender'
  | 'create_filter';

export interface EmailAction {
  type: EmailActionType;
  label: string;
  detail?: string;
  context: Record<string, string>;
  needs_input?: string;
  conflict?: string;
}

export interface InboxTriageItem {
  subject: string;
  sender: string;
  thread_id?: string;
  summary?: string;
  message_ids?: string[];
  label_ids?: string[];
  reason?: string;
  sender_group?: string;
  undo_token?: string;
  urgency?: 'urgent_action' | 'needs_input' | 'review' | 'fyi';
  actions?: EmailAction[];
  feedback_target?: ImportanceFeedbackTarget;
  preference_score?: number;
  preference_reasons?: string[];
}

export interface ImportanceFeedbackRequest {
  target: ImportanceFeedbackTarget;
  label: PreferenceLabel;
}

export interface ImportanceFeedbackResponse {
  success: boolean;
  example: PreferenceExample;
}

export interface ImportancePreferencesResponse {
  preferences: PreferenceExample[];
}

export interface LinkedDoc {
  name: string;
  url: string;
  type: 'notes' | 'agenda' | 'shared_file';
}

export interface DayEvent {
  time: string;
  title: string;
  event_id: string;
  attendees: string[];
  has_notes_doc: boolean;
  prep_note: string | null;
  priority_group: 'needs_prep' | 'show_up' | 'fyi';
  linked_docs?: LinkedDoc[];
}

export type FallbackTriageResult = {
  needs_reply: InboxTriageItem[];
  needs_input: InboxTriageItem[];
  fyi_only: InboxTriageItem[];
  can_ignore: InboxTriageItem[];
};

export interface Briefing {
  greeting: string;
  summary: string;
  attention_items: AttentionItem[];
  inbox_triage: {
    needs_reply: InboxTriageItem[];
    needs_input: InboxTriageItem[];
    fyi_only: InboxTriageItem[];
    can_ignore: InboxTriageItem[];
  };
  day_at_a_glance: DayEvent[];
  followups?: FollowupItem[];
  error?: string;
}

export interface OriginalMessage {
  from: string;
  date: string;
  body: string;
}

export interface DraftReplyResponse {
  draft: string;
  subject: string;
  to: string;
  thread_id: string;
  original_messages?: OriginalMessage[];
}

export interface CreateDocResponse {
  success: boolean;
  docUrl: string;
  docId: string;
}

// ── Version types ───────────────────────────────────────────────────

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

// ── LLM settings types ──────────────────────────────────────────────

export interface LLMProviderConfigResponse {
  provider: string;
  apiKey: string;  // masked on GET
  model: string;
  baseURL?: string;
  name?: string;  // display name for custom providers
}

export interface LLMSettingsResponse {
  activeProvider: string;
  providers: Record<string, LLMProviderConfigResponse>;
}

export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ProviderMetaResponse {
  id: string;
  name: string;
  requiresKey: boolean;
  defaultBaseURL: string;
  models: ProviderModelOption[];
  keyPlaceholder: string;
  keyPrefix?: string;
  isCustom?: boolean;
}

export interface RunsResponse {
  runs: RunRecord[];
}

// ── API base URL ──────────────────────────────────────────────────
// In dev mode, the page is served from Express (http://localhost:3000)
// so relative URLs work. In Tauri production builds, the page is served
// from tauri://localhost (static files), so we must prefix API calls
// with the Express server origin.

const API_BASE = (() => {
  const origin = window.location.origin;
  // If served from Express (dev or browser), relative paths work fine
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    return '';
  }
  // Tauri production: page served from tauri:// or https://tauri.localhost
  // API calls must target the Express server explicitly
  return 'http://localhost:3000';
})();

// ── Fetch helper ───────────────────────────────────────────────────

interface FetchJSONOptions extends RequestInit {
  timeoutMs?: number;
}

async function fetchJSON<T>(url: string, opts?: FetchJSONOptions): Promise<T> {
  const { timeoutMs, signal, ...requestInit } = opts ?? {};
  const controller = new AbortController();
  const timeoutId = timeoutMs
    ? window.setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
    : undefined;

  const compositeSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${url}`, {
      ...requestInit,
      signal: compositeSignal,
    });
  } catch (error) {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError' && timeoutMs) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  if (timeoutId) window.clearTimeout(timeoutId);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function streamJSON(
  url: string,
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as ChatStreamEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ChatStreamEvent);
  }
}

// ── Public API ─────────────────────────────────────────────────────

export const api = {
  streamChat: (
    messages: ChatMessageInput[],
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
    metadata?: { conversationId?: string; sourceMessageId?: string; threadBrief?: string },
  ) =>
    streamJSON(
      '/api/chat/stream',
      {
        messages,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        conversationId: metadata?.conversationId,
        sourceMessageId: metadata?.sourceMessageId,
        threadBrief: metadata?.threadBrief,
      },
      onEvent,
      signal,
    ),

  approveChatAction: (approval: ApprovalRequest, onEvent: (event: ChatStreamEvent) => void, signal?: AbortSignal) =>
    streamJSON('/api/chat/approve', { approval }, onEvent, signal),

  getRuns: (params: { status?: RunStatus; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString();
    return fetchJSON<RunsResponse>(`/api/runs${qs ? `?${qs}` : ''}`);
  },

  getRun: (id: string) => fetchJSON<{ run: RunRecord }>(`/api/runs/${encodeURIComponent(id)}`),

  getRunSummary: (window = '24h') =>
    fetchJSON<{ summary: RunSummary }>(`/api/runs/summary?window=${encodeURIComponent(window)}`),

  sendChat: (messages: ChatMessageInput[], metadata?: { threadBrief?: string }) =>
    fetchJSON<AssistantPayload>('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, threadBrief: metadata?.threadBrief }),
    }),

  getAuthStatus: () => fetchJSON<AuthStatus>('/api/auth/status', { timeoutMs: 5000 }),

  getAccounts: () =>
    fetchJSON<{ accounts: ConnectedAccount[]; activeAccountId: string | null; activeAccount: ConnectedAccount | null }>('/api/accounts'),

  switchAccount: (accountId: string) =>
    fetchJSON<{ success: boolean; accounts: ConnectedAccount[]; activeAccountId: string | null }>('/api/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    }),

  removeAccount: (accountId: string) =>
    fetchJSON<{ success: boolean; accounts: ConnectedAccount[]; activeAccountId: string | null }>(`/api/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    }),

  getStats: () => fetchJSON<WorkspaceStats>('/api/stats'),

  getDriveRecent: (limit = 20) =>
    fetchJSON<{ files: DriveFile[] }>(`/api/drive/recent?limit=${limit}`),

  getGmailRecent: (limit = 10) =>
    fetchJSON<{ messages: GmailMessage[] }>(`/api/gmail/recent?limit=${limit}`),

  getCalendarUpcoming: (days = 7) =>
    fetchJSON<{ events: CalendarEvent[] }>(`/api/calendar/upcoming?days=${days}`),

  getCalendarRange: (start: string, end: string) =>
    fetchJSON<{ events: CalendarEventDetail[] }>(
      `/api/calendar/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    ),

  getActivityRecent: (limit = 15) =>
    fetchJSON<{ activities: Activity[] }>(`/api/activity/recent?limit=${limit}`),

  getBriefing: (refresh = false) => fetchJSON<Briefing>(`/api/briefing?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}${refresh ? '&refresh=true' : ''}`),

  aiTriage: (threads: GmailThreadSummary[]) =>
    fetchJSON<import('../lib/ai-triage').AITriageResult>('/api/ai-triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threads }),
    }),

  draftReply: (thread_id: string) =>
    fetchJSON<DraftReplyResponse>('/api/draft-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id }),
    }),

  sendReply: (data: { thread_id: string; to: string; subject: string; body: string }) =>
    fetchJSON<{ success: boolean; messageId: string }>('/api/send-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  sendEmail: (data: { to: string; subject: string; body: string }) =>
    fetchJSON<{ success: boolean; messageId: string }>('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  createDoc: (data: { title: string; date?: string; attendees?: string[]; event_id?: string; runId?: string; sourceMessageId?: string }) =>
    fetchJSON<CreateDocResponse>('/api/create-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  getFollowups: () =>
    fetchJSON<{ followups: FollowupItem[] }>('/api/followups'),

  completeFollowup: (taskId: string) =>
    fetchJSON<{ success: boolean }>(`/api/followups/${taskId}/complete`, {
      method: 'POST',
    }),

  snoozeFollowup: (taskId: string, due: string) =>
    fetchJSON<{ success: boolean }>(`/api/followups/${taskId}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due }),
    }),

  deleteFollowup: (taskId: string) =>
    fetchJSON<{ success: boolean }>(`/api/followups/${taskId}`, {
      method: 'DELETE',
    }),

  getTasks: () =>
    fetchJSON<{ tasks: TaskItem[] }>('/api/tasks'),

  completeTask: (taskId: string, taskListId: string) =>
    fetchJSON<{ success: boolean }>(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskListId }),
    }),

  reopenTask: (taskId: string, taskListId: string) =>
    fetchJSON<{ success: boolean }>(`/api/tasks/${taskId}/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskListId }),
    }),

  snoozeTask: (taskId: string, taskListId: string, due: string) =>
    fetchJSON<{ success: boolean }>(`/api/tasks/${taskId}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskListId, due }),
    }),

  logout: async () => {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    if (!res.ok) throw new Error('Logout failed');
    return res.json();
  },

  // ── LLM Settings ──────────────────────────────────────────────────

  getLLMSettings: () =>
    fetchJSON<{ settings: LLMSettingsResponse | null; configured: boolean }>('/api/settings/llm'),

  updateLLMSettings: (settings: LLMSettingsResponse) =>
    fetchJSON<{ success: boolean; settings: LLMSettingsResponse }>('/api/settings/llm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  testLLMProvider: (config: { provider: string; apiKey: string; model: string; baseURL?: string }) =>
    fetchJSON<{ success: boolean; error?: string }>('/api/settings/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),

  getLLMProviders: () =>
    fetchJSON<{ providers: ProviderMetaResponse[] }>('/api/settings/llm/providers'),

  deleteLLMProvider: (providerId: string) =>
    fetchJSON<{ success: boolean; settings: LLMSettingsResponse }>(`/api/settings/llm/providers/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    }),

  // ── Codex CLI ────────────────────────────────────────────────────
  getCodexStatus: () =>
    fetchJSON<{ installed: boolean; authenticated: boolean }>('/api/codex/status'),

  pollCodexLogin: () =>
    fetchJSON<{ authenticated: boolean; reason?: string }>('/api/codex/login/poll'),

  // ── Version ──────────────────────────────────────────────────────
  getVersion: () => fetchJSON<VersionInfo>('/api/version'),

  // ── Gmail Page ──────────────────────────────────────────────────

  getGmailLabels: () =>
    fetchJSON<{ labels: GmailLabel[] }>('/api/gmail/labels'),

  getGmailThreads: (params: { pageToken?: string; label?: string; q?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.pageToken) search.set('pageToken', params.pageToken);
    if (params.label) search.set('label', params.label);
    if (params.q) search.set('q', params.q);
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString();
    return fetchJSON<GmailThreadsResponse>(`/api/gmail/threads${qs ? `?${qs}` : ''}`);
  },

  getGmailThread: (threadId: string) =>
    fetchJSON<GmailThreadDetail>(`/api/gmail/thread/${encodeURIComponent(threadId)}`),

  markThreadRead: (threadId: string) =>
    fetchJSON<{ success: boolean }>(`/api/gmail/thread/${encodeURIComponent(threadId)}/read`, { method: 'POST' }),

  archiveThread: (threadId: string) =>
    fetchJSON<{ success: boolean }>(`/api/gmail/thread/${encodeURIComponent(threadId)}/archive`, { method: 'POST' }),

  trashThread: (threadId: string) =>
    fetchJSON<{ success: boolean }>(`/api/gmail/thread/${encodeURIComponent(threadId)}/trash`, { method: 'POST' }),

  performInboxAction: (request: InboxActionRequest) =>
    fetchJSON<InboxActionResult>('/api/inbox-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),

  undoInboxAction: (auditId: string) =>
    fetchJSON<InboxActionResult>(`/api/inbox-actions/${encodeURIComponent(auditId)}/undo`, {
      method: 'POST',
    }),

  getInboxActionHistory: () =>
    fetchJSON<{ actions: InboxActionAuditRecord[] }>('/api/inbox-actions/recent'),

  // Quick Actions
  getQuickActions: () =>
    fetchJSON<{ actions: { label: string; prompt: string }[] | null }>('/api/quick-actions'),

  saveQuickActions: (actions: { label: string; prompt: string }[]) =>
    fetchJSON<{ success: boolean; actions: { label: string; prompt: string }[] }>('/api/quick-actions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    }),

  // Persona
  getPersona: () =>
    fetchJSON<{ persona: import('../lib/persona').Persona | null }>('/api/persona'),

  savePersona: (persona: import('../lib/persona').Persona) =>
    fetchJSON<{ success: boolean; persona: import('../lib/persona').Persona }>('/api/persona', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona }),
    }),

  getImportancePreferences: () =>
    fetchJSON<ImportancePreferencesResponse>('/api/importance-preferences'),

  saveImportanceFeedback: (request: ImportanceFeedbackRequest) =>
    fetchJSON<ImportanceFeedbackResponse>('/api/importance-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),

  getSavedEmails: () =>
    fetchJSON<{ savedEmails: SavedEmail[] }>('/api/saved-emails'),

  unsaveEmail: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/saved-emails/${id}`, { method: 'DELETE' }),

  getDynamicTools: () =>
    fetchJSON<{ tools: DynamicToolItem[] }>('/api/dynamic-tools'),

  getDynamicToolActions: () =>
    fetchJSON<{ actions: string[] }>('/api/dynamic-tools/actions'),

  createDynamicTool: (tool: Omit<DynamicToolItem, 'createdAt'>) =>
    fetchJSON<{ tool: DynamicToolItem }>('/api/dynamic-tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tool),
    }),

  updateDynamicTool: (name: string, updates: Partial<Omit<DynamicToolItem, 'name' | 'createdAt'>>) =>
    fetchJSON<{ tool: DynamicToolItem }>(`/api/dynamic-tools/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }),

  deleteDynamicTool: (name: string) =>
    fetchJSON<{ removed: boolean; name: string }>(`/api/dynamic-tools/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
};
