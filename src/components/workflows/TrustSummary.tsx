import { Shield, Eye } from 'lucide-react';
import type { DynamicToolItem } from '../../services/api';

// Maps action names to their readable service/verb
const ACTION_SERVICE_MAP: Record<string, { service: string; isWrite: boolean; verb: string }> = {
  search_drive: { service: 'Drive', isWrite: false, verb: 'search Drive' },
  list_drive_files: { service: 'Drive', isWrite: false, verb: 'list Drive files' },
  create_drive_folder: { service: 'Drive', isWrite: true, verb: 'create Drive folders' },
  send_email: { service: 'Gmail', isWrite: true, verb: 'send emails' },
  search_emails: { service: 'Gmail', isWrite: false, verb: 'search emails' },
  read_email: { service: 'Gmail', isWrite: false, verb: 'read emails' },
  create_calendar_event: { service: 'Calendar', isWrite: true, verb: 'create calendar events' },
  list_calendar_events: { service: 'Calendar', isWrite: false, verb: 'check your calendar' },
  create_task: { service: 'Tasks', isWrite: true, verb: 'create tasks' },
  list_tasks: { service: 'Tasks', isWrite: false, verb: 'list tasks' },
  standup_report: { service: 'Calendar', isWrite: false, verb: 'check your standup' },
  meeting_prep: { service: 'Calendar', isWrite: false, verb: 'prep for meetings' },
  email_to_task: { service: 'Tasks', isWrite: true, verb: 'create tasks from emails' },
  weekly_digest: { service: 'Gmail', isWrite: false, verb: 'compile weekly digest' },
  calendar_agenda: { service: 'Calendar', isWrite: false, verb: 'check your agenda' },
  gmail_triage: { service: 'Gmail', isWrite: false, verb: 'triage your inbox' },
  sheets_read: { service: 'Drive', isWrite: false, verb: 'read spreadsheets' },
  sheets_create: { service: 'Drive', isWrite: true, verb: 'create spreadsheets' },
  sheets_update: { service: 'Drive', isWrite: true, verb: 'update spreadsheets' },
  sheets_append: { service: 'Drive', isWrite: true, verb: 'append to spreadsheets' },
  docs_read: { service: 'Drive', isWrite: false, verb: 'read documents' },
  docs_write: { service: 'Drive', isWrite: true, verb: 'write documents' },
  drive_upload: { service: 'Drive', isWrite: true, verb: 'upload files' },
  review_overdue_tasks: { service: 'Tasks', isWrite: false, verb: 'review overdue tasks' },
  save_email_to_doc: { service: 'Drive', isWrite: true, verb: 'save emails to docs' },
  archive_email_threads: { service: 'Gmail', isWrite: true, verb: 'archive emails' },
  trash_email_threads: { service: 'Gmail', isWrite: true, verb: 'trash emails' },
  restore_email_threads: { service: 'Gmail', isWrite: true, verb: 'restore emails' },
  mute_email_threads: { service: 'Gmail', isWrite: true, verb: 'mute email threads' },
  mark_threads_read: { service: 'Gmail', isWrite: true, verb: 'mark emails read' },
  apply_label_to_threads: { service: 'Gmail', isWrite: true, verb: 'label emails' },
  unsubscribe_from_sender: { service: 'Gmail', isWrite: true, verb: 'unsubscribe from senders' },
  create_gmail_filter: { service: 'Gmail', isWrite: true, verb: 'create Gmail filters' },
};

interface Props {
  steps: DynamicToolItem['steps'];
  isWriteTool?: boolean;
  className?: string;
}

export function deriveTrustInfo(steps: DynamicToolItem['steps']) {
  const readServices = new Set<string>();
  const writeVerbs: string[] = [];

  for (const step of steps) {
    const info = ACTION_SERVICE_MAP[step.action];
    if (!info) continue;
    if (info.isWrite) {
      writeVerbs.push(info.verb);
    } else {
      readServices.add(info.service);
    }
  }

  return { readServices: Array.from(readServices), writeVerbs };
}

export function deriveSummaryText(steps: DynamicToolItem['steps']): string {
  const { readServices, writeVerbs } = deriveTrustInfo(steps);
  const hasWrites = writeVerbs.length > 0;
  const hasReads = readServices.length > 0;

  if (!hasReads && !hasWrites) return 'This workflow runs using your workspace data.';

  const readPart = hasReads
    ? `reads from ${readServices.join(', ')}`
    : null;

  const writePart = hasWrites
    ? `will ask before ${writeVerbs.slice(0, 2).join(' and ')}${writeVerbs.length > 2 ? ' and more' : ''}`
    : null;

  if (readPart && writePart) {
    return `This workflow ${readPart} and ${writePart}.`;
  }
  if (readPart) {
    return `This workflow only ${readPart}. It won't change anything on its own.`;
  }
  return `This workflow ${writePart}.`;
}

export default function TrustSummary({ steps, className = '' }: Props) {
  const { writeVerbs } = deriveTrustInfo(steps);
  const hasWrites = writeVerbs.length > 0;
  const summaryText = deriveSummaryText(steps);

  return (
    <div className={`flex items-start gap-3 rounded-[14px] border px-4 py-3 ${
      hasWrites
        ? 'border-amber-500/20 bg-amber-500/5'
        : 'border-blue-500/20 bg-blue-500/5'
    } ${className}`}>
      <div className={`mt-0.5 shrink-0 ${hasWrites ? 'text-amber-400' : 'text-blue-400'}`}>
        {hasWrites ? <Shield size={15} /> : <Eye size={15} />}
      </div>
      <p className={`text-[13px] leading-relaxed ${hasWrites ? 'text-amber-300/80' : 'text-blue-300/80'}`}>
        {summaryText}
      </p>
    </div>
  );
}
