/**
 * Pure utility functions for the chat harness.
 *
 * These are stateless label generators, text chunkers, and event helpers
 * extracted from chat.ts to keep the orchestration file focused.
 */

import type { AssistantPayload, ToolEvent } from '../shared/chat.js';
import { dynamicToolLabel } from './dynamic-tool-bridge.js';
import type { Persona } from '../lib/persona.js';

// ── Text chunking ─────────────────────────────────────────────────────────────

export function chunkText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > 0) {
    const slice = remaining.slice(0, 140);
    const lastSpace = slice.lastIndexOf(' ');
    const next = remaining.length <= 140
      ? remaining
      : slice.slice(0, lastSpace > 40 ? lastSpace : 140);
    chunks.push(next);
    remaining = remaining.slice(next.length).trimStart();
  }
  return chunks;
}

// ── Tool event helpers ────────────────────────────────────────────────────────

export function updateToolEvent(events: ToolEvent[], next: ToolEvent): ToolEvent[] {
  const existingIndex = events.findIndex((event) => event.id === next.id);
  if (existingIndex === -1) return [...events, next];
  const copy = [...events];
  copy[existingIndex] = next;
  return copy;
}

// ── Tool labels ───────────────────────────────────────────────────────────────

export function toolLabel(toolName: string): string {
  switch (toolName) {
    case 'search_drive': return 'Searching Drive';
    case 'list_drive_files': return 'Listing recent Drive files';
    case 'search_emails': return 'Searching Gmail';
    case 'read_email': return 'Reading email';
    case 'list_calendar_events': return 'Checking calendar';
    case 'list_tasks': return 'Checking tasks';
    case 'standup_report': return 'Building standup report';
    case 'meeting_prep': return 'Preparing meeting brief';
    case 'weekly_digest': return 'Building weekly digest';
    case 'send_email': return 'Preparing email';
    case 'compose_email': return 'Composing email draft';
    case 'create_calendar_event': return 'Preparing calendar event';
    case 'create_task': return 'Preparing task';
    case 'create_drive_folder': return 'Preparing Drive folder';
    case 'calendar_agenda': return 'Loading agenda';
    case 'gmail_triage': return 'Triaging inbox';
    case 'sheets_read': return 'Reading spreadsheet';
    case 'sheets_create': return 'Creating spreadsheet';
    case 'sheets_update': return 'Preparing spreadsheet edit';
    case 'docs_write': return 'Preparing document edit';
    case 'sheets_append': return 'Preparing spreadsheet update';
    case 'drive_upload': return 'Preparing file upload';
    case 'review_overdue_tasks': return 'Checking overdue tasks';
    case 'save_email_to_doc': return 'Preparing email-to-doc';
    case 'archive_email_threads': return 'Preparing email archive';
    case 'trash_email_threads': return 'Preparing email delete';
    case 'restore_email_threads': return 'Preparing inbox restore';
    case 'mute_email_threads': return 'Preparing mute action';
    case 'mark_threads_read': return 'Preparing mark-as-read action';
    case 'apply_label_to_threads': return 'Preparing label update';
    case 'unsubscribe_from_sender': return 'Preparing unsubscribe check';
    case 'create_gmail_filter': return 'Preparing Gmail filter';
    case 'create_tool': return 'Creating new tool';
    default: {
      const dynamic = dynamicToolLabel(toolName);
      return dynamic ? `Running ${dynamic}` : `Running ${toolName}`;
    }
  }
}

/** Generate a verbose running label that includes argument context. */
export function verboseRunningLabel(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'search_drive': return `Searching Drive for "${args.query}"`;
    case 'search_emails': return `Searching Gmail for "${args.query}"`;
    case 'read_email': return `Reading email ${String(args.message_id ?? '').slice(0, 12)}…`;
    case 'list_calendar_events': return `Checking calendar (next ${args.days ?? 7} days)`;
    case 'list_drive_files': return `Listing ${args.limit ?? 10} recent Drive files`;
    case 'list_tasks': return `Listing open tasks`;
    case 'standup_report': return 'Gathering calendar + tasks for standup';
    case 'meeting_prep': return 'Gathering agenda, attendees, and docs';
    case 'weekly_digest': return "Compiling this week's events and emails";
    case 'calendar_agenda': return `Loading today's agenda`;
    case 'gmail_triage': return `Triaging ${args.limit ?? 20} unread emails`;
    case 'sheets_read': return `Reading spreadsheet range ${args.range ?? ''}`;
    case 'sheets_create': return `Creating spreadsheet "${args.title ?? ''}"`;
    case 'sheets_update': return `Updating spreadsheet range ${args.range ?? ''}`;
    case 'send_email': return `Drafting email to ${args.to ?? 'recipient'}`;
    case 'compose_email': return `Composing draft to ${args.to ?? 'recipient'}`;
    case 'create_calendar_event': return `Creating event "${args.summary ?? ''}"`;
    case 'create_task': return `Creating task "${args.title ?? ''}"`;
    case 'docs_write': return `Writing to document`;
    case 'sheets_append': return `Appending rows to spreadsheet`;
    case 'drive_upload': return `Uploading ${args.file_path ?? 'file'}`;
    case 'review_overdue_tasks': return 'Scanning for overdue tasks';
    case 'save_email_to_doc': return 'Saving email thread as Doc';
    case 'archive_email_threads': {
      const count = Array.isArray(args.thread_ids) ? args.thread_ids.length : String(args.thread_ids ?? '').split(',').filter(Boolean).length;
      return `Archiving ${count || 1} email thread${count === 1 || count === 0 ? '' : 's'}`;
    }
    case 'trash_email_threads': {
      const count = Array.isArray(args.thread_ids) ? args.thread_ids.length : String(args.thread_ids ?? '').split(',').filter(Boolean).length;
      return `Trashing ${count || 1} email thread${count === 1 || count === 0 ? '' : 's'}`;
    }
    case 'restore_email_threads': return `Restoring ${String(args.thread_ids ?? '').split(',').filter(Boolean).length || 1} email threads to Inbox`;
    case 'mute_email_threads': return `Muting ${String(args.thread_ids ?? '').split(',').filter(Boolean).length || 1} email threads`;
    case 'mark_threads_read': return `Marking ${String(args.thread_ids ?? '').split(',').filter(Boolean).length || 1} email threads as read`;
    case 'apply_label_to_threads': return `Applying label "${args.label_name ?? ''}"`;
    case 'unsubscribe_from_sender': return 'Checking unsubscribe support';
    case 'create_gmail_filter': return `Creating Gmail filter`;
    default: return toolLabel(toolName);
  }
}

/** Generate a verbose completion summary from tool result. */
export function verboseCompletedDetail(toolName: string, result: string): string {
  try {
    const parsed = JSON.parse(result);
    switch (toolName) {
      case 'search_drive': {
        const count = parsed?.files?.length ?? 0;
        return count === 0 ? 'No files found' : `Found ${count} file${count !== 1 ? 's' : ''}`;
      }
      case 'search_emails': {
        const count = parsed?.messages?.length ?? 0;
        if (count === 0) return 'No emails found';
        const estimate = parsed?.resultSizeEstimate;
        if (parsed?.truncated && typeof estimate === 'number' && estimate > count) {
          return `Found ${count} of about ${estimate} email${estimate !== 1 ? 's' : ''}`;
        }
        return `Found ${count} email${count !== 1 ? 's' : ''}`;
      }
      case 'read_email': {
        const subj = parsed?.subject ?? '';
        return subj ? `Read: "${subj.slice(0, 60)}"` : 'Email read';
      }
      case 'list_calendar_events': {
        const count = parsed?.items?.length ?? 0;
        return `${count} upcoming event${count !== 1 ? 's' : ''}`;
      }
      case 'list_drive_files': {
        const count = parsed?.files?.length ?? 0;
        return `${count} recent file${count !== 1 ? 's' : ''}`;
      }
      case 'list_tasks': {
        const count = parsed?.items?.length ?? 0;
        return `${count} open task${count !== 1 ? 's' : ''}`;
      }
      case 'calendar_agenda': {
        const events = parsed?.events ?? parsed?.items ?? (Array.isArray(parsed) ? parsed : []);
        return `${events.length} event${events.length !== 1 ? 's' : ''} on agenda`;
      }
      case 'gmail_triage': {
        const t = parsed?.triage ?? parsed?.buckets ?? parsed;
        const total = (t?.action_required?.length ?? 0) + (t?.review?.length ?? 0) + (t?.low_priority?.length ?? 0);
        return `Triaged ${total} email${total !== 1 ? 's' : ''}`;
      }
      case 'sheets_read': {
        const rows = parsed?.values?.length ?? 0;
        return rows > 0 ? `Read ${rows} row${rows !== 1 ? 's' : ''}` : 'Spreadsheet read';
      }
      case 'sheets_create': {
        const title = parsed?.properties?.title;
        return title ? `Created "${title}"` : 'Spreadsheet created';
      }
      case 'sheets_update': {
        const cells = parsed?.updatedCells ?? 0;
        return cells > 0 ? `Updated ${cells} cell${cells !== 1 ? 's' : ''}` : 'Spreadsheet updated';
      }
      case 'compose_email': {
        const to = parsed?.to ?? '';
        return to ? `Draft ready for ${to}` : 'Draft ready';
      }
      case 'review_overdue_tasks': {
        const tasks = parsed?.tasks ?? parsed?.items ?? (Array.isArray(parsed) ? parsed : []);
        return `${tasks.length} overdue task${tasks.length !== 1 ? 's' : ''}`;
      }
      case 'archive_email_threads': {
        const count = parsed?.succeeded_count ?? parsed?.archived ?? 0;
        return `Archived ${count} email thread${count !== 1 ? 's' : ''}`;
      }
      case 'trash_email_threads':
        return `Trashed ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'restore_email_threads':
        return `Restored ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'mute_email_threads':
        return `Muted ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'mark_threads_read':
        return `Marked ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''} as read`;
      case 'apply_label_to_threads':
        return `Labeled ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'unsubscribe_from_sender':
        return parsed?.message ?? 'Checked unsubscribe support';
      case 'create_gmail_filter':
        return parsed?.message ?? 'Created Gmail filter';
      default:
        return 'Done';
    }
  } catch {
    // Non-JSON result or tool returned plain text
    if (result.startsWith('Error:')) return result.slice(0, 80);
    if (result.includes('No messages found')) return 'No emails found';
    return 'Done';
  }
}

// ── Approval messages ─────────────────────────────────────────────────────────

export function approvalMessage(toolName: string): string {
  switch (toolName) {
    case 'send_email':
      return 'I drafted an email and stopped before sending it. Review the approval card and confirm if it looks right.';
    case 'create_calendar_event':
      return 'I prepared a calendar event draft. Review the details and approve it when you are ready.';
    case 'create_task':
      return 'I prepared a task for Google Tasks. Review the fields and approve it if you want me to create it.';
    case 'create_drive_folder':
      return 'I prepared a new Drive folder. Review the details and approve the action to create it.';
    case 'docs_write':
      return 'I prepared content for a Google Doc. Review the text and approve it to write.';
    case 'sheets_append':
      return 'I prepared rows to add to a spreadsheet. Review the data and approve to append.';
    case 'sheets_create':
      return 'I prepared a new spreadsheet. Review the title and initial data, then approve to create it.';
    case 'sheets_update':
      return 'I prepared changes to a spreadsheet. Review the data and approve to write the values.';
    case 'drive_upload':
      return 'I prepared a file upload to Drive. Review the details and approve to upload.';
    case 'save_email_to_doc':
      return 'I prepared to save an email thread as a Doc. Review and approve to proceed.';
    case 'archive_email_threads':
      return 'I prepared an inbox archive action. Review the thread IDs and approve it to remove those emails from Inbox.';
    case 'trash_email_threads':
      return 'I prepared a delete action. Review the thread IDs and approve it to move those emails to Gmail Trash.';
    case 'restore_email_threads':
      return 'I prepared an inbox restore action. Review the thread IDs and approve it to return those emails to Inbox.';
    case 'mute_email_threads':
      return 'I prepared a Gmail mute action. Review the thread IDs and approve it to mute future replies.';
    case 'mark_threads_read':
      return 'I prepared a mark-as-read action. Review the thread IDs and approve it to remove the unread state.';
    case 'apply_label_to_threads':
      return 'I prepared a Gmail label update. Review the selected threads and label name, then approve it to continue.';
    case 'unsubscribe_from_sender':
      return 'I prepared a safe unsubscribe check. Review it and approve to continue.';
    case 'create_gmail_filter':
      return 'I prepared a Gmail filter draft. Review the criteria and approve it to create the filter.';
    default: {
      const label = dynamicToolLabel(toolName);
      if (label) {
        return `I'm ready to run **${label}**. Review the steps in the approval card and confirm when you're ready.`;
      }
      return 'I prepared a write action and stopped for approval. Review the details before continuing.';
    }
  }
}

// ── Persona content rules ─────────────────────────────────────────────────────

function wantsRedDeadlineEmphasis(persona?: Persona): boolean {
  const ci = persona?.customInstructions?.toLowerCase() ?? '';
  if (!ci) return false;
  return ci.includes('deadline') && (ci.includes('red') || ci.includes('color'));
}

export function applyPersonaContentRules(content: string, persona?: Persona): string {
  if (!wantsRedDeadlineEmphasis(persona)) return content;
  if (content.includes('!!')) return content;

  let next = content;
  next = next.replace(
    /(\bdeadline\b\s*:\s*)([^\n]+)/gi,
    (_m, prefix: string, value: string) => `${prefix}!!${value.trim()}!!`,
  );

  const monthDate = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/g;
  next = next.replace(monthDate, (m) => `!!${m}!!`);

  const numericDate = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
  next = next.replace(numericDate, (m) => `!!${m}!!`);
  return next;
}

// ── Automatic suggestions ─────────────────────────────────────────────────────

export function buildAutomaticSuggestions(payload: AssistantPayload): string[] {
  const suggestions: string[] = [];
  const emailBlock = payload.blocks.find((block) => block.type === 'email_list');
  if (emailBlock && /showing \d+ of about \d+/i.test(emailBlock.title)) {
    suggestions.push('Show more matching emails');
    suggestions.push('Expand search to 50 unread emails');
    suggestions.push('Narrow these results by sender or subject');
  }
  return suggestions;
}
