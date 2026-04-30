import { isWriteTool } from './tool-definitions.js';

const REQUIRED_APPROVAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  send_email: ['to', 'subject', 'body'],
  create_calendar_event: ['summary', 'start_time'],
  create_task: ['title'],
  docs_write: ['doc_id', 'content'],
  sheets_create: ['title'],
  create_drive_folder: ['name'],
  sheets_append: ['spreadsheet_id'],
  sheets_update: ['spreadsheet_id', 'range'],
  drive_upload: ['file_path'],
  save_email_to_doc: ['thread_id'],
  archive_email_threads: ['thread_ids'],
  trash_email_threads: ['thread_ids'],
  restore_email_threads: ['thread_ids'],
  mute_email_threads: ['thread_ids'],
  mark_threads_read: ['thread_ids'],
  apply_label_to_threads: ['thread_ids', 'label_name'],
  unsubscribe_from_sender: ['thread_ids'],
  create_gmail_filter: ['sender'],
} as const;

/**
 * Validate that required fields are present and non-empty for a given tool.
 * Returns `{ valid: true }` for unknown tools (no validation rules defined).
 */
export function validateApprovalFields(
  toolName: string,
  args: Record<string, unknown>,
): { valid: boolean; error?: string } {
  const required = REQUIRED_APPROVAL_FIELDS[toolName];
  if (!required) return { valid: true };

  for (const field of required) {
    const value = args[field];
    // Accept strings, non-empty arrays, or numbers/booleans
    let isPresent = false;
    if (typeof value === 'string') {
      isPresent = value.trim().length > 0;
    } else if (Array.isArray(value)) {
      isPresent = value.length > 0;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      isPresent = true;
    }
    if (!isPresent) {
      return { valid: false, error: `Missing required field: '${field}'` };
    }
  }

  return { valid: true };
}

/**
 * Returns true when the given tool name requires user approval before execution.
 * Delegates to `isWriteTool` from tool-definitions.
 */
export function shouldRequireApproval(toolName: string): boolean {
  return isWriteTool(toolName);
}
