import fs from 'fs';
import path from 'path';
import type { InboxActionAuditRecord, InboxActionResult, InboxActionResultItem, InboxActionType } from '../shared/chat.js';

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

interface InboxActionLogState {
  records: InboxActionAuditRecord[];
}

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

// Per-path write queue to serialize read-modify-write operations and prevent concurrent races.
// Each write chains onto the previous pending write for the same path so they execute in order.
const logLocks = new Map<string, Promise<unknown>>();

function withLogLock<T>(logPath: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = logLocks.get(logPath) ?? Promise.resolve();
  // Always run `fn` regardless of whether the previous write succeeded or failed,
  // so a single write error does not permanently jam the queue for this path.
  const next = prev.then(() => fn(), () => fn());
  // Store only the settled fence (errors from `fn` are returned to each caller via `next`).
  logLocks.set(logPath, next.catch(() => {}));
  return next as Promise<T>;
}

function readLog(logPath: string): InboxActionLogState {
  try {
    if (fs.existsSync(logPath)) {
      const raw = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      if (Array.isArray(raw?.records)) return { records: raw.records };
    }
  } catch {
    // Fall through to empty log.
  }
  return { records: [] };
}

function writeLog(logPath: string, state: InboxActionLogState) {
  fs.writeFileSync(logPath, JSON.stringify(state, null, 2));
}

function normalizeThreadIds(threadIds?: string[]): string[] {
  return [...new Set((threadIds ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function threadErrorItem(threadId: string, error: unknown): InboxActionResultItem {
  const message = error instanceof Error ? error.message : String(error || 'Action failed');
  return {
    thread_id: threadId,
    subject: '(unknown subject)',
    sender: '(unknown sender)',
    status: 'failed',
    error: message,
  };
}

async function getThreadSummary(gmail: any, threadId: string): Promise<{ thread_id: string; subject: string; sender: string }> {
  const { data } = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['From', 'Subject'],
  });
  const messages = data.messages ?? [];
  const firstHeaders = messages[0]?.payload?.headers ?? [];
  const lastHeaders = messages[messages.length - 1]?.payload?.headers ?? [];
  const subject = firstHeaders.find((h: any) => h.name?.toLowerCase() === 'subject')?.value ?? '(no subject)';
  const sender = lastHeaders.find((h: any) => h.name?.toLowerCase() === 'from')?.value ?? '(unknown sender)';
  return { thread_id: threadId, subject, sender };
}

async function resolveOrCreateLabelId(gmail: any, labelName: string): Promise<string> {
  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const existing = (labelsRes.data.labels ?? []).find((label: any) => label.name?.toLowerCase() === labelName.toLowerCase());
  if (existing?.id) return existing.id;

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  if (!created.data.id) throw new Error(`Failed to create label "${labelName}"`);
  return created.data.id;
}

async function modifyThreadLabels(gmail: any, threadId: string, requestBody: { addLabelIds?: string[]; removeLabelIds?: string[] }) {
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody,
  });
}

function buildAuditRecord(result: InboxActionResult, request: InboxActionRequest): InboxActionAuditRecord {
  return {
    audit_id: result.audit_id!,
    conversation_id: request.conversationId,
    message_id: request.messageId,
    action_type: request.actionType,
    initiated_at: Date.now(),
    thread_ids: normalizeThreadIds(request.threadIds),
    approval_snapshot: request.approvalSnapshot ?? '',
    requested_count: result.requested_count,
    succeeded_count: result.succeeded_count,
    failed_count: result.failed_count,
    undo_available: result.undo_available,
    undo_expires_at: result.undo_expires_at,
    result_items: result.items,
  };
}

function appendAuditRecord(logPath: string, record: InboxActionAuditRecord): Promise<void> {
  return withLogLock(logPath, () => {
    const state = readLog(logPath);
    state.records = [record, ...state.records].slice(0, 200);
    writeLog(logPath, state);
  });
}

export function listInboxActionHistory(logPath: string): InboxActionAuditRecord[] {
  return readLog(logPath).records;
}

export async function executeInboxAction(
  gmail: any,
  logPath: string,
  request: InboxActionRequest,
): Promise<InboxActionResult> {
  const threadIds = normalizeThreadIds(request.threadIds);
  const items: InboxActionResultItem[] = [];
  let undoAvailable = false;

  const executePerThread = async (
    updater: (threadId: string) => Promise<void>,
    reason?: string,
  ) => {
    for (const threadId of threadIds) {
      try {
        const summary = await getThreadSummary(gmail, threadId);
        await updater(threadId);
        items.push({ ...summary, status: 'completed', reason });
      } catch (error) {
        items.push(threadErrorItem(threadId, error));
      }
    }
  };

  switch (request.actionType) {
    case 'archive_threads':
      undoAvailable = true;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { removeLabelIds: ['INBOX'] }),
        'Removed from Inbox; thread remains in All Mail.',
      );
      break;
    case 'trash_threads':
      undoAvailable = true;
      await executePerThread(
        async (threadId) => {
          await gmail.users.threads.trash({
            userId: 'me',
            id: threadId,
          });
        },
        'Moved thread to Gmail Trash.',
      );
      break;
    case 'restore_threads':
      undoAvailable = false;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { addLabelIds: ['INBOX'] }),
        'Returned to Inbox.',
      );
      break;
    case 'untrash_threads':
      undoAvailable = false;
      await executePerThread(
        async (threadId) => {
          await gmail.users.threads.untrash({
            userId: 'me',
            id: threadId,
          });
        },
        'Removed thread from Gmail Trash.',
      );
      break;
    case 'mute_threads':
      undoAvailable = true;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { addLabelIds: ['MUTED'] }),
        'Muted future replies in this thread.',
      );
      break;
    case 'unmute_threads':
      undoAvailable = false;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { removeLabelIds: ['MUTED'] }),
        'Unmuted the thread.',
      );
      break;
    case 'mark_read':
      undoAvailable = true;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { removeLabelIds: ['UNREAD'] }),
        'Marked thread as read.',
      );
      break;
    case 'mark_unread':
      undoAvailable = false;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { addLabelIds: ['UNREAD'] }),
        'Marked thread as unread.',
      );
      break;
    case 'apply_label': {
      if (!request.labelName?.trim()) throw new Error('labelName is required for apply_label.');
      const labelId = await resolveOrCreateLabelId(gmail, request.labelName.trim());
      undoAvailable = true;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { addLabelIds: [labelId] }),
        `Applied label "${request.labelName.trim()}".`,
      );
      break;
    }
    case 'remove_label': {
      if (!request.labelName?.trim()) throw new Error('labelName is required for remove_label.');
      const labelId = await resolveOrCreateLabelId(gmail, request.labelName.trim());
      undoAvailable = false;
      await executePerThread(
        (threadId) => modifyThreadLabels(gmail, threadId, { removeLabelIds: [labelId] }),
        `Removed label "${request.labelName.trim()}".`,
      );
      break;
    }
    case 'unsubscribe_sender': {
      const sourceThreadId = threadIds[0];
      if (!sourceThreadId) throw new Error('threadIds is required for unsubscribe_sender.');
      const summary = await getThreadSummary(gmail, sourceThreadId);
      const { data } = await gmail.users.threads.get({
        userId: 'me',
        id: sourceThreadId,
        format: 'metadata',
        metadataHeaders: ['List-Unsubscribe'],
      });
      const header = data.messages?.[0]?.payload?.headers?.find((h: any) => h.name?.toLowerCase() === 'list-unsubscribe')?.value;
      items.push({
        ...summary,
        status: 'noop',
        reason: header
          ? `List-Unsubscribe is available for ${summary.sender}, but FlowSpace does not auto-follow external unsubscribe links.`
          : `No List-Unsubscribe header was found for ${summary.sender}.`,
      });
      break;
    }
    case 'create_filter': {
      const from = request.sender?.trim();
      const subject = request.subject?.trim();
      if (!from && !subject) throw new Error('sender or subject is required for create_filter.');
      const action: Record<string, unknown> = {};
      if (request.archive || request.skipInbox) action.removeLabelIds = ['INBOX'];
      if (request.markRead) action.removeLabelIds = [...new Set([...(Array.isArray(action.removeLabelIds) ? action.removeLabelIds as string[] : []), 'UNREAD'])];
      if (request.labelName?.trim()) {
        const labelId = await resolveOrCreateLabelId(gmail, request.labelName.trim());
        action.addLabelIds = [labelId];
      }
      await gmail.users.settings.filters.create({
        userId: 'me',
        requestBody: {
          criteria: {
            from: from || undefined,
            query: subject ? `subject:${subject}` : undefined,
          },
          action,
        },
      });
      items.push({
        thread_id: threadIds[0] ?? `filter:${Date.now()}`,
        subject: subject || '(sender filter)',
        sender: from || '(mixed senders)',
        status: 'completed',
        reason: 'Created a Gmail filter.',
      });
      break;
    }
    default:
      throw new Error(`Unsupported inbox action: ${request.actionType}`);
  }

  const requestedCount = request.actionType === 'create_filter' ? 1 : threadIds.length;
  const succeededCount = items.filter((item) => item.status === 'completed').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const auditId = `${request.actionType}_${Date.now()}`;
  const result: InboxActionResult = {
    action_type: request.actionType,
    requested_count: requestedCount,
    succeeded_count: succeededCount,
    failed_count: failedCount,
    items,
    undo_available: undoAvailable && succeededCount > 0,
    undo_expires_at: undoAvailable && succeededCount > 0 ? Date.now() + UNDO_WINDOW_MS : undefined,
    audit_id: auditId,
    message: failedCount > 0
      ? `Completed ${succeededCount} of ${requestedCount} requested actions.`
      : succeededCount > 0
        ? `Completed ${succeededCount} action${succeededCount === 1 ? '' : 's'}.`
        : 'No inbox changes were applied.',
  };

  await appendAuditRecord(logPath, buildAuditRecord(result, request));
  return result;
}

export async function undoInboxAction(gmail: any, logPath: string, auditId: string): Promise<InboxActionResult> {
  const state = readLog(logPath);
  const record = state.records.find((item) => item.audit_id === auditId);
  if (!record) throw new Error('Action history record not found.');
  if (!record.undo_available) throw new Error('This inbox action cannot be undone.');
  if (record.undone_at) throw new Error('This inbox action was already undone.');
  if (record.undo_expires_at && Date.now() > record.undo_expires_at) throw new Error('Undo period has expired for this inbox action.');

  let actionType: InboxActionType;
  let labelName: string | undefined;
  switch (record.action_type) {
    case 'archive_threads':
      actionType = 'restore_threads';
      break;
    case 'trash_threads':
      actionType = 'untrash_threads';
      break;
    case 'mute_threads':
      actionType = 'unmute_threads';
      break;
    case 'mark_read':
      actionType = 'mark_unread';
      labelName = 'UNREAD';
      break;
    case 'apply_label':
      actionType = 'remove_label';
      break;
    default:
      throw new Error('Undo is not supported for this inbox action.');
  }

  const completedItems = record.result_items.filter((item) => item.status === 'completed');
  const threadIds = completedItems.map((item) => item.thread_id);
  const items: InboxActionResultItem[] = [];

  for (const threadId of threadIds) {
    try {
      const summary = await getThreadSummary(gmail, threadId);
      if (record.action_type === 'archive_threads') {
        await modifyThreadLabels(gmail, threadId, { addLabelIds: ['INBOX'] });
      } else if (record.action_type === 'trash_threads') {
        await gmail.users.threads.untrash({
          userId: 'me',
          id: threadId,
        });
      } else if (record.action_type === 'mute_threads') {
        await modifyThreadLabels(gmail, threadId, { removeLabelIds: ['MUTED'] });
      } else if (record.action_type === 'mark_read') {
        await modifyThreadLabels(gmail, threadId, { addLabelIds: ['UNREAD'] });
      } else if (record.action_type === 'apply_label') {
        if (!labelName) {
          const targetReason = completedItems.find((item) => item.thread_id === threadId)?.reason ?? '';
          const parsedLabel = targetReason.match(/"(.+?)"/)?.[1];
          if (parsedLabel) labelName = parsedLabel;
        }
        if (!labelName) throw new Error('Could not resolve label to remove for undo.');
        const labelId = await resolveOrCreateLabelId(gmail, labelName);
        await modifyThreadLabels(gmail, threadId, { removeLabelIds: [labelId] });
      }
      items.push({ ...summary, status: 'completed', reason: 'Undo applied.' });
    } catch (error) {
      items.push(threadErrorItem(threadId, error));
    }
  }

  await withLogLock(logPath, () => {
    const freshState = readLog(logPath);
    const freshRecord = freshState.records.find((r) => r.audit_id === auditId);
    if (!freshRecord) throw new Error('Action history record not found.');
    if (freshRecord.undone_at) throw new Error('This inbox action was already undone.');
    freshRecord.undone_at = Date.now();
    writeLog(logPath, freshState);
  });

  return {
    action_type: actionType,
    requested_count: threadIds.length,
    succeeded_count: items.filter((item) => item.status === 'completed').length,
    failed_count: items.filter((item) => item.status === 'failed').length,
    items,
    undo_available: false,
    audit_id: auditId,
    message: 'Undo completed.',
  };
}
