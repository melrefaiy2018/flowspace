import { execFile } from 'child_process';
import type { AgendaEvent, ApprovalRequest, AssistantBlock, InboxActionResult, InboxActionResultItem, InboxActionType, TriageItem } from '../shared/chat.js';
import { buildFlowSpaceTaskNotes } from '../lib/tasks.js';
import { getDynamicTool, registerDynamicTool } from './dynamic-tool-registry.js';
import { executeDynamicTool, validateDynamicTool } from './tool-composer.js';
import type { DynamicToolDef, ToolStep } from './dynamic-tool-types.js';

// Refresh an access token from client_id, client_secret, and refresh_token
async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string | null> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: params,
  });
  const data = await resp.json();
  return data.access_token ?? null;
}

// Get a fresh access token — tries gws credentials first, then .tokens.json, then ADC
async function getAccessToken(): Promise<string> {
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');

  const projectRoot = path.dirname(fileURLToPath(import.meta.url)).replace(/\/src\/agent$/, '');

  // 1. Try gws-imported credentials (primary auth path for desktop app)
  const isProduction = process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1';
  const dataDir = isProduction
    ? path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace')
    : projectRoot;
  const accountsManifestPath = path.join(dataDir, '.accounts.json');
  if (fs.existsSync(accountsManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(accountsManifestPath, 'utf-8'));
      const activeAccountId = typeof manifest?.activeAccountId === 'string' ? manifest.activeAccountId : null;
      const activeAccount = Array.isArray(manifest?.accounts)
        ? manifest.accounts.find((account: any) => account?.id === activeAccountId)
        : null;
      const credsPath = typeof activeAccount?.credentialPath === 'string'
        ? activeAccount.credentialPath
        : null;
      if (credsPath && fs.existsSync(credsPath)) {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        const token = await refreshAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
        if (token) return token;
      }
    } catch {
      // Fall through
    }
  }

  const legacyGwsCredsPath = path.join(dataDir, '.gws-credentials.json');
  if (fs.existsSync(legacyGwsCredsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(legacyGwsCredsPath, 'utf-8'));
      if (creds.client_id && creds.client_secret && creds.refresh_token) {
        const token = await refreshAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
        if (token) return token;
      }
    } catch {
      // Fall through
    }
  }

  // 2. Try .tokens.json (OAuth2 web flow)
  const tokensPath = path.join(projectRoot, '.tokens.json');
  if (fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      if (tokens.refresh_token) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (clientId && clientSecret) {
          const token = await refreshAccessToken(clientId, clientSecret, tokens.refresh_token);
          if (token) return token;
        }
      }
    } catch {
      // Fall through to ADC
    }
  }

  // 3. Fall back to ADC
  const adcPath = path.join(os.homedir(), '.config/gcloud/application_default_credentials.json');
  const creds = JSON.parse(fs.readFileSync(adcPath, 'utf-8'));
  const token = await refreshAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
  if (token) return token;
  throw new Error('Failed to obtain access token from any auth source');
}

// Execute a gws CLI command
export async function executeGws(args: string[], signal?: AbortSignal): Promise<string> {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const child = execFile('gws', args, {
      timeout: 30000,
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token },
      signal,
    }, (err, stdout, stderr) => {
      if (err) {
        if ((err as any).name === 'AbortError' || signal?.aborted) {
          reject(err);
          return;
        }
        
        // Sometimes CLIs put error details in stdout (especially with --format json)
        // or stderr. If both are empty, fall back to the generic error message.
        const errorOutput = (stderr || stdout || '').trim();
        const errorMsg = errorOutput || err.message;
        
        // Enhance file-not-found errors for the agent
        if (errorMsg.includes('404') || errorMsg.includes('File not found') || errorMsg.includes('not found') || errorMsg.includes('not exist')) {
          const extractFileIdFromArgs = (toolArgs: string[]): string | null => {
            const joined = toolArgs.join(' ');
            const idFlags = ['--id', '--document', '--spreadsheet', '--parent'];

            for (const flag of idFlags) {
              const pattern = new RegExp(`${flag}\\s+([^\\s]+)`);
              const match = joined.match(pattern);
              if (match && match[1]) {
                return match[1];
              }
            }

            // Fallback: treat the last non-flag argument as a possible ID
            for (let i = toolArgs.length - 1; i >= 0; i--) {
              const value = toolArgs[i];
              if (!value.startsWith('-')) {
                return value;
              }
            }

            return null;
          };

          const fileId = extractFileIdFromArgs(args) ?? 'the requested file';
          resolve(`Error: File "${fileId}" was not found or has been deleted. If you were trying to read or update a document, you should explain this to the user and offer to create a new one.`);
          return;
        }

        // Handle tool-specific confusion (e.g. reading a Doc as a Sheet)
        if (errorMsg.includes('mimeType') || errorMsg.includes('spreadsheet') || errorMsg.includes('type')) {
          resolve(`Error: The operation failed because of a type mismatch (e.g. trying to read a Google Doc as a Spreadsheet). Check if you are using the correct tool for this file type. Output: ${errorMsg}`);
          return;
        }

        resolve(`Error: ${errorMsg}`);
        return;
      }
      resolve(stdout || stderr || 'Command completed successfully');
    });

    signal?.addEventListener('abort', () => {
      child.kill('SIGTERM');
    }, { once: true });
  });
}

const WRITE_TOOL_NAMES = new Set([
  'send_email',
  'create_calendar_event',
  'create_task',
  'create_drive_folder',
  'docs_write',
  'sheets_append',
  'sheets_create',
  'sheets_update',
  'drive_upload',
  'save_email_to_doc',
  'archive_email_threads',
  'trash_email_threads',
  'restore_email_threads',
  'mute_email_threads',
  'mark_threads_read',
  'apply_label_to_threads',
  'unsubscribe_from_sender',
  'create_gmail_filter',
]);

function normalizeThreadIds(input: unknown): string[] {
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

function summarizeInboxActionEffect(actionType: InboxActionType, labelName?: string): string {
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

async function callInboxActionApi(payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const baseUrl = getInboxActionsBaseUrl();
  const response = await fetch(`${baseUrl}/api/inbox-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text);
      return `Error: ${parsed.error || 'Inbox action failed'}`;
    } catch {
      return `Error: ${text || 'Inbox action failed'}`;
    }
  }
  return text;
}

async function callUndoInboxActionApi(auditId: string, signal?: AbortSignal): Promise<string> {
  const baseUrl = getInboxActionsBaseUrl();
  const response = await fetch(`${baseUrl}/api/inbox-actions/${encodeURIComponent(auditId)}/undo`, {
    method: 'POST',
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text);
      return `Error: ${parsed.error || 'Undo failed'}`;
    } catch {
      return `Error: ${text || 'Undo failed'}`;
    }
  }
  return text;
}

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

function extractEmailBody(payload: any): string {
  // Try snippet first (always clean text)
  // Then try to decode body parts
  let body = '';

  // Check for multipart
  const parts = payload?.parts;
  if (Array.isArray(parts)) {
    // Prefer text/plain
    const textPart = parts.find((p: any) => p.mimeType === 'text/plain');
    const htmlPart = parts.find((p: any) => p.mimeType === 'text/html');
    const encoded = textPart?.body?.data || htmlPart?.body?.data;
    if (encoded) {
      try {
        const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
        body = textPart ? decoded : stripHtml(decoded);
      } catch { /* fall through */ }
    }
  } else if (payload?.body?.data) {
    try {
      const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      body = payload.mimeType === 'text/html' ? stripHtml(decoded) : decoded;
    } catch { /* fall through */ }
  }

  return body;
}

export function headerValue(headers: any[] | undefined, name: string): string {
  return headers?.find((header) => header?.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function isWriteTool(name: string): boolean {
  if (WRITE_TOOL_NAMES.has(name)) return true;
  const dynamicTool = getDynamicTool(name);
  return dynamicTool?.isWriteTool === true;
}

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
    default:
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

/** Extract plain text from a Google Docs API documents.get response (nested body.content structure). */
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
      // Deduplicate by file ID — keep first occurrence (most recent)
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
    // The executor now returns clean JSON with from, to, subject, date, body
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
      // Only show the body block if it has substantially more content than the snippet
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

  // Workflow tools: the AI formats data from the tool result into its markdown response.
  // No structured blocks needed — they were redundant and often showed raw JSON.
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
        ? `Email thread archived as a Google Doc.`
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

// Tool definitions in OpenAI function-calling format (compatible with GLM)
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_drive',
      description: 'Search for files in Google Drive by name or content type. Returns file IDs, names, and links.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "name contains \'budget\'" or "mimeType=\'application/vnd.google-apps.spreadsheet\'")' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_drive_files',
      description: 'List recent files in Google Drive, sorted by last modified.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_drive_folder',
      description: 'Create a new folder in Google Drive.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Folder name' },
          parent_id: { type: 'string', description: 'Parent folder ID (optional, defaults to root)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_email',
      description: 'Send an email via Gmail.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compose_email',
      description: 'Present an editable email draft to the user for review before sending. Use this INSTEAD of send_email when the user asks you to draft, compose, or write an email reply. The draft appears as an interactive card the user can edit and send themselves. For replies to existing threads, include thread_id so the reply is threaded correctly in Gmail.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body (plain text)' },
          thread_id: { type: 'string', description: 'Gmail thread ID — include for replies to existing threads, omit for new emails' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_emails',
      description: 'Search Gmail messages. Use Gmail query operators for precise results: from:, subject:, is:unread, has:attachment, newer_than:, older_than:, exact phrases in quotes. Combine with spaces (AND) or OR. Prefer specific operator queries over plain keywords. Example: from:amex subject:(warranty OR "purchase protection"). For inbox review or broad unread sweeps, set a higher limit like 25-50 instead of relying on the default.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query. Use operators like from:, subject:, is:, has: for precise results. Avoid broad plain-text queries.' },
          limit: { type: 'number', description: 'Max results (default 25, use up to 50 for inbox review)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_email',
      description: 'Read a specific email message by ID. Returns subject, from, to, date, and body snippet.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_calendar_event',
      description: 'Create a new Google Calendar event.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g., "2026-03-10T14:00:00-06:00")' },
          end_time: { type: 'string', description: 'End time in ISO 8601 format' },
          description: { type: 'string', description: 'Event description (optional)' },
          attendees: { type: 'string', description: 'Comma-separated email addresses of attendees (optional)' },
          location: { type: 'string', description: 'Event location (optional)' },
        },
        required: ['summary', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_calendar_events',
      description: 'List upcoming Google Calendar events.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look ahead (default 7)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_task',
      description: 'Create a new task in Google Tasks.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          notes: { type: 'string', description: 'Task notes/description (optional)' },
          due: { type: 'string', description: 'Due date in ISO 8601 format (optional, e.g., "2026-03-10T00:00:00Z")' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_tasks',
      description: 'List open tasks from Google Tasks.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'standup_report',
      description: 'Generate a standup report — today\'s meetings and open tasks combined.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'meeting_prep',
      description: 'Prepare for the next upcoming meeting — shows agenda, attendees, and linked docs.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'email_to_task',
      description: 'Convert a Gmail message into a Google Tasks entry.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID to convert to a task' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'weekly_digest',
      description: 'Generate a weekly summary — this week\'s meetings and unread email count.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // Tier 1 — gws skill-based tools
  {
    type: 'function' as const,
    function: {
      name: 'calendar_agenda',
      description: 'Get today\'s agenda with attendees, linked docs, and prep notes. Richer than list_calendar_events.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format, defaults to today' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_triage',
      description: 'Triage unread emails into action_required, review, and low_priority buckets with AI categorization.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max emails to triage (default 20)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_email_triage',
      description: 'Open the AI Triage view that categorizes inbox emails by importance (urgent, needs attention, informational, low priority). Use this when the user wants to see their emails organized by importance or asks to categorize/triage their inbox.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_email_triage',
      description: 'Check if the AI Triage view is up-to-date and refresh it with the latest emails. Use when the user asks to update, refresh, or re-check the triage, or asks if their triage is current.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'sheets_read',
      description: 'Read data from a Google Sheets spreadsheet by cell range.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation range, e.g. Sheet1!A1:D10' },
        },
        required: ['spreadsheet_id', 'range'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'docs_read',
      description: 'Read the content of a Google Doc. Returns the text content of the document.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: 'Google Doc ID' },
        },
        required: ['doc_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'docs_write',
      description: 'Write or append content to a Google Doc. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: 'Google Doc ID' },
          content: { type: 'string', description: 'Content to write (plain text or markdown)' },
          mode: { type: 'string', enum: ['append'], description: 'Write mode (only append is supported — adds content to end of doc)' },
        },
        required: ['doc_id', 'content'],
      },
    },
  },

  // Tier 2 — gws skill-based tools
  {
    type: 'function' as const,
    function: {
      name: 'sheets_append',
      description: 'Append rows to a Google Sheets spreadsheet. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation range to append after, e.g. Sheet1!A1' },
          values: { type: 'string', description: 'JSON array of row arrays, e.g. [["A","B"],["C","D"]]' },
        },
        required: ['spreadsheet_id', 'range', 'values'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'sheets_create',
      description: 'Create a new Google Sheets spreadsheet with a title and initial data. Always include both header row AND data rows in the values parameter when the user provides data to populate. Returns the new spreadsheet ID and URL. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title for the new spreadsheet' },
          values: { type: 'string', description: 'Optional JSON array of row arrays to populate the sheet, e.g. [["Header1","Header2"],["Row1A","Row1B"]]' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'sheets_update',
      description: 'Write or overwrite values in specific cells of an existing Google Sheets spreadsheet. Use this to modify existing data or fill specific cell ranges. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation range to write to, e.g. Sheet1!A1:C3' },
          values: { type: 'string', description: 'JSON array of row arrays, e.g. [["A","B","C"],["D","E","F"]]' },
        },
        required: ['spreadsheet_id', 'range', 'values'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'drive_upload',
      description: 'Upload a file to Google Drive. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Local path to the file to upload' },
          parent_id: { type: 'string', description: 'Parent folder ID (optional, defaults to root)' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'review_overdue_tasks',
      description: 'Surface overdue tasks with context — shows what needs attention.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_email_to_doc',
      description: 'Archive a Gmail thread as a Google Doc for reference. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'Gmail thread ID to save' },
        },
        required: ['thread_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'archive_email_threads',
      description: 'Archive one or more Gmail threads by removing the INBOX label. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Gmail thread IDs to archive.',
          },
          preview_items: {
            type: 'string',
            description: 'Optional JSON array preview of the selected threads with sender, subject, and reason.',
          },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'trash_email_threads',
      description: 'Move one or more Gmail threads to Gmail Trash. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Gmail thread IDs to move to Trash.',
          },
          preview_items: {
            type: 'string',
            description: 'Optional JSON array preview of the selected threads with sender, subject, and reason.',
          },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'restore_email_threads',
      description: 'Restore one or more Gmail threads back to the Inbox. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to restore to Inbox.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mute_email_threads',
      description: 'Mute one or more Gmail threads. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to mute.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mark_threads_read',
      description: 'Mark one or more Gmail threads as read. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to mark as read.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'apply_label_to_threads',
      description: 'Apply a Gmail label to one or more Gmail threads. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to label.' },
          label_name: { type: 'string', description: 'Gmail label name to apply.' },
        },
        required: ['thread_ids', 'label_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'unsubscribe_from_sender',
      description: 'Safely attempt a best-effort unsubscribe using Gmail metadata. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'A representative Gmail thread ID from the sender.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_gmail_filter',
      description: 'Create a Gmail filter using sender or subject criteria. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          sender: { type: 'string', description: 'Sender email or sender pattern.' },
          subject: { type: 'string', description: 'Subject text to match.' },
          label_name: { type: 'string', description: 'Optional label name to apply.' },
          archive: { type: 'boolean', description: 'Whether to archive matching emails.' },
          mark_read: { type: 'boolean', description: 'Whether to mark matching emails as read.' },
          skip_inbox: { type: 'boolean', description: 'Whether to skip the inbox.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_memory',
      description: 'Save information to long-term memory for future conversations. Use when the user explicitly says "remember this" or "save this for later" or when you learn something important about the user that should be recalled across conversations. Categories: resource (files, spreadsheets, docs with IDs), workflow (user\'s processes and patterns), preference (user\'s preferences and defaults), fact (important information about people, projects, etc).',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What to remember, written as a concise human-readable summary' },
          category: { type: 'string', enum: ['resource', 'workflow', 'preference', 'fact'], description: 'Category: resource (files/docs/spreadsheets with IDs), workflow (user processes), preference (defaults and preferences), fact (important information)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Keywords for retrieval (3-5 relevant words)' },
        },
        required: ['content', 'category', 'tags'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_memory',
      description: 'Search long-term memory for previously stored information about the user. Use when the user asks about past preferences, created resources, established workflows, or says "what did I..." or "remember when...". Returns matching memories with relevance scores.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for in memory (e.g., "job applications spreadsheet", "email preferences", "weekly standup")' },
        },
        required: ['query'],
      },
    },
  },
];

// Tool executor — maps tool name to gws command execution
export async function executeTool(name: string, args: Record<string, any>, signal?: AbortSignal): Promise<string> {
  switch (name) {
    case 'search_drive': {
      const limit = args.limit || 10;
      return executeGws(['drive', 'files', 'list', '--params', JSON.stringify({
        q: args.query,
        pageSize: limit,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,shared)',
      })], signal);
    }

    case 'list_drive_files': {
      const limit = args.limit || 10;
      return executeGws(['drive', 'files', 'list', '--params', JSON.stringify({
        orderBy: 'modifiedTime desc',
        pageSize: limit,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
      })], signal);
    }

    case 'create_drive_folder': {
      const body: any = {
        name: args.name,
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (args.parent_id) body.parents = [args.parent_id];
      return executeGws(['drive', 'files', 'create', '--json', JSON.stringify(body)], signal);
    }

    case 'compose_email': {
      return JSON.stringify({
        to: args.to,
        subject: args.subject,
        body: args.body,
        ...(args.thread_id ? { thread_id: args.thread_id } : {}),
      });
    }

    case 'send_email': {
      const message = [
        `To: ${args.to}`,
        `Subject: ${args.subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        args.body,
      ].join('\r\n');
      const raw = Buffer.from(message).toString('base64url');
      return executeGws(['gmail', 'users', 'messages', 'send', '--params', JSON.stringify({ userId: 'me' }), '--json', JSON.stringify({ raw })], signal);
    }

    case 'search_emails': {
      const limit = Math.min(Number(args.limit) || 25, 50);
      const listResult = await executeGws(['gmail', 'users', 'messages', 'list', '--params', JSON.stringify({
        userId: 'me',
        q: args.query,
        maxResults: limit,
      })], signal);

      try {
        const parsed = JSON.parse(listResult);
        const messages = parsed.messages || [];
        if (messages.length === 0) return 'No messages found matching your query.';
        const resultSizeEstimate = typeof parsed.resultSizeEstimate === 'number' ? parsed.resultSizeEstimate : messages.length;

        const details = [];
        for (const m of messages.slice(0, limit)) {
          const detail = await executeGws(['gmail', 'users', 'messages', 'get', '--params', JSON.stringify({
            userId: 'me',
            id: m.id,
            format: 'full',
          })], signal);
          const parsedDetail = parseJson(detail);
          const headers = parsedDetail?.payload?.headers;
          details.push({
            id: m.id,
            threadId: parsedDetail?.threadId || m.threadId,
            from: headerValue(headers, 'From'),
            subject: headerValue(headers, 'Subject'),
            date: headerValue(headers, 'Date'),
            snippet: parsedDetail?.snippet || '',
          });
        }
        // Relevance scoring: extract keywords from query, score each result, filter out irrelevant matches
        const queryKeywords = args.query
          .replace(/\b(from|to|subject|is|has|newer_than|older_than|after|before|in|label):[^\s]*/gi, '')
          .replace(/[()""]/g, ' ')
          .split(/\s+/)
          .map((w: string) => w.toLowerCase())
          .filter((w: string) => w.length >= 3 && !['and', 'the', 'for'].includes(w));

        if (queryKeywords.length > 0) {
          const scored = details.map(d => {
            const text = `${d.from} ${d.subject} ${d.snippet}`.toLowerCase();
            const score = queryKeywords.filter(kw => text.includes(kw)).length;
            return { ...d, _score: score };
          });
          scored.sort((a, b) => b._score - a._score);
          const relevant = scored.filter(d => d._score > 0);
          const final = (relevant.length > 0 ? relevant : scored).map(({ _score, ...rest }) => rest);
          return JSON.stringify({
            messages: final,
            resultSizeEstimate,
            truncated: resultSizeEstimate > final.length,
          });
        }

        return JSON.stringify({
          messages: details,
          resultSizeEstimate,
          truncated: resultSizeEstimate > details.length,
        });
      } catch {
        return listResult;
      }
    }

    case 'read_email': {
      const raw = await executeGws(['gmail', 'users', 'messages', 'get', '--params', JSON.stringify({
        userId: 'me',
        id: args.message_id,
        format: 'full',
      })], signal);

      // Post-process: extract clean fields instead of returning raw payload with HTML
      const parsed = parseJson(raw);
      if (!parsed) return raw;

      const headers = parsed.payload?.headers;
      const body = extractEmailBody(parsed.payload);
      const snippet = parsed.snippet || '';
      // Truncate body to avoid flooding the model with huge emails
      const cleanBody = body.length > 2000 ? body.slice(0, 2000) + '\n...(truncated)' : body;

      return JSON.stringify({
        id: parsed.id,
        threadId: parsed.threadId,
        from: headerValue(headers, 'From'),
        to: headerValue(headers, 'To'),
        subject: headerValue(headers, 'Subject'),
        date: headerValue(headers, 'Date'),
        snippet,
        body: cleanBody || snippet,
        labelIds: parsed.labelIds || [],
      });
    }

    case 'create_calendar_event': {
      const event: any = {
        summary: args.summary,
        start: { dateTime: args.start_time },
        end: { dateTime: args.end_time },
      };
      if (args.description) event.description = args.description;
      if (args.location) event.location = args.location;
      if (args.attendees) {
        event.attendees = args.attendees.split(',').map((e: string) => ({ email: e.trim() }));
      }
      return executeGws(['calendar', 'events', 'insert', '--params', JSON.stringify({ calendarId: 'primary' }), '--json', JSON.stringify(event)], signal);
    }

    case 'list_calendar_events': {
      const days = args.days || 7;
      const limit = args.limit || 10;
      const now = new Date().toISOString();
      const future = new Date(Date.now() + days * 86400000).toISOString();
      return executeGws(['calendar', 'events', 'list', '--params', JSON.stringify({
        calendarId: 'primary',
        timeMin: now,
        timeMax: future,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: limit,
      })], signal);
    }

    case 'create_task': {
      const task: any = { title: args.title };
      task.notes = buildFlowSpaceTaskNotes(args.notes, { source: 'flowspace-task' });
      if (args.due) task.due = args.due;
      return executeGws(['tasks', 'tasks', 'insert', '--params', JSON.stringify({ tasklist: '@default' }), '--json', JSON.stringify(task)], signal);
    }

    case 'list_tasks': {
      const limit = args.limit || 20;
      return executeGws(['tasks', 'tasks', 'list', '--params', JSON.stringify({
        tasklist: '@default',
        showCompleted: false,
        maxResults: limit,
      })], signal);
    }

    case 'standup_report':
      return executeGws(['workflow', '+standup-report'], signal);

    case 'meeting_prep':
      return executeGws(['workflow', '+meeting-prep'], signal);

    case 'email_to_task':
      return executeGws(['workflow', '+email-to-task', '--message-id', args.message_id], signal);

    case 'weekly_digest':
      return executeGws(['workflow', '+weekly-digest'], signal);

    // Tier 1 — gws skills
    case 'calendar_agenda': {
      const agendaArgs = ['calendar', '+agenda'];
      const dateInput = args.date ? String(args.date).trim() : '';
      if (dateInput) {
        // Validate date string as YYYY-MM-DD and compute days from today to the requested date
        const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (isoDatePattern.test(dateInput)) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const target = new Date(dateInput + 'T00:00:00');
          const targetTime = target.getTime();
          if (!Number.isNaN(targetTime)) {
            const diffDays = Math.round((targetTime - today.getTime()) / 86400000);
            if (diffDays <= 0) {
              agendaArgs.push('--today');
            } else if (diffDays === 1) {
              agendaArgs.push('--tomorrow');
            } else {
              agendaArgs.push('--days', String(diffDays));
            }
          } else {
            // Fallback if parsed date is invalid
            agendaArgs.push('--today');
          }
        } else {
          // Fallback if date format is not YYYY-MM-DD
          agendaArgs.push('--today');
        }
      } else {
        agendaArgs.push('--today');
      }
      agendaArgs.push('--format', 'json');
      return executeGws(agendaArgs, signal);
    }

    case 'gmail_triage': {
      const limit = String(args.limit || 20);
      return executeGws(['gmail', '+triage', '--query', 'is:unread', '--max', limit, '--format', 'json'], signal);
    }

    case 'open_email_triage': {
      // Navigation-only tool — actual navigation is handled by the chat loop via the navigate event.
      return JSON.stringify({ status: 'ok', message: 'Opened AI Triage view' });
    }

    case 'check_email_triage': {
      // Navigation + refresh — navigates to triage tab and triggers a data refresh.
      return JSON.stringify({ status: 'ok', message: 'Refreshing AI Triage view with latest emails' });
    }

    case 'sheets_read': {
      return executeGws(['sheets', '+read', '--spreadsheet', args.spreadsheet_id, '--range', args.range, '--format', 'json'], signal);
    }

    case 'docs_read': {
      // No +read helper for docs — use the raw documents.get API
      return executeGws(['docs', 'documents', 'get', '--params', JSON.stringify({ documentId: args.doc_id })], signal);
    }

    case 'docs_write': {
      // gws docs +write only supports append (--text). No mode flag.
      return executeGws(['docs', '+write', '--document', args.doc_id, '--text', args.content, '--format', 'json'], signal);
    }

    // Tier 2 — gws skills
    case 'sheets_append': {
      const values = typeof args.values === 'string' ? args.values : JSON.stringify(args.values);
      return executeGws(['sheets', '+append', '--spreadsheet', args.spreadsheet_id, '--json-values', values, '--format', 'json'], signal);
    }

    case 'sheets_create': {
      // Create spreadsheet via raw API, then optionally populate with initial data
      const body: Record<string, unknown> = {
        properties: { title: args.title },
      };
      const result = await executeGws(['sheets', 'spreadsheets', 'create', '--json', JSON.stringify(body), '--format', 'json'], signal);
      // If initial values were provided, populate them in the new spreadsheet
      if (args.values) {
        try {
          const parsed = JSON.parse(result);
          const spreadsheetId = parsed?.spreadsheetId;
          if (spreadsheetId) {
            const initialValues = typeof args.values === 'string' ? args.values : JSON.stringify(args.values);
            const rows = JSON.parse(initialValues);
            const endCol = String.fromCharCode(64 + Math.max(...rows.map((r: unknown[]) => r.length)));
            const range = `Sheet1!A1:${endCol}${rows.length}`;
            await executeGws(['sheets', 'spreadsheets', 'values', 'update',
              '--params', JSON.stringify({ spreadsheetId, range, valueInputOption: 'USER_ENTERED' }),
              '--json', JSON.stringify({ values: rows }),
              '--format', 'json',
            ], signal);
          }
        } catch {
          // Spreadsheet was created but populating initial data failed — still return the creation result
        }
      }
      return result;
    }

    case 'sheets_update': {
      const values = typeof args.values === 'string' ? args.values : JSON.stringify(args.values);
      const rows = JSON.parse(values);
      return executeGws(['sheets', 'spreadsheets', 'values', 'update',
        '--params', JSON.stringify({
          spreadsheetId: args.spreadsheet_id,
          range: args.range,
          valueInputOption: 'USER_ENTERED',
        }),
        '--json', JSON.stringify({ values: rows }),
        '--format', 'json',
      ], signal);
    }

    case 'drive_upload': {
      // gws drive +upload takes file as positional arg, not --file
      const uploadArgs = ['drive', '+upload', args.file_path];
      if (args.parent_id) uploadArgs.push('--parent', args.parent_id);
      uploadArgs.push('--format', 'json');
      return executeGws(uploadArgs, signal);
    }

    case 'review_overdue_tasks': {
      // List incomplete tasks and filter overdue ones — no dedicated helper exists
      return executeGws(['tasks', 'tasks', 'list', '--params', JSON.stringify({
        tasklist: '@default',
        showCompleted: false,
        maxResults: 100,
        dueMax: new Date().toISOString(),
      }), '--format', 'json'], signal);
    }

    case 'save_email_to_doc': {
      // Get full thread, then create a doc — multi-step via raw API
      const thread = await executeGws(['gmail', 'users', 'threads', 'get', '--params', JSON.stringify({
        userId: 'me',
        id: args.thread_id,
        format: 'full',
      }), '--format', 'json'], signal);
      return thread;
    }

    case 'archive_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) {
        return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      }
      return callInboxActionApi({
        actionType: 'archive_threads',
        threadIds,
        approvalSnapshot: `Archive ${threadIds.length} Gmail thread(s).`,
      }, signal);
    }

    case 'trash_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) {
        return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      }
      return callInboxActionApi({
        actionType: 'trash_threads',
        threadIds,
        approvalSnapshot: `Move ${threadIds.length} Gmail thread(s) to Trash.`,
      }, signal);
    }

    case 'restore_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'restore_threads',
        threadIds,
        approvalSnapshot: `Restore ${threadIds.length} Gmail thread(s) to Inbox.`,
      }, signal);
    }

    case 'mute_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'mute_threads',
        threadIds,
        approvalSnapshot: `Mute ${threadIds.length} Gmail thread(s).`,
      }, signal);
    }

    case 'mark_threads_read': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'mark_read',
        threadIds,
        approvalSnapshot: `Mark ${threadIds.length} Gmail thread(s) as read.`,
      }, signal);
    }

    case 'apply_label_to_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      const labelName = String(args.label_name ?? '').trim();
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      if (!labelName) return 'Error: label_name is required.';
      return callInboxActionApi({
        actionType: 'apply_label',
        threadIds,
        labelName,
        approvalSnapshot: `Apply label "${labelName}" to ${threadIds.length} Gmail thread(s).`,
      }, signal);
    }

    case 'unsubscribe_from_sender': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'unsubscribe_sender',
        threadIds,
        approvalSnapshot: `Attempt unsubscribe using Gmail metadata for ${threadIds[0]}.`,
      }, signal);
    }

    case 'create_gmail_filter': {
      const sender = String(args.sender ?? '').trim();
      const subject = String(args.subject ?? '').trim();
      if (!sender && !subject) return 'Error: sender or subject is required to create a filter.';
      return callInboxActionApi({
        actionType: 'create_filter',
        sender,
        subject,
        labelName: String(args.label_name ?? '').trim() || undefined,
        archive: String(args.archive ?? '').toLowerCase() === 'true',
        markRead: String(args.mark_read ?? '').toLowerCase() === 'true',
        skipInbox: String(args.skip_inbox ?? '').toLowerCase() === 'true',
        approvalSnapshot: `Create Gmail filter for sender "${sender}" and subject "${subject}".`,
      }, signal);
    }

    case 'undo_inbox_action': {
      const auditId = String(args.audit_id ?? '').trim();
      if (!auditId) return 'Error: audit_id is required.';
      return callUndoInboxActionApi(auditId, signal);
    }

    case 'create_tool': {
      let steps: ToolStep[];
      try {
        steps = typeof args.steps === 'string' ? JSON.parse(args.steps) : args.steps;
      } catch {
        return 'Error: steps must be a valid JSON array of step objects.';
      }

      let parameters: Record<string, unknown>;
      try {
        parameters = args.parameters
          ? (typeof args.parameters === 'string' ? JSON.parse(args.parameters) : args.parameters)
          : { type: 'object', properties: {} };
      } catch {
        return 'Error: parameters must be a valid JSON Schema object.';
      }

      const toolDef: DynamicToolDef = {
        name: String(args.name ?? '').trim(),
        description: String(args.description ?? '').trim(),
        parameters,
        steps,
        isWriteTool: args.is_write_tool === true || args.is_write_tool === 'true',
        createdAt: new Date().toISOString(),
        label: args.label ? String(args.label) : undefined,
      };

      const validationError = validateDynamicTool(toolDef);
      if (validationError) {
        return `Error: Invalid tool definition — ${validationError}`;
      }

      const registered = registerDynamicTool(toolDef);
      if (!registered) {
        return `Error: A tool named "${toolDef.name}" already exists. Choose a different name.`;
      }

      return JSON.stringify({
        created: true,
        name: registered.name,
        description: registered.description,
        stepCount: registered.steps.length,
        isWriteTool: registered.isWriteTool,
        message: `Tool "${registered.name}" created successfully with ${registered.steps.length} step(s). It is now available for use.`,
      });
    }

    case 'save_memory': {
      const { createMemory, loadMemories } = await import('./memory/memory-store.js');
      loadMemories();

      const content = String(args.content ?? '').trim();
      const category = String(args.category ?? 'fact') as 'resource' | 'workflow' | 'preference' | 'fact';
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];

      if (!content) {
        return 'Error: content is required for saving a memory.';
      }

      if (!['resource', 'workflow', 'preference', 'fact'].includes(category)) {
        return 'Error: category must be one of: resource, workflow, preference, fact.';
      }

      const entry = createMemory({
        category,
        content,
        tags,
        metadata: {},
        source: { type: 'explicit_user' },
      });

      return JSON.stringify({
        saved: true,
        id: entry.id,
        category: entry.category,
        content: entry.content,
        tags: entry.tags,
        message: `Memory saved: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
      });
    }

    case 'search_memory': {
      const { getMemories, loadMemories } = await import('./memory/memory-store.js');
      const { retrieveMemories } = await import('./memory/memory-retriever.js');

      loadMemories();

      const query = String(args.query ?? '').trim();
      if (!query) {
        return JSON.stringify({ results: [], message: 'No search query provided.' });
      }

      const memories = [...getMemories()];
      const results = retrieveMemories(query, memories, { maxResults: 10 });

      return JSON.stringify({
        query,
        results: results.map((r) => ({
          id: r.entry.id,
          category: r.entry.category,
          content: r.entry.content,
          tags: r.entry.tags,
          relevanceScore: Math.round(r.relevanceScore * 100) / 100,
        })),
        message: results.length === 0 ? 'No matching memories found.' : `Found ${results.length} matching memory(ies).`,
      });
    }

    default: {
      const dynamicTool = getDynamicTool(name);
      if (dynamicTool) {
        const result = await executeDynamicTool(dynamicTool, args, signal);
        return result.output;
      }
      return `Unknown tool: ${name}`;
    }
  }
}
