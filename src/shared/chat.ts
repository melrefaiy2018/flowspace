export type { ConversationIndexEntry, ConversationIndex, ConversationOrigin, ConversationUpdate } from '../agent/conversation-index.js';
export type { ConversationSummary, ConversationSummaryStore, SummarySections } from '../agent/conversation-summary.js';

export interface StructuredThreadBrief {
  type: 'meeting_prep' | 'email_thread' | 'task' | 'general';
  entityId?: string;
  summary: string;
  context?: Record<string, string>;
}

const STRUCTURED_BRIEF_TYPES = new Set<StructuredThreadBrief['type']>([
  'meeting_prep',
  'email_thread',
  'task',
  'general',
]);

export function parseThreadBrief(raw: string | undefined): StructuredThreadBrief | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.type === 'string' &&
      STRUCTURED_BRIEF_TYPES.has(parsed.type) &&
      typeof parsed.summary === 'string'
    ) {
      return parsed as StructuredThreadBrief;
    }
  } catch {
    // not JSON — fall through to legacy handling
  }
  // Legacy string or malformed JSON → treat the whole raw value as a general summary.
  return { type: 'general', summary: raw };
}

export type ToolEventStatus = 'pending' | 'running' | 'completed' | 'error' | 'approval_required';
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'canceled';

export interface ToolEvent {
  id: string;
  toolName: string;
  label: string;
  detail?: string;
  status: ToolEventStatus;
}

export interface ResultListItem {
  title: string;
  subtitle?: string;
  meta?: string;
  url?: string;
}

export interface FactItem {
  label: string;
  value: string;
}

export interface AgendaEvent {
  time: string;
  title: string;
  attendees?: string[];
  prep_note?: string | null;
  linked_docs?: { name: string; url: string; type: string }[];
  url?: string;
}

export interface TriageItem {
  subject: string;
  sender: string;
  summary?: string;
  thread_id?: string;
  message_ids?: string[];
  label_ids?: string[];
  reason?: string;
  sender_group?: string;
  undo_token?: string;
  urgency?: 'urgent_action' | 'needs_input' | 'review' | 'fyi';
  actions?: { type: string; label: string; detail?: string; context: Record<string, string>; needs_input?: string; conflict?: string }[];
}

export type InboxActionType =
  | 'archive_threads'
  | 'trash_threads'
  | 'restore_threads'
  | 'untrash_threads'
  | 'mark_read'
  | 'mark_unread'
  | 'mute_threads'
  | 'unmute_threads'
  | 'apply_label'
  | 'remove_label'
  | 'unsubscribe_sender'
  | 'create_filter';

export interface InboxActionResultItem {
  thread_id: string;
  subject: string;
  sender: string;
  status: 'completed' | 'failed' | 'noop';
  error?: string;
  reason?: string;
}

export interface InboxActionResult {
  action_type: InboxActionType;
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  items: InboxActionResultItem[];
  undo_available: boolean;
  audit_id?: string;
  undo_expires_at?: number;
  message?: string;
}

export interface BulkActionPreviewItem {
  thread_id: string;
  sender: string;
  subject: string;
  reason?: string;
  effect?: string;
  status?: 'pending' | 'completed' | 'failed' | 'noop';
  error?: string;
}

export interface InboxActionAuditRecord {
  audit_id: string;
  conversation_id?: string;
  message_id?: string;
  action_type: InboxActionType;
  initiated_at: number;
  thread_ids: string[];
  approval_snapshot: string;
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  undo_available: boolean;
  undo_expires_at?: number;
  undone_at?: number;
  result_items: InboxActionResultItem[];
}

export interface SheetData {
  headers: string[];
  rows: string[][];
}

export interface EmailDraftData {
  to: string;
  subject: string;
  body: string;
  thread_id?: string;
}

export type AssistantBlock =
  | {
      type: 'status';
      title: string;
      body: string;
    }
  | {
      type: 'fact_list';
      title: string;
      items: FactItem[];
    }
  | {
      type: 'file_list' | 'email_list' | 'event_list' | 'task_list';
      title: string;
      items: ResultListItem[];
    }
  | {
      type: 'agenda';
      title: string;
      items: AgendaEvent[];
    }
  | {
      type: 'triage';
      title: string;
      data: { action_required: TriageItem[]; review: TriageItem[]; low_priority: TriageItem[] };
    }
  | {
      type: 'bulk_action_preview';
      title: string;
      actionType: InboxActionType;
      effect: string;
      items: BulkActionPreviewItem[];
      auditId?: string;
      undoAvailable?: boolean;
      undoExpiresAt?: number;
    }
  | {
      type: 'sheet_data';
      title: string;
      data: SheetData;
    }
  | {
      type: 'email_draft';
      title: string;
      data: EmailDraftData;
    };

export interface ApprovalField {
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  runId?: string;
  sourceMessageId?: string;
  title: string;
  summary: string;
  confirmLabel: string;
  fields: ApprovalField[];
  beforePreview?: Record<string, string>;
  afterPreview?: Record<string, string>;
  /** Original tool args preserved for tools that don't use editable fields (e.g. dynamic tools). */
  toolArgs?: Record<string, unknown>;
}

export interface RunRecord {
  id: string;
  conversationId?: string;
  objective: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  toolTotal: number;
  toolCompleted: number;
  approvalPendingCount: number;
  errorCode?: 'auth_expired' | 'rate_limited' | 'tool_timeout' | 'validation_failed' | 'context_overflow' | 'unknown';
  errorMessage?: string;
  sourceApps: string[];
  messageId?: string;
}

export interface RunSummary {
  activeCount: number;
  awaitingApprovalCount: number;
  completed24h: number;
  failed24h: number;
  medianDurationMs: number;
}

export interface AssistantPayload {
  content: string;
  blocks: AssistantBlock[];
  toolEvents: ToolEvent[];
  approval?: ApprovalRequest;
  suggestions?: string[];
  memoriesUsed?: { id: string; content: string; category: string }[];
  threadBriefSuggestion?: string;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatStreamEvent =
  | { type: 'assistant_begin' }
  | { type: 'assistant_chunk'; chunk: string }
  | { type: 'tool_event'; event: ToolEvent }
  | { type: 'run_started'; run: RunRecord }
  | { type: 'run_progress'; run: RunRecord }
  | { type: 'run_status_changed'; run: RunRecord }
  | { type: 'run_completed'; run: RunRecord }
  | { type: 'run_failed'; run: RunRecord }
  | { type: 'assistant_complete'; payload: AssistantPayload }
  | { type: 'navigate'; view: string; tab?: string; refresh?: boolean }
  | { type: 'assistant_aborted' }
  | { type: 'assistant_error'; error: string };
