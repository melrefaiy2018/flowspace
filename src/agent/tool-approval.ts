/**
 * tool-approval.ts
 *
 * Approval request builders and tool-result-to-block renderers.
 *
 * - buildApprovalRequest()      — creates the ApprovalRequest shown to the user
 *                                 before a write tool executes.
 * - buildBlocksFromToolResult() — re-exported from tool-result-renderer.ts.
 */

import type {
  ApprovalRequest,
  InboxActionType,
} from '../shared/chat.js';
import { getDynamicTool } from './dynamic-tool-registry.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Decode common HTML entities without a full HTML parser. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** Format an RFC 2822 or ISO date string to a concise human-readable form. */
export function formatDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function parseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function headerValue(headers: any[] | undefined, name: string): string {
  return headers?.find((header) => header?.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function getInboxActionsBaseUrl(): string {
  // Prefer an explicit configuration if available.
  if (typeof process !== 'undefined' && (process as any).env && (process as any).env.INBOX_ACTIONS_BASE_URL) {
    return (process as any).env.INBOX_ACTIONS_BASE_URL as string;
  }

  // Match the frontend API client: only browser dev origins should use relative URLs.
  if (typeof globalThis !== 'undefined' && (globalThis as any).location && (globalThis as any).location.origin) {
    const origin = (globalThis as any).location.origin as string;
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return '';
    }
  }

  // Tauri/static builds must target the local Express server explicitly.
  return 'http://localhost:3000';
}

// ── Approval-specific helpers ─────────────────────────────────────────────────

export function normalizeThreadIds(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

export function summarizeInboxActionEffect(actionType: InboxActionType, labelName?: string): string {
  switch (actionType) {
    case 'archive_threads': return 'Remove INBOX label; thread remains in All Mail.';
    case 'trash_threads': return 'Move thread to Gmail Trash.';
    case 'restore_threads': return 'Add INBOX label back to the thread.';
    case 'untrash_threads': return 'Remove thread from Gmail Trash.';
    case 'mark_read': return 'Remove UNREAD label from the thread.';
    case 'mark_unread': return 'Add UNREAD label back to the thread.';
    case 'mute_threads': return 'Mute future replies in the selected thread(s).';
    case 'unmute_threads': return 'Remove the MUTED label from the thread.';
    case 'apply_label': return labelName ? `Apply label "${labelName}".` : 'Apply the requested Gmail label.';
    case 'remove_label': return labelName ? `Remove label "${labelName}".` : 'Remove the requested Gmail label.';
    case 'unsubscribe_sender': return 'Attempt a safe best-effort unsubscribe when List-Unsubscribe metadata is available.';
    case 'create_filter': return 'Create a Gmail filter using sender/subject criteria.';
  }
}

function parsePreviewItems(input: unknown): Array<{ thread_id: string; sender: string; subject: string; reason?: string }> {
  if (typeof input !== 'string' || !input.trim()) return [];
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        thread_id: String(item?.thread_id ?? '').trim(),
        sender: String(item?.sender ?? '').trim(),
        subject: String(item?.subject ?? '').trim(),
        reason: item?.reason ? String(item.reason) : undefined,
      }))
      .filter((item) => item.thread_id);
  } catch {
    return [];
  }
}

// ── buildApprovalRequest ──────────────────────────────────────────────────────

export function buildApprovalRequest(toolName: string, args: Record<string, any>): ApprovalRequest {
  const base = {
    id: `${toolName}:${Date.now()}`,
    toolName,
    confirmLabel: 'Approve action',
  };

  switch (toolName) {
    case 'send_email':
      return {
        ...base,
        title: 'Approve email send',
        summary: 'Review the recipient, subject, and message body before FlowSpace sends this email.',
        beforePreview: { status: 'No outbound email sent yet' },
        afterPreview: {
          to: String(args.to ?? ''),
          subject: String(args.subject ?? ''),
          body: String(args.body ?? ''),
        },
        fields: [
          { key: 'to', label: 'To', value: String(args.to ?? ''), placeholder: 'name@example.com' },
          { key: 'subject', label: 'Subject', value: String(args.subject ?? ''), placeholder: 'Subject' },
          { key: 'body', label: 'Body', value: String(args.body ?? ''), multiline: true, placeholder: 'Email body' },
        ],
      };
    case 'create_calendar_event':
      return {
        ...base,
        title: 'Approve calendar event',
        summary: 'Confirm the title, timing, attendees, and notes before creating this event.',
        beforePreview: { status: 'Event does not exist yet' },
        afterPreview: {
          summary: String(args.summary ?? ''),
          start_time: String(args.start_time ?? ''),
          end_time: String(args.end_time ?? ''),
        },
        fields: [
          { key: 'summary', label: 'Title', value: String(args.summary ?? ''), placeholder: 'Event title' },
          { key: 'start_time', label: 'Start', value: String(args.start_time ?? ''), placeholder: '2026-03-10T14:00:00-06:00' },
          { key: 'end_time', label: 'End', value: String(args.end_time ?? ''), placeholder: '2026-03-10T14:30:00-06:00' },
          { key: 'attendees', label: 'Attendees', value: String(args.attendees ?? ''), placeholder: 'name@example.com, team@example.com' },
          { key: 'location', label: 'Location', value: String(args.location ?? ''), placeholder: 'Conference room / link' },
          { key: 'description', label: 'Description', value: String(args.description ?? ''), multiline: true, placeholder: 'Agenda or notes' },
        ],
      };
    case 'create_task':
      return {
        ...base,
        title: 'Approve task creation',
        summary: 'Confirm the task details before adding it to Google Tasks.',
        beforePreview: { status: 'Task does not exist yet' },
        afterPreview: {
          title: String(args.title ?? ''),
          due: String(args.due ?? ''),
          notes: String(args.notes ?? ''),
        },
        fields: [
          { key: 'title', label: 'Title', value: String(args.title ?? ''), placeholder: 'Task title' },
          { key: 'due', label: 'Due', value: String(args.due ?? ''), placeholder: '2026-03-10T00:00:00Z' },
          { key: 'notes', label: 'Notes', value: String(args.notes ?? ''), multiline: true, placeholder: 'Task notes' },
        ],
      };
    case 'create_drive_folder':
      return {
        ...base,
        title: 'Approve folder creation',
        summary: 'Confirm the folder details before creating it in Google Drive.',
        beforePreview: { status: 'Folder does not exist yet' },
        afterPreview: {
          name: String(args.name ?? ''),
          parent_id: String(args.parent_id ?? ''),
        },
        fields: [
          { key: 'name', label: 'Folder name', value: String(args.name ?? ''), placeholder: 'Folder name' },
          { key: 'parent_id', label: 'Parent folder ID', value: String(args.parent_id ?? ''), placeholder: 'Optional parent folder ID' },
        ],
      };
    case 'docs_write':
      return {
        ...base,
        title: 'Approve document edit',
        summary: 'Review the content before writing to the Google Doc.',
        beforePreview: { status: 'Document unchanged' },
        afterPreview: {
          doc_id: String(args.doc_id ?? ''),
          mode: String(args.mode ?? 'append'),
          content: String(args.content ?? ''),
        },
        fields: [
          { key: 'doc_id', label: 'Doc ID', value: String(args.doc_id ?? ''), placeholder: 'Google Doc ID' },
          { key: 'content', label: 'Content', value: String(args.content ?? ''), multiline: true, placeholder: 'Content to write' },
          { key: 'mode', label: 'Mode', value: 'append', placeholder: 'append (read-only)' },
        ],
      };
    case 'sheets_append':
      return {
        ...base,
        title: 'Approve spreadsheet update',
        summary: 'Review the data before appending rows to the spreadsheet.',
        beforePreview: { status: 'Rows not appended yet' },
        afterPreview: {
          spreadsheet_id: String(args.spreadsheet_id ?? ''),
          range: String(args.range ?? ''),
          values: String(args.values ?? '[]'),
        },
        fields: [
          { key: 'spreadsheet_id', label: 'Spreadsheet ID', value: String(args.spreadsheet_id ?? ''), placeholder: 'Spreadsheet ID' },
          { key: 'range', label: 'Range', value: String(args.range ?? ''), placeholder: 'Sheet1!A1' },
          { key: 'values', label: 'Values (JSON)', value: String(args.values ?? '[]'), multiline: true, placeholder: '[["A", "B"], ["C", "D"]]' },
        ],
      };
    case 'sheets_create':
      return {
        ...base,
        title: 'Approve new spreadsheet',
        summary: 'Review the title and optional initial data before creating the spreadsheet.',
        beforePreview: { status: 'Spreadsheet not created yet' },
        afterPreview: {
          title: String(args.title ?? ''),
          values: String(args.values ?? ''),
        },
        fields: [
          { key: 'title', label: 'Title', value: String(args.title ?? ''), placeholder: 'Spreadsheet title' },
          { key: 'values', label: 'Initial data (JSON)', value: String(args.values ?? ''), multiline: true, placeholder: '[["Header1", "Header2"], ["Row1A", "Row1B"]]' },
        ],
      };
    case 'sheets_update':
      return {
        ...base,
        title: 'Approve spreadsheet edit',
        summary: 'Review the data before writing to the spreadsheet.',
        beforePreview: { status: 'Cells not updated yet' },
        afterPreview: {
          spreadsheet_id: String(args.spreadsheet_id ?? ''),
          range: String(args.range ?? ''),
          values: String(args.values ?? '[]'),
        },
        fields: [
          { key: 'spreadsheet_id', label: 'Spreadsheet ID', value: String(args.spreadsheet_id ?? ''), placeholder: 'Spreadsheet ID' },
          { key: 'range', label: 'Range', value: String(args.range ?? ''), placeholder: 'Sheet1!A1:C3' },
          { key: 'values', label: 'Values (JSON)', value: String(args.values ?? '[]'), multiline: true, placeholder: '[["A", "B"], ["C", "D"]]' },
        ],
      };
    case 'drive_upload':
      return {
        ...base,
        title: 'Approve file upload',
        summary: 'Confirm the file details before uploading to Google Drive.',
        beforePreview: { status: 'File not uploaded yet' },
        afterPreview: {
          file_path: String(args.file_path ?? ''),
          parent_id: String(args.parent_id ?? ''),
        },
        fields: [
          { key: 'file_path', label: 'File path', value: String(args.file_path ?? ''), placeholder: 'Path to file' },
          { key: 'parent_id', label: 'Parent folder ID', value: String(args.parent_id ?? ''), placeholder: 'Optional parent folder ID' },
        ],
      };
    case 'save_email_to_doc':
      return {
        ...base,
        title: 'Approve email-to-doc conversion',
        summary: 'This will save the email thread as a Google Doc.',
        beforePreview: { status: 'Thread not saved as doc yet' },
        afterPreview: {
          thread_id: String(args.thread_id ?? ''),
        },
        fields: [
          { key: 'thread_id', label: 'Thread ID', value: String(args.thread_id ?? ''), placeholder: 'Gmail thread ID' },
        ],
      };
    case 'archive_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      const count = threadIds.length;
      const previewItems = parsePreviewItems(args.preview_items);
      return {
        ...base,
        title: 'Approve email archive',
        summary: count === 1
          ? 'This will archive 1 Gmail thread by removing it from the inbox.'
          : `This will archive ${count} Gmail threads by removing them from the inbox.`,
        beforePreview: { status: 'Threads still in inbox' },
        afterPreview: {
          threads: String(count),
          effect: summarizeInboxActionEffect('archive_threads'),
          items: previewItems.slice(0, 5).map((item) => `${item.sender} - ${item.subject}`).join('\n') || 'Thread IDs only',
        },
        fields: [
          {
            key: 'thread_ids',
            label: 'Thread IDs',
            value: threadIds.join(', '),
            multiline: count > 2,
            placeholder: 'thread-id-1, thread-id-2',
          },
          {
            key: 'preview_items',
            label: 'Preview items (JSON)',
            value: typeof args.preview_items === 'string' ? args.preview_items : '',
            multiline: true,
            placeholder: '[{"thread_id":"abc","sender":"Sender","subject":"Subject"}]',
          },
        ],
      };
    }
    case 'trash_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      const count = threadIds.length;
      const previewItems = parsePreviewItems(args.preview_items);
      return {
        ...base,
        title: 'Approve email trash',
        summary: count === 1
          ? 'This will move 1 Gmail thread to Trash.'
          : `This will move ${count} Gmail threads to Trash.`,
        beforePreview: { status: 'Threads are still outside Trash' },
        afterPreview: {
          threads: String(count),
          effect: summarizeInboxActionEffect('trash_threads'),
          items: previewItems.slice(0, 5).map((item) => `${item.sender} - ${item.subject}`).join('\n') || 'Thread IDs only',
        },
        fields: [
          {
            key: 'thread_ids',
            label: 'Thread IDs',
            value: threadIds.join(', '),
            multiline: count > 2,
            placeholder: 'thread-id-1, thread-id-2',
          },
          {
            key: 'preview_items',
            label: 'Preview items (JSON)',
            value: typeof args.preview_items === 'string' ? args.preview_items : '',
            multiline: true,
            placeholder: '[{"thread_id":"abc","sender":"Sender","subject":"Subject"}]',
          },
        ],
      };
    }
    case 'restore_email_threads':
    case 'mute_email_threads':
    case 'mark_threads_read': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      const actionType = toolName === 'restore_email_threads'
        ? 'restore_threads'
        : toolName === 'mute_email_threads'
          ? 'mute_threads'
          : 'mark_read';
      return {
        ...base,
        title: toolName === 'restore_email_threads' ? 'Approve inbox restore' : toolName === 'mute_email_threads' ? 'Approve mute action' : 'Approve mark as read',
        summary: `This will update ${threadIds.length} Gmail thread${threadIds.length === 1 ? '' : 's'}.`,
        beforePreview: { status: 'No Gmail changes applied yet' },
        afterPreview: {
          threads: String(threadIds.length),
          effect: summarizeInboxActionEffect(actionType),
        },
        fields: [
          {
            key: 'thread_ids',
            label: 'Thread IDs',
            value: threadIds.join(', '),
            multiline: threadIds.length > 2,
            placeholder: 'thread-id-1, thread-id-2',
          },
        ],
      };
    }
    case 'apply_label_to_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      const labelName = String(args.label_name ?? '').trim();
      return {
        ...base,
        title: 'Approve label update',
        summary: `This will apply the label "${labelName || 'requested label'}" to ${threadIds.length} thread${threadIds.length === 1 ? '' : 's'}.`,
        beforePreview: { status: 'Threads unchanged' },
        afterPreview: {
          threads: String(threadIds.length),
          effect: summarizeInboxActionEffect('apply_label', labelName),
        },
        fields: [
          { key: 'thread_ids', label: 'Thread IDs', value: threadIds.join(', '), multiline: threadIds.length > 2, placeholder: 'thread-id-1, thread-id-2' },
          { key: 'label_name', label: 'Label name', value: labelName, placeholder: 'Follow up' },
        ],
      };
    }
    case 'unsubscribe_from_sender':
      return {
        ...base,
        title: 'Approve unsubscribe check',
        summary: 'FlowSpace will attempt a safe best-effort unsubscribe only if List-Unsubscribe metadata is present.',
        beforePreview: { status: 'No unsubscribe action attempted yet' },
        afterPreview: { effect: summarizeInboxActionEffect('unsubscribe_sender') },
        fields: [
          { key: 'thread_ids', label: 'Thread IDs', value: normalizeThreadIds(args.thread_ids).join(', '), multiline: true, placeholder: 'thread-id-1' },
        ],
      };
    case 'create_gmail_filter':
      return {
        ...base,
        title: 'Approve Gmail filter',
        summary: 'This will create a Gmail filter using sender/subject criteria.',
        beforePreview: { status: 'Filter does not exist yet' },
        afterPreview: {
          sender: String(args.sender ?? ''),
          subject: String(args.subject ?? ''),
          effect: summarizeInboxActionEffect('create_filter', String(args.label_name ?? '')),
        },
        fields: [
          { key: 'sender', label: 'Sender contains', value: String(args.sender ?? ''), placeholder: 'alerts@example.com' },
          { key: 'subject', label: 'Subject contains', value: String(args.subject ?? ''), placeholder: 'newsletter' },
          { key: 'label_name', label: 'Apply label', value: String(args.label_name ?? ''), placeholder: 'Newsletters' },
          { key: 'archive', label: 'Archive', value: String(args.archive ?? ''), placeholder: 'true' },
          { key: 'mark_read', label: 'Mark read', value: String(args.mark_read ?? ''), placeholder: 'true' },
          { key: 'skip_inbox', label: 'Skip inbox', value: String(args.skip_inbox ?? ''), placeholder: 'true' },
        ],
      };
    default: {
      // For dynamic tools, build a rich approval card showing the workflow steps
      const dynamicTool = getDynamicTool(toolName);
      if (dynamicTool) {
        const stepList = dynamicTool.steps
          .map((s, i) => `${i + 1}. ${s.action.replace(/_/g, ' ')}`)
          .join('\n');
        const label = dynamicTool.label
          || toolName.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return {
          ...base,
          title: `Approve ${label}`,
          summary: dynamicTool.description,
          // Preserve original args so executeApprovedAction can pass them to executeTool
          toolArgs: args,
          fields: [
            {
              key: '_steps',
              label: 'Steps',
              value: stepList,
              multiline: true,
            },
          ],
        };
      }
      return {
        ...base,
        title: `Approve ${toolName}`,
        summary: 'Review this action before FlowSpace executes it.',
        fields: Object.entries(args).map(([key, value]) => ({
          key,
          label: key.replace(/_/g, ' '),
          value: String(value ?? ''),
          multiline: String(value ?? '').includes('\n'),
        })),
      };
    }
  }
}

// ── buildBlocksFromToolResult ─────────────────────────────────────────────────
// Implementation moved to tool-result-renderer.ts to keep file size manageable.

export { buildBlocksFromToolResult } from './tool-result-renderer.js';

