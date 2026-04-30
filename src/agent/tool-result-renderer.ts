/**
 * tool-result-renderer.ts
 *
 * Maps raw tool output strings to rich AssistantBlock[] for display in the
 * chat UI. Extracted from tool-approval.ts to keep file sizes manageable.
 */

import type {
  AgendaEvent,
  AssistantBlock,
  InboxActionResult,
  InboxActionType,
  TriageItem,
} from '../shared/chat.js';
import {
  decodeEntities,
  formatDate,
  parseJson,
  summarizeInboxActionEffect,
} from './tool-approval.js';

// ── Private helpers ───────────────────────────────────────────────────────────

/** Extract plain text from a Google Docs API documents.get response. */
function extractDocsPlainText(doc: any): string {
  if (!doc || typeof doc !== 'object') return '';
  const segments: string[] = [];
  for (const item of (doc?.body?.content ?? [])) {
    for (const el of (item?.paragraph?.elements ?? [])) {
      const text = el?.textRun?.content ?? '';
      if (text) segments.push(text);
    }
  }
  return segments.join('');
}

function parseInboxActionResult(raw: string): InboxActionResult | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.action_type || !Array.isArray(parsed.items)) return null;
  return parsed as InboxActionResult;
}

function buildBulkActionPreviewBlock(
  title: string,
  actionType: InboxActionType,
  items: Array<{ thread_id: string; sender: string; subject: string; reason?: string; status?: 'pending' | 'completed' | 'failed' | 'noop'; error?: string }>,
  auditId?: string,
  undoAvailable?: boolean,
  undoExpiresAt?: number,
  labelName?: string,
): AssistantBlock {
  return {
    type: 'bulk_action_preview',
    title,
    actionType,
    effect: summarizeInboxActionEffect(actionType, labelName),
    items: items.map((item) => ({
      thread_id: item.thread_id,
      sender: item.sender,
      subject: item.subject,
      reason: item.reason,
      status: item.status,
      error: item.error,
      effect: summarizeInboxActionEffect(actionType, labelName),
    })),
    auditId,
    undoAvailable,
    undoExpiresAt,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildBlocksFromToolResult(toolName: string, raw: string): AssistantBlock[] {
  const parsed = parseJson(raw);

  if (toolName === 'send_email') {
    const messageId = parsed?.id ?? parsed?.messageId ?? '';
    if (messageId) {
      return [{
        type: 'fact_list',
        title: 'Email sent',
        items: [{ label: 'Message ID', value: String(messageId) }],
      }];
    }
    return [{
      type: 'status',
      title: 'Email sent',
      body: 'The email was sent successfully.',
    }];
  }

  if (toolName === 'compose_email') {
    return [{
      type: 'email_draft',
      title: parsed?.thread_id ? 'Draft reply' : 'Draft email',
      data: {
        to: String(parsed?.to ?? ''),
        subject: String(parsed?.subject ?? ''),
        body: String(parsed?.body ?? ''),
        ...(parsed?.thread_id ? { thread_id: String(parsed.thread_id) } : {}),
      },
    }];
  }

  if (toolName === 'create_task') {
    return [{
      type: 'status',
      title: 'Task created',
      body: parsed?.title ? `Created task "${parsed.title}".` : 'The task was created successfully.',
    }];
  }

  if (toolName === 'create_drive_folder') {
    return [{
      type: 'status',
      title: 'Folder created',
      body: parsed?.name ? `Created folder "${parsed.name}".` : 'The folder was created successfully.',
    }];
  }

  if (toolName === 'create_calendar_event') {
    const item = parsed?.summary
      ? [{
          title: parsed.summary,
          subtitle: parsed.location || undefined,
          meta: [parsed.start?.dateTime, parsed.end?.dateTime].filter(Boolean).join(' -> '),
          url: parsed.htmlLink || undefined,
        }]
      : [];
    return [{
      type: 'event_list',
      title: 'Event created',
      items: item,
    }];
  }

  if (toolName === 'list_drive_files' || toolName === 'search_drive') {
    const files = parsed?.files;
    if (Array.isArray(files)) {
      const seen = new Set<string>();
      const unique = files.filter((file: any) => {
        if (!file.id || seen.has(file.id)) return false;
        seen.add(file.id);
        return true;
      });
      return [{
        type: 'file_list',
        title: toolName === 'search_drive' ? 'Drive matches' : 'Recent files',
        items: unique.slice(0, 8).map((file: any) => ({
          title: String(file.name ?? 'Untitled file'),
          subtitle: String(file.mimeType ?? ''),
          meta: String(file.modifiedTime ?? ''),
          url: file.webViewLink || undefined,
        })),
      }];
    }
  }

  if (toolName === 'list_calendar_events') {
    const items = parsed?.items;
    if (Array.isArray(items)) {
      return [{
        type: 'event_list',
        title: 'Upcoming events',
        items: items.slice(0, 8).map((event: any) => ({
          title: String(event.summary ?? 'Untitled event'),
          subtitle: String(event.location ?? ''),
          meta: String(event.start?.dateTime ?? event.start?.date ?? ''),
          url: event.htmlLink || undefined,
        })),
      }];
    }
  }

  if (toolName === 'list_tasks') {
    const tasks = parsed?.items;
    if (Array.isArray(tasks)) {
      return [{
        type: 'task_list',
        title: 'Open tasks',
        items: tasks.slice(0, 8).map((task: any) => ({
          title: String(task.title ?? 'Untitled task'),
          subtitle: String(task.notes ?? ''),
          meta: String(task.due ?? ''),
          url: task.selfLink || undefined,
        })),
      }];
    }
  }

  if (toolName === 'search_emails') {
    if (Array.isArray(parsed?.messages)) {
      const items = parsed.messages.slice(0, 8)
        .map((message: any) => ({
          title: decodeEntities(String(message.subject || '(No subject)')),
          subtitle: decodeEntities(String(message.from || '')),
          meta: decodeEntities(String(message.snippet || message.date || '')),
          url: message.id ? `https://mail.google.com/mail/u/0/#inbox/${message.id}` : undefined,
        }))
        .filter((item: any) => item.title !== '(No subject)' || item.subtitle);
      if (items.length > 0) {
        const estimate = typeof parsed?.resultSizeEstimate === 'number' ? parsed.resultSizeEstimate : null;
        const title = parsed?.truncated && estimate && estimate > items.length
          ? `Email matches (showing ${items.length} of about ${estimate})`
          : 'Email matches';
        return [{
          type: 'email_list',
          title,
          items,
        }];
      }
    }
  }

  if (toolName === 'read_email') {
    if (parsed?.from || parsed?.subject) {
      const dateRaw = parsed.date || 'Unknown date';
      const blocks: AssistantBlock[] = [{
        type: 'fact_list',
        title: 'Email details',
        items: [
          { label: 'From', value: decodeEntities(parsed.from || 'Unknown sender') },
          { label: 'Subject', value: decodeEntities(parsed.subject || '(No subject)') },
          { label: 'Date', value: dateRaw === 'Unknown date' ? dateRaw : formatDate(dateRaw) },
        ],
      }];

      const body = parsed.body || parsed.snippet || '';
      const snippet = parsed.snippet || '';
      const hasExtraContent = body && body.length > snippet.length + 20;
      if (hasExtraContent) {
        const truncated = body.length > 800 ? body.slice(0, 800) + '...' : body;
        blocks.push({
          type: 'status',
          title: 'Email content',
          body: decodeEntities(truncated),
        });
      }

      return blocks;
    }
  }

  if (toolName === 'standup_report' || toolName === 'meeting_prep' || toolName === 'weekly_digest') {
    return [];
  }

  if (toolName === 'calendar_agenda') {
    const events = parsed?.events ?? parsed?.items ?? (Array.isArray(parsed) ? parsed : []);
    if (Array.isArray(events) && events.length > 0) {
      return [{
        type: 'agenda',
        title: 'Today\'s agenda',
        items: events.slice(0, 12).map((ev: any): AgendaEvent => ({
          time: String(ev.time ?? ev.start?.dateTime ?? ev.start ?? ''),
          title: String(ev.title ?? ev.summary ?? 'Untitled'),
          attendees: Array.isArray(ev.attendees) ? ev.attendees.map(String) : undefined,
          prep_note: ev.prep_note ?? ev.prepNote ?? null,
          linked_docs: Array.isArray(ev.linked_docs) ? ev.linked_docs : [],
          url: ev.url ?? ev.htmlLink ?? undefined,
        })),
      }];
    }
  }

  if (toolName === 'gmail_triage') {
    const triage = parsed?.triage ?? parsed?.buckets ?? parsed;
    const mapItems = (arr: any[]): TriageItem[] =>
      (arr ?? []).slice(0, 10).map((item: any) => ({
        subject: String(item.subject ?? '(No subject)'),
        sender: String(item.sender ?? item.from ?? ''),
        summary: item.summary ?? undefined,
        thread_id: item.thread_id ?? item.threadId ?? undefined,
      }));
    if (triage && (triage.action_required || triage.review || triage.low_priority)) {
      return [{
        type: 'triage',
        title: 'Inbox triage',
        data: {
          action_required: mapItems(triage.action_required),
          review: mapItems(triage.review),
          low_priority: mapItems(triage.low_priority),
        },
      }];
    }
  }

  if (toolName === 'sheets_read') {
    const values = parsed?.values ?? parsed?.data;
    if (Array.isArray(values) && values.length > 0) {
      return [{
        type: 'sheet_data',
        title: 'Spreadsheet data',
        data: {
          headers: values[0].map(String),
          rows: values.slice(1).map((row: any[]) => row.map(String)),
        },
      }];
    }
  }

  if (toolName === 'docs_read') {
    const directContent = parsed?.content ?? parsed?.text ?? (typeof parsed === 'string' ? parsed : '');
    const content = directContent || extractDocsPlainText(parsed);
    if (content) {
      const truncated = content.length > 800 ? content.slice(0, 800) + '...' : content;
      return [{
        type: 'status',
        title: 'Document content',
        body: truncated,
      }];
    }
  }

  if (toolName === 'docs_write') {
    return [{
      type: 'status',
      title: 'Document updated',
      body: parsed?.title ? `Updated "${parsed.title}" successfully.` : 'The document was updated successfully.',
    }];
  }

  if (toolName === 'sheets_append') {
    return [{
      type: 'status',
      title: 'Rows appended',
      body: parsed?.updates?.updatedRows
        ? `Added ${parsed.updates.updatedRows} row(s) to the spreadsheet.`
        : 'Rows were appended successfully.',
    }];
  }

  if (toolName === 'sheets_create') {
    const title = parsed?.properties?.title;
    const url = parsed?.spreadsheetUrl;
    const id = parsed?.spreadsheetId;
    const parts: string[] = [];
    parts.push(title ? `Created "${title}" successfully.` : 'The spreadsheet was created successfully.');
    if (id) parts.push(`Spreadsheet ID: ${id}`);
    if (url) parts.push(`Open: ${url}`);
    return [{
      type: 'status',
      title: 'Spreadsheet created',
      body: parts.join('\n'),
    }];
  }

  if (toolName === 'sheets_update') {
    return [{
      type: 'status',
      title: 'Spreadsheet updated',
      body: parsed?.updatedCells
        ? `Updated ${parsed.updatedCells} cell(s) in ${parsed.updatedRange ?? 'the spreadsheet'}.`
        : 'The spreadsheet was updated successfully.',
    }];
  }

  if (toolName === 'drive_upload') {
    return [{
      type: 'status',
      title: 'File uploaded',
      body: parsed?.name ? `Uploaded "${parsed.name}" to Drive.` : 'The file was uploaded successfully.',
    }];
  }

  if (toolName === 'review_overdue_tasks') {
    const tasks = parsed?.tasks ?? parsed?.items ?? (Array.isArray(parsed) ? parsed : []);
    if (Array.isArray(tasks)) {
      return [{
        type: 'task_list',
        title: 'Overdue tasks',
        items: tasks.slice(0, 10).map((task: any) => ({
          title: String(task.title ?? 'Untitled task'),
          subtitle: String(task.notes ?? ''),
          meta: task.due ? `Due: ${task.due}` : '',
          url: task.selfLink || undefined,
        })),
      }];
    }
  }

  if (toolName === 'save_email_to_doc') {
    return [{
      type: 'status',
      title: 'Email saved to Doc',
      body: parsed?.docUrl
        ? 'Email thread archived as a Google Doc.'
        : 'The email thread was saved as a Google Doc.',
    }];
  }

  if (toolName === 'archive_email_threads'
    || toolName === 'trash_email_threads'
    || toolName === 'restore_email_threads'
    || toolName === 'mute_email_threads'
    || toolName === 'mark_threads_read'
    || toolName === 'apply_label_to_threads'
    || toolName === 'unsubscribe_from_sender'
    || toolName === 'create_gmail_filter') {
    const result = parseInboxActionResult(raw);
    if (result) {
      const actionType = result.action_type;
      const labelName = actionType === 'apply_label'
        ? (result.items.find((item) => item.reason)?.reason?.match(/"(.+?)"/)?.[1] ?? '')
        : '';
      return [
        {
          type: 'status',
          title: result.failed_count > 0 ? 'Inbox action completed with issues' : 'Inbox action completed',
          body: result.message ?? `Completed ${result.succeeded_count} of ${result.requested_count} requested actions.`,
        },
        buildBulkActionPreviewBlock(
          'Affected threads',
          actionType,
          result.items.map((item) => ({
            thread_id: item.thread_id,
            sender: item.sender,
            subject: item.subject,
            reason: item.reason,
            status: item.status,
            error: item.error,
          })),
          result.audit_id,
          result.undo_available,
          result.undo_expires_at,
          labelName,
        ),
      ];
    }
  }

  if (toolName === 'archive_email_threads') {
    const archived = Number(parsed?.archived ?? 0);
    return [{
      type: 'status',
      title: 'Threads archived',
      body: archived === 1
        ? 'Archived 1 email thread.'
        : `Archived ${archived} email threads.`,
    }];
  }

  return [];
}
